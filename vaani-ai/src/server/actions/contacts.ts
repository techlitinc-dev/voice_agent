"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/campaign/phone";
import { scrubAgainstDnc } from "@/lib/campaign/compliance";
import { getCrmProvider } from "@/lib/integrations/crm";

export type ActionResult = {
  ok: boolean;
  error?: string;
  imported?: number;
  skipped?: number;
  dncSkipped?: number;
  listId?: string;
};

const TIMEZONES = /^[A-Za-z_]+\/[A-Za-z_]+$/; // cheap IANA shape check

type ParsedRow = {
  phone: string;
  name: string | null;
  timezone: string | null;
  consentAt: Date | null;
  consentSource: string | null;
  attributes: Record<string, string>;
};

/** Parse + validate the CSV. Skipped rows = bad phone.
 *  (Local to this "use server" file — server-action modules may only export
 *  async functions, so this stays private; CSV rules are pinned by the unit
 *  tests for src/lib/campaign/phone.ts and by the scripted import test.) */
function parseContactCsv(csvText: string): { rows: ParsedRow[]; skipped: number; error?: string } {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.data.length === 0) return { rows: [], skipped: 0, error: "CSV has no data rows." };
  if (parsed.data.length > 10_000) return { rows: [], skipped: 0, error: "Max 10,000 rows per upload." };

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const phone = normalizePhone(row.phone ?? row.mobile ?? row.number ?? "");
    if (!phone) { skipped++; continue; }
    const tz = (row.timezone ?? "").trim();
    const consentRaw = (row.consent_at ?? row.consent ?? "").trim().toLowerCase();
    const consentDate = consentRaw ? new Date(consentRaw) : null;
    const consentAt =
      consentDate && !Number.isNaN(consentDate.getTime()) ? consentDate
      : ["yes", "true", "1"].includes(consentRaw) ? new Date()
      : null;
    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!["phone", "mobile", "number", "name", "timezone", "consent_at", "consent", "consent_source"].includes(k) && v) {
        attributes[k] = v;
      }
    }
    rows.push({
      phone,
      name: (row.name ?? "").trim() || null,
      timezone: TIMEZONES.test(tz) ? tz : null,
      consentAt,
      consentSource: consentAt ? ((row.consent_source ?? "").trim() || "csv-upload") : null,
      attributes,
    });
  }
  return { rows, skipped };
}

/** Load the workspace's DNC phone set (DncEntry + opt-out contacts). */
async function loadDncSet(workspaceId: string): Promise<Set<string>> {
  const [entries, optedOut] = await Promise.all([
    db.dncEntry.findMany({ where: { workspaceId }, select: { phone: true } }),
    db.contact.findMany({ where: { workspaceId, optOutAt: { not: null } }, select: { phone: true } }),
  ]);
  return new Set([...entries.map((e) => e.phone), ...optedOut.map((c) => c.phone)]);
}

/** Upsert parsed rows into a list. DNC-listed phones are skipped + counted. */
async function upsertContacts(
  workspaceId: string,
  listId: string,
  rows: ParsedRow[],
  dnc: ReadonlySet<string>
): Promise<{ imported: number; dncSkipped: number }> {
  const { dialable, blocked } = scrubAgainstDnc(rows, dnc);
  for (const r of dialable) {
    await db.contact.upsert({
      where: { workspaceId_phone: { workspaceId, phone: r.phone } },
      update: {
        name: r.name ?? undefined,
        listId,
        attributes: r.attributes,
        timezone: r.timezone ?? undefined,
        consentAt: r.consentAt ?? undefined,
        consentSource: r.consentSource ?? undefined,
      },
      create: {
        workspaceId,
        listId,
        phone: r.phone,
        name: r.name,
        timezone: r.timezone,
        consentAt: r.consentAt,
        consentSource: r.consentSource,
        attributes: r.attributes,
      },
    });
  }
  return { imported: dialable.length, dncSkipped: blocked.length };
}

/** CSV upload → new list. Optionally ALSO enroll into an existing campaign
 *  (readme §6.1 "add contacts to a running campaign") — campaignId of a
 *  DRAFT/RUNNING/PAUSED campaign. */
