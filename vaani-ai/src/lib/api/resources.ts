/**
 * Public-API resource logic (spec §9). Every function is tenant-scoped by the
 * workspaceId from requireApiKey — never from the client.
 */
import { z } from "zod";
import { db } from "../db";

// ---------- Zod schemas (also unit-tested) ----------

export const agentCreateSchema = z.object({
  name: z.string().min(2).max(80),
  template: z.string().max(60).optional(),
  systemPrompt: z.string().min(10),
  greeting: z.string().min(2),
  languageMode: z.enum(["auto", "fixed", "caller-select"]).default("auto"),
  fixedLanguage: z.string().max(10).optional(),
  voiceId: z.string().max(40).default("anushka"),
  llmModel: z.string().max(120).default("meta-llama/llama-3.1-70b-instruct"),
});

export const campaignCreateSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum([
    "LEAD_QUALIFICATION", "APPOINTMENT_REMINDER", "PAYMENT_REMINDER", "FEEDBACK_SURVEY",
    "ORDER_CONFIRMATION", "REACTIVATION", "EVENT_INVITE", "POLITICAL_SURVEY",
  ]).default("LEAD_QUALIFICATION"),
  agentId: z.string().min(1),
  listId: z.string().min(1),
  callsPerMinute: z.number().int().min(1).max(100).default(10),
  concurrency: z.number().int().min(1).max(50).default(1),
});

export const contactSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 phone required"),
  name: z.string().max(120).optional(),
  listId: z.string().optional(),
  timezone: z.string().max(60).optional(),
  attributes: z.record(z.unknown()).optional(),
});

export const contactsBulkSchema = z.object({
  contacts: z.array(contactSchema).min(1).max(1000),
});

export const callTriggerSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 phone required"),
  agentId: z.string().min(1),
});

export const numberCreateSchema = z.object({
  number: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 number required"),
  label: z.string().max(80).optional(),
  agentId: z.string().optional(),
});

// ---------- Query helpers ----------

export async function listAgents(workspaceId: string) {
  return db.agent.findMany({
    where: { workspaceId },
    select: { id: true, name: true, template: true, status: true, version: true, languageMode: true, voiceId: true, llmModel: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createAgent(workspaceId: string, input: z.infer<typeof agentCreateSchema>) {
  return db.agent.create({ data: { workspaceId, ...input } });
}

export async function listCampaigns(workspaceId: string) {
  return db.campaign.findMany({
    where: { workspaceId },
    select: { id: true, name: true, type: true, status: true, agentId: true, listId: true, callsPerMinute: true, concurrency: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createCampaign(workspaceId: string, input: z.infer<typeof campaignCreateSchema>) {
  // Referenced agent + list must belong to the SAME workspace.
  const [agent, list] = await Promise.all([
    db.agent.findFirst({ where: { id: input.agentId, workspaceId } }),
    db.contactList.findFirst({ where: { id: input.listId, workspaceId } }),
  ]);
  if (!agent) return { error: "agent_not_found" as const };
  if (!list) return { error: "list_not_found" as const };
  const campaign = await db.campaign.create({ data: { workspaceId, ...input } });
  return { campaign };
}

export async function listContacts(workspaceId: string) {
  return db.contact.findMany({
    where: { workspaceId },
    select: { id: true, phone: true, name: true, listId: true, timezone: true, dnc: true, attributes: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/** Bulk upsert by (workspaceId, phone). Returns counts. */
export async function upsertContacts(workspaceId: string, contacts: z.infer<typeof contactSchema>[]) {
  let created = 0;
  let updated = 0;
  for (const c of contacts) {
    const existing = await db.contact.findUnique({
      where: { workspaceId_phone: { workspaceId, phone: c.phone } },
      select: { id: true },
    });
    // listId, when given, must belong to this workspace.
    let listId: string | undefined;
    if (c.listId) {
      const list = await db.contactList.findFirst({ where: { id: c.listId, workspaceId }, select: { id: true } });
      if (!list) return { error: "list_not_found" as const, phone: c.phone };
      listId = list.id;
    }
    await db.contact.upsert({
      where: { workspaceId_phone: { workspaceId, phone: c.phone } },
      update: { name: c.name, timezone: c.timezone, attributes: c.attributes as never, ...(listId ? { listId } : {}) },
      create: { workspaceId, phone: c.phone, name: c.name, timezone: c.timezone, attributes: c.attributes as never, ...(listId ? { listId } : {}) },
    });
    if (existing) updated += 1; else created += 1;
  }
  return { created, updated };
}

export async function listCalls(workspaceId: string, url: URL) {
  const take = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
  return db.call.findMany({
    where: {
      workspaceId,
      ...(url.searchParams.get("status") ? { status: url.searchParams.get("status") as never } : {}),
      ...(url.searchParams.get("direction") ? { direction: url.searchParams.get("direction") as never } : {}),
    },
    select: {
      id: true, direction: true, status: true, fromNumber: true, toNumber: true,
      agentId: true, campaignId: true, durationSec: true, outcome: true, sentiment: true,
      scriptAdherenceScore: true, billedPaise: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function listNumbers(workspaceId: string) {
  return db.phoneNumber.findMany({
    where: { workspaceId },
    select: { id: true, number: true, label: true, numberType: true, agentId: true, monthlyRentPaise: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function registerNumber(workspaceId: string, input: z.infer<typeof numberCreateSchema>) {
  if (input.agentId) {
    const agent = await db.agent.findFirst({ where: { id: input.agentId, workspaceId }, select: { id: true } });
    if (!agent) return { error: "agent_not_found" as const };
  }
  const existing = await db.phoneNumber.findUnique({
    where: { workspaceId_number: { workspaceId, number: input.number } },
  });
  if (existing) return { error: "number_already_registered" as const };
  const number = await db.phoneNumber.create({
    data: { workspaceId, number: input.number, label: input.label, agentId: input.agentId ?? null },
  });
  return { number };
}
