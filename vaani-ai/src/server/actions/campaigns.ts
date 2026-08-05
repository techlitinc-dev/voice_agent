"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ensureCampaignScheduler, stopCampaignScheduler } from "@/lib/queue";
import { getPreset, CAMPAIGN_TYPES } from "@/lib/campaign/presets";
import { parseRetryPolicy, parseCampaignExtras } from "@/lib/campaign/retry";
import { isNumberTypeAllowed, consentBlocks, requiresConsent } from "@/lib/campaign/compliance";
import type { Prisma } from "@prisma/client";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const HHMM = /^\d{2}:\d{2}$/;

const campaignSchema = z.object({
  name: z.string().min(2).max(80),
  type: z.string().refine((t) => CAMPAIGN_TYPES.includes(t), "unknown campaign type"),
  agentId: z.string().min(1),
  listId: z.string().min(1),
  poolId: z.string().nullable().optional(),
  callsPerMinute: z.coerce.number().int().min(1).max(60),
  concurrency: z.coerce.number().int().min(1).max(50),
  maxAttempts: z.coerce.number().int().min(1).max(5),
  retryDelayMin: z.coerce.number().int().min(5).max(1440),
  callingWindowStart: z.string().regex(HHMM),
  callingWindowEnd: z.string().regex(HHMM),
  retryPolicy: z.record(z.object({ attempts: z.number().int().min(1).max(10), delayMin: z.number().min(5).max(1440) })).nullable().optional(),
  timezoneWindows: z.object({
    timezone: z.string().optional(),
    days: z.array(z.number().int().min(0).max(6)).optional(),
    windows: z.array(z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)])).optional(),
  }).nullable().optional(),
  openingHook: z.string().max(2000).nullable().optional(),
  objectionPlaybook: z.string().max(4000).nullable().optional(),
  amdPolicy: z.enum(["HANGUP", "LEAVE_MESSAGE"]),
  predictiveDialing: z.coerce.boolean(),
  whatsappFallbackTemplateId: z.string().nullable().optional(),
  applyPreset: z.coerce.boolean().optional(),
});

type CampaignInput = z.infer<typeof campaignSchema>;

/** Snapshot a list's contacts into CampaignContact rows with the import-time
 *  DNC + consent scrub (dial time re-checks everything — defense in depth). */
async function snapshotContacts(
  workspaceId: string,
  campaignId: string,
  listId: string,
  campaignType: string
): Promise<void> {
  const consentOn = process.env.REQUIRE_CONSENT_FOR_PROMOTIONAL === "true";
  const [contacts, dncEntries] = await Promise.all([
    db.contact.findMany({
      where: { workspaceId, listId },
      select: { id: true, dnc: true, optOutAt: true, phone: true, consentAt: true },
    }),
    db.dncEntry.findMany({ where: { workspaceId }, select: { phone: true } }),
  ]);
  const dncPhones = new Set(dncEntries.map((d) => d.phone));
  await db.campaignContact.createMany({
    data: contacts.map((c) => {
      const blocked = c.dnc || c.optOutAt !== null || dncPhones.has(c.phone);
      const noConsent = consentBlocks({ consentAt: c.consentAt }, campaignType, consentOn);
      return {
        campaignId,
        contactId: c.id,
        status: blocked || noConsent ? ("SKIPPED_DNC" as const) : ("PENDING" as const),
        lastResult: noConsent && !blocked ? "skipped:no-consent" : blocked ? "skipped:dnc" : null,
      };
    }),
    skipDuplicates: true,
  });
}

export async function createCampaignAction(input: unknown): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write"); // RBAC first — throws FORBIDDEN
  try {
    const parsed = campaignSchema.safeParse(input);
    if (!parsed.success) {
      console.error("campaign schema", parsed.error.issues);
      return { ok: false, error: "Check the campaign fields." };
    }
    const d: CampaignInput = parsed.data;
    const preset = getPreset(d.type);

    // Preset defaults fill anything the form left at scalar defaults (applyPreset).
    const retryPolicyJson: Record<string, unknown> = {
      ...(d.applyPreset && preset ? preset.retryPolicy : parseRetryPolicy(d.retryPolicy ?? null)),
    };
    const extras = parseCampaignExtras({ whatsappFallbackTemplateId: d.whatsappFallbackTemplateId ?? undefined });
    if (extras.whatsappFallbackTemplateId) {
      retryPolicyJson.whatsappFallbackTemplateId = extras.whatsappFallbackTemplateId;
    }
    const timezoneWindowsJson = d.timezoneWindows ?? (d.applyPreset && preset ? { days: preset.days } : null);

    const [agent, list, pool] = await Promise.all([
      db.agent.findFirst({ where: { id: d.agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" } }),
      db.contactList.findFirst({ where: { id: d.listId, workspaceId: ctx.workspaceId } }),
      d.poolId ? db.numberPool.findFirst({ where: { id: d.poolId, workspaceId: ctx.workspaceId } }) : null,
    ]);
    if (!agent) return { ok: false, error: "Pick a PUBLISHED agent (publish it on the Agents page first)." };
    if (!list) return { ok: false, error: "Contact list not found." };
    if (d.poolId && !pool) return { ok: false, error: "Number pool not found." };
    if (extras.whatsappFallbackTemplateId) {
      const tpl = await db.whatsAppTemplate.findFirst({
        where: { id: extras.whatsappFallbackTemplateId, workspaceId: ctx.workspaceId, status: "APPROVED" },
      });
      if (!tpl) return { ok: false, error: "WhatsApp fallback template not found or not APPROVED." };
    }

    const campaign = await db.campaign.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: d.name,
        type: d.type as never,
        agentId: d.agentId,
        listId: d.listId,
        poolId: d.poolId ?? null,
        status: "DRAFT",
        callsPerMinute: d.callsPerMinute,
        concurrency: d.concurrency,
        maxAttempts: d.maxAttempts,
        retryDelayMin: d.retryDelayMin,
        retryPolicy: retryPolicyJson as Prisma.InputJsonValue,
        callingWindowStart: d.applyPreset && preset ? preset.windowStart : d.callingWindowStart,
        callingWindowEnd: d.applyPreset && preset ? preset.windowEnd : d.callingWindowEnd,
        timezoneWindows: timezoneWindowsJson ?? undefined,
        openingHook: d.openingHook ?? (d.applyPreset && preset ? preset.openingHook : null),
        objectionPlaybook: d.objectionPlaybook ?? (d.applyPreset && preset ? preset.objectionPlaybook : null),
        amdPolicy: d.amdPolicy,
        predictiveDialing: d.predictiveDialing,
      },
    });
    await snapshotContacts(ctx.workspaceId, campaign.id, d.listId, d.type);

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "campaign.create", entity: "Campaign", entityId: campaign.id,
      metadata: { name: campaign.name, type: d.type, preset: d.applyPreset === true },
    });
    revalidatePath("/campaigns");
    return { ok: true, id: campaign.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create campaign." };
  }
}