export async function importContactsAction(input: {
  listName: string;
  csvText: string;
  campaignId?: string;
}): Promise<ActionResult> {
  // RBAC first (guide 03): throws FORBIDDEN for VIEWER/AGENT — NOT caught below.
  const ctx = await requirePermission("contacts:import");
  try {
    const listName = z.string().min(2).max(80).parse(input.listName);

    const { rows, skipped, error } = parseContactCsv(input.csvText);
    if (error) return { ok: false, error };

    let campaign: { id: string; listId: string; status: string } | null = null;
    if (input.campaignId) {
      campaign = await db.campaign.findFirst({
        where: { id: input.campaignId, workspaceId: ctx.workspaceId, status: { in: ["DRAFT", "RUNNING", "PAUSED"] } },
        select: { id: true, listId: true, status: true },
      });
      if (!campaign) return { ok: false, error: "Campaign not found or already finished." };
    }

    const list = await db.contactList.create({
      data: { workspaceId: ctx.workspaceId, name: listName },
    });

    const dnc = await loadDncSet(ctx.workspaceId);
    const { imported, dncSkipped } = await upsertContacts(ctx.workspaceId, list.id, rows, dnc);

    // Enroll into the campaign's snapshot when requested (dedupe via the
    // @@unique(campaignId, contactId) constraint).
    if (campaign) {
      const contacts = await db.contact.findMany({
        where: { workspaceId: ctx.workspaceId, listId: list.id },
        select: { id: true, dnc: true, optOutAt: true },
      });
      await db.campaignContact.createMany({
        data: contacts.map((c) => ({
          campaignId: campaign!.id,
          contactId: c.id,
          status: c.dnc || c.optOutAt ? ("SKIPPED_DNC" as const) : ("PENDING" as const),
        })),
        skipDuplicates: true,
      });
    }

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "contacts.import", entity: "ContactList", entityId: list.id,
      metadata: { imported, skipped, dncSkipped, listName, campaignId: input.campaignId ?? null },
    });
    revalidatePath("/contacts");
    if (campaign) revalidatePath(`/campaigns/${campaign.id}`);
    return { ok: true, imported, skipped, dncSkipped, listId: list.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Import failed. Check the CSV format." };
  }
}

/** CRM import (readme §6.1): pull contacts from the connected CRM into a new list.
 *  Dry-run safe: CRM_IMPORT_DRY_RUN=true returns fixture rows instead of calling
 *  the CRM (OAuth apps are guide 05/operator territory). */
export async function importFromCrmAction(crmConnectionId: string): Promise<ActionResult> {
  const ctx = await requirePermission("contacts:import");
  try {
    const conn = await db.crmConnection.findFirst({
      where: { id: crmConnectionId, workspaceId: ctx.workspaceId },
    });
    if (!conn) return { ok: false, error: "CRM connection not found." };

    let updates: { externalId: string; name?: string; phone?: string; email?: string }[];
    if (process.env.CRM_IMPORT_DRY_RUN !== "false") {
      updates = [
        { externalId: "dry-1", name: "CRM Dry One", phone: "+919876543210", email: "one@example.com" },
        { externalId: "dry-2", name: "CRM Dry Two", phone: "+919876543211" },
      ];
    } else {
      updates = await getCrmProvider(conn.provider).pullUpdates(conn, new Date(0));
    }

    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (const u of updates) {
      const phone = u.phone ? normalizePhone(u.phone) : null;
      if (!phone) { skipped++; continue; }
      rows.push({
        phone,
        name: u.name ?? null,
        timezone: null,
        consentAt: null,
        consentSource: null,
        attributes: u.email ? { email: u.email } : {},
      });
    }
    if (rows.length === 0) return { ok: false, error: "CRM returned no contacts with valid phones.", skipped };

    const list = await db.contactList.create({
      data: { workspaceId: ctx.workspaceId, name: `CRM import ${conn.provider} ${new Date().toISOString().slice(0, 10)}` },
    });
    const dnc = await loadDncSet(ctx.workspaceId);
    const { imported, dncSkipped } = await upsertContacts(ctx.workspaceId, list.id, rows, dnc);

    // Stamp crmExternalId for two-way sync (best effort, by phone).
    for (const u of updates) {
      const phone = u.phone ? normalizePhone(u.phone) : null;
      if (!phone) continue;
      await db.contact.updateMany({
        where: { workspaceId: ctx.workspaceId, phone },
        data: { crmExternalId: u.externalId },
      });
    }

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "contacts.import-crm", entity: "CrmConnection", entityId: conn.id,
      metadata: { provider: conn.provider, imported, skipped, dncSkipped, dryRun: process.env.CRM_IMPORT_DRY_RUN !== "false" },
    });
    revalidatePath("/contacts");
    return { ok: true, imported, skipped, dncSkipped, listId: list.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "CRM import failed." };
  }
}

export async function toggleDncAction(contactId: string, dnc: boolean): Promise<ActionResult> {
  const ctx = await requirePermission("contacts:write");
  try {
    const contact = await db.contact.findFirst({
      where: { id: contactId, workspaceId: ctx.workspaceId },
      select: { id: true, phone: true },
    });
    if (!contact) return { ok: false, error: "Contact not found." };
    await db.$transaction([
      db.contact.update({ where: { id: contact.id }, data: { dnc } }),
      dnc
        ? db.dncEntry.upsert({
            where: { workspaceId_phone: { workspaceId: ctx.workspaceId, phone: contact.phone } },
            update: {},
            create: { workspaceId: ctx.workspaceId, phone: contact.phone, source: "MANUAL", reason: "toggled by user" },
          })
        : db.dncEntry.deleteMany({ where: { workspaceId: ctx.workspaceId, phone: contact.phone, source: "MANUAL" } }),
    ]);
    revalidatePath("/contacts");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