/** Shared transition helper. `ctx` comes from the caller's requirePermission()
 *  (which runs OUTSIDE the try/catch so FORBIDDEN propagates). */
async function setStatus(
  ctx: { workspaceId: string; user: { id: string } },
  campaignId: string,
  from: string[],
  to: "RUNNING" | "PAUSED" | "CANCELLED",
  action: string
) {
  // TRAI series enforcement at START (readme §6.1/§11): every number in the pool
  // must be an allowed type for the campaign type.
  if (to === "RUNNING") {
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspaceId },
      include: { pool: { include: { numbers: { select: { number: true, numberType: true } } } } },
    });
    if (!campaign) return { ok: false, error: "Campaign not found." };
    if (campaign.pool) {
      const bad = campaign.pool.numbers.filter((n) => !isNumberTypeAllowed(campaign.type, n.numberType));
      if (bad.length > 0) {
        return {
          ok: false,
          error:
            `TRAI series violation: ${bad.map((b) => `${b.number} (${b.numberType})`).join(", ")} ` +
            `not allowed for ${campaign.type} (${requiresConsent(campaign.type) ? "promotional → SERIES_140" : "service → SERIES_1600"}). Fix the pool.`,
        };
      }
    }
  }

  const updated = await db.campaign.updateMany({
    where: { id: campaignId, workspaceId: ctx.workspaceId, status: { in: from as never[] } },
    data: {
      status: to,
      ...(to === "RUNNING" ? { startedAt: new Date() } : {}),
      ...(to === "CANCELLED" ? { finishedAt: new Date() } : {}),
    },
  });
  if (updated.count === 0) return { ok: false, error: `Campaign cannot be ${action} from its current state.` };

  if (to === "RUNNING") await ensureCampaignScheduler(campaignId);
  else await stopCampaignScheduler(campaignId);

  await audit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: `campaign.${action}`, entity: "Campaign", entityId: campaignId,
  });
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function startCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:launch"); // VIEWER gets FORBIDDEN (403-equivalent)
  try { return await setStatus(ctx, id, ["DRAFT", "PAUSED", "SCHEDULED"], "RUNNING", "start"); }
  catch (e) { console.error(e); return { ok: false, error: "Something went wrong." }; }
}

export async function pauseCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:launch");
  try { return await setStatus(ctx, id, ["RUNNING"], "PAUSED", "pause"); }
  catch (e) { console.error(e); return { ok: false, error: "Something went wrong." }; }
}

export async function cancelCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:delete");
  try { return await setStatus(ctx, id, ["DRAFT", "RUNNING", "PAUSED", "SCHEDULED"], "CANCELLED", "cancel"); }
  catch (e) { console.error(e); return { ok: false, error: "Something went wrong." }; }
}

/** Edit script mid-flight (readme §6.1): opening hook + objection playbook are read
 *  fresh by the worker on every dial batch, so saving here changes the NEXT dial. */
export async function updateCampaignScriptAction(input: {
  campaignId: string;
  openingHook: string;
  objectionPlaybook: string;
}): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const openingHook = z.string().max(2000).parse(input.openingHook);
    const objectionPlaybook = z.string().max(4000).parse(input.objectionPlaybook);
    const updated = await db.campaign.updateMany({
      where: { id: input.campaignId, workspaceId: ctx.workspaceId, status: { in: ["DRAFT", "RUNNING", "PAUSED"] } },
      data: { openingHook: openingHook || null, objectionPlaybook: objectionPlaybook || null },
    });
    if (updated.count === 0) return { ok: false, error: "Campaign not found or already finished." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "campaign.edit-script", entity: "Campaign", entityId: input.campaignId,
    });
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not save the script." };
  }
}
