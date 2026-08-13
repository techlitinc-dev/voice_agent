/**
 * Segmentation engine (guide crm/04 §1). A segment is a saved rule query over
 * contacts + their calls/deals/tasks. Evaluation is SQL-translated into a Prisma
 * `where` where possible; call/deal/campaign/task stats (aggregations and
 * last-call lookups) fall back to a two-step aggregate query.
 *
 * Rule schema (stored in Segment.rules as JSON):
 *   { "matchMode": "all" | "any", "conditions": Condition[] }
 */
import { db } from "../db";
import type { Prisma } from "@prisma/client";

export type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "exists";

export type SegmentField =
  | "contact.name"
  | "contact.phone"
  | "contact.city"
  | "contact.consentAt"
  | "contact.optOutAt"
  | "contact.dnc"
  | "contact.createdAt"
  | "contact.leadScore"
  | "contact.leadGrade"
  | "call.count"
  | "call.lastInterestScore"
  | "call.lastOutcome"
  | "call.lastCallAt"
  | "call.totalDurationSec"
  | "deal.count"
  | "deal.openValuePaise"
  | "deal.stage"
  | "campaign.lastContacted"
  | "task.pendingCount"
  | string; // "contact.attributes.<custom>"

export interface Condition {
  field: SegmentField;
  op: Operator;
  value: string | number | boolean | string[];
}

export interface SegmentRules {
  matchMode: "all" | "any";
  conditions: Condition[];
}

export const SEGMENT_FIELDS: { value: SegmentField; label: string; group: string }[] = [
  { value: "contact.name", label: "Name", group: "Contact" },
  { value: "contact.phone", label: "Phone", group: "Contact" },
  { value: "contact.city", label: "City (attribute)", group: "Contact" },
  { value: "contact.consentAt", label: "Consent date", group: "Contact" },
  { value: "contact.optOutAt", label: "Opt-out date", group: "Contact" },
  { value: "contact.dnc", label: "DNC flag", group: "Contact" },
  { value: "contact.createdAt", label: "Created date", group: "Contact" },
  { value: "contact.leadScore", label: "Lead score", group: "Contact" },
  { value: "contact.leadGrade", label: "Lead grade", group: "Contact" },
  { value: "call.count", label: "Total calls", group: "Call" },
  { value: "call.lastInterestScore", label: "Last call interest", group: "Call" },
  { value: "call.lastOutcome", label: "Last call outcome", group: "Call" },
  { value: "call.lastCallAt", label: "Last call date", group: "Call" },
  { value: "call.totalDurationSec", label: "Total call duration (s)", group: "Call" },
  { value: "deal.count", label: "Deal count", group: "Deal" },
  { value: "deal.openValuePaise", label: "Open deal value (paise)", group: "Deal" },
  { value: "deal.stage", label: "Latest deal stage", group: "Deal" },
  { value: "campaign.lastContacted", label: "Last campaign contact", group: "Campaign" },
  { value: "task.pendingCount", label: "Pending task count", group: "Task" },
];

export const SEGMENT_OPERATORS: { value: Operator; label: string }[] = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "in", label: "in list" },
  { value: "exists", label: "exists" },
];

/** Normalize arbitrary stored rules JSON into SegmentRules (best-effort).
 *  Accepts both {matchMode, conditions} and a bare array of conditions. */
export function parseSegmentRules(raw: unknown): SegmentRules {
  let matchMode: "all" | "any" = "all";
  let conditions: unknown[] = [];

  if (Array.isArray(raw)) {
    conditions = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    matchMode = obj.matchMode === "any" ? "any" : "all";
    conditions = Array.isArray(obj.conditions) ? obj.conditions : Array.isArray(obj.rules) ? (obj.rules as unknown[]) : [];
  } else {
    return { matchMode: "all", conditions: [] };
  }

  return {
    matchMode,
    conditions: conditions
      .map((c) => (c && typeof c === "object" ? c as Record<string, unknown> : null))
      .filter((c): c is Record<string, unknown> => c !== null && typeof c.field === "string" && typeof c.op === "string")
      .map((c) => ({ field: c.field as string, op: c.op as Operator, value: c.value as Condition["value"] })),
  };
}

const CONTACT_SIMPLE_FIELDS: Record<string, string> = {
  "contact.name": "name",
  "contact.phone": "phone",
  "contact.consentAt": "consentAt",
  "contact.optOutAt": "optOutAt",
  "contact.dnc": "dnc",
  "contact.createdAt": "createdAt",
};

function cmpFilter(op: Operator, value: Condition["value"]): object | null {
  switch (op) {
    case "eq": return { equals: value };
    case "neq": return { not: value };
    case "gt": return { gt: value as number | Date };
    case "gte": return { gte: value as number | Date };
    case "lt": return { lt: value as number | Date };
    case "lte": return { lte: value as number | Date };
    case "contains": return { contains: String(value), mode: "insensitive" };
    case "in": return { in: Array.isArray(value) ? value : [value] };
    default: return null;
  }
}

/** Translate a condition into a Prisma ContactWhereInput (SQL-backed). Fields
 *  that need aggregation or last-call lookups return {} (handled in step 2). */
export function translateCondition(c: Condition): Prisma.ContactWhereInput {
  const key = CONTACT_SIMPLE_FIELDS[c.field];
  if (key) {
    const filter = cmpFilter(c.op, c.value);
    return filter ? { [key]: filter } : {};
  }

  // Custom contact attribute: contact.attributes.<name>
  if (c.field.startsWith("contact.attributes.")) {
    const attrName = c.field.slice("contact.attributes.".length);
    const filter = cmpFilter(c.op, c.value);
    if (!filter) return {};
    return { attributes: { path: [attrName], ...filter } as Prisma.JsonNullableFilter<"Contact"> };
  }
  if (c.field === "contact.city") {
    const filter = cmpFilter(c.op, c.value);
    if (!filter) return {};
    return { attributes: { path: ["city"], ...filter } as Prisma.JsonNullableFilter<"Contact"> };
  }

  // Contact.leadScore / leadGrade → relation
  if (c.field === "contact.leadScore") {
    const filter = cmpFilter(c.op, c.value);
    return filter ? { leadScore: { is: { score: filter } } } : {};
  }
  if (c.field === "contact.leadGrade") {
    const filter = cmpFilter(c.op, c.value);
    return filter ? { leadScore: { is: { grade: filter as { equals?: string; not?: string } } } } : {};
  }

  // Everything else (call.*, deal.*, campaign.*, task.*) is handled by the
  // two-step aggregate pass in evaluateSegment.
  return {};
}

function isAggregateField(field: SegmentField): boolean {
  // Legacy aliases from guide crm/01 seeds: call.interestScore → call.lastInterestScore.
  if (field === "call.interestScore") return true;
  if (field === "call.outcome") return true;
  return [
    "call.count", "call.lastInterestScore", "call.lastOutcome", "call.lastCallAt", "call.totalDurationSec",
    "deal.count", "deal.openValuePaise", "deal.stage",
    "campaign.lastContacted", "task.pendingCount",
  ].includes(field);
}

/** Resolve a (possibly legacy) field name to the canonical stats key. */
function canonicalField(field: string): string {
  if (field === "call.interestScore") return "call.lastInterestScore";
  if (field === "call.outcome") return "call.lastOutcome";
  return field;
}

function applyOp(actual: unknown, op: Operator, expected: Condition["value"]): boolean {
  if (op === "exists") return expected === true ? actual != null : actual == null;
  switch (op) {
    case "eq": return String(actual ?? "") === String(expected ?? "");
    case "neq": return String(actual ?? "") !== String(expected ?? "");
    case "contains": return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "gt": return Number(actual) > Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "in": return Array.isArray(expected) && expected.map(String).includes(String(actual));
    default: return false;
  }
}

/** Aggregate stats per contact (calls, deals, tasks, campaigns) for step 2. */
async function loadAggregateStats(workspaceId: string): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();

  const calls = await db.call.findMany({
    where: { workspaceId },
    select: { id: true, fromNumber: true, toNumber: true, direction: true, startedAt: true, durationSec: true, interestScore: true, outcome: true },
  });
  const perPhone = new Map<string, { count: number; duration: number; last: { startedAt: Date; interestScore: string | null; outcome: string | null } | null }>();
  for (const c of calls) {
    const phone = c.direction === "INBOUND" ? c.fromNumber : c.toNumber;
    const agg = perPhone.get(phone) ?? { count: 0, duration: 0, last: null };
    agg.count += 1;
    agg.duration += c.durationSec;
    if (!agg.last || c.startedAt > agg.last.startedAt) {
      agg.last = { startedAt: c.startedAt, interestScore: c.interestScore, outcome: c.outcome };
    }
    perPhone.set(phone, agg);
  }

  const deals = await db.deal.findMany({ where: { workspaceId }, select: { contactId: true, status: true, valuePaise: true, stage: { select: { name: true } } } });
  const dealsByContact = new Map<string, { count: number; openValue: number; stage: string | null }>();
  for (const d of deals) {
    if (!d.contactId) continue;
    const agg = dealsByContact.get(d.contactId) ?? { count: 0, openValue: 0, stage: null };
    agg.count += 1;
    if (d.status === "OPEN") agg.openValue += d.valuePaise;
    agg.stage = d.stage?.name ?? agg.stage;
    dealsByContact.set(d.contactId, agg);
  }

  const tasks = await db.task.findMany({ where: { workspaceId }, select: { contactId: true, status: true } });
  const tasksByContact = new Map<string, number>();
  for (const t of tasks) {
    if (!t.contactId || t.status === "DONE" || t.status === "CANCELLED") continue;
    tasksByContact.set(t.contactId, (tasksByContact.get(t.contactId) ?? 0) + 1);
  }

  const campaigns = await db.campaignContact.findMany({
    where: { campaign: { workspaceId } },
    select: { contactId: true, updatedAt: true },
  });
  const campaignByContact = new Map<string, Date>();
  for (const cc of campaigns) {
    const existing = campaignByContact.get(cc.contactId);
    if (!existing || cc.updatedAt > existing) campaignByContact.set(cc.contactId, cc.updatedAt);
  }

  const contacts = await db.contact.findMany({ where: { workspaceId }, select: { id: true, phone: true } });
  for (const c of contacts) {
    const call = perPhone.get(c.phone);
    map.set(c.id, {
      "call.count": call?.count ?? 0,
      "call.totalDurationSec": call?.duration ?? 0,
      "call.lastInterestScore": call?.last?.interestScore ?? null,
      "call.lastOutcome": call?.last?.outcome ?? null,
      "call.lastCallAt": call?.last?.startedAt ?? null,
      "deal.count": dealsByContact.get(c.id)?.count ?? 0,
      "deal.openValuePaise": dealsByContact.get(c.id)?.openValue ?? 0,
      "deal.stage": dealsByContact.get(c.id)?.stage ?? null,
      "campaign.lastContacted": campaignByContact.get(c.id) ?? null,
      "task.pendingCount": tasksByContact.get(c.id) ?? 0,
    });
  }
  return map;
}

/**
 * Evaluate a segment. Returns matching contacts (with leadScore + latest deal
 * stage for display). Uses SQL-translated where clauses for simple contact
 * conditions; aggregation/last-call conditions are applied in a two-step pass.
 */
export async function evaluateSegment(workspaceId: string, segment: { rules: unknown; matchMode: string }) {
  const rules = parseSegmentRules(segment.rules);
  if (rules.conditions.length === 0) return [];

  const aggConditions = rules.conditions.filter((c) => isAggregateField(c.field));
  const simpleConditions = rules.conditions.filter((c) => !isAggregateField(c.field));

  // Step 1: SQL-translated filter for non-aggregate conditions.
  const where: Prisma.ContactWhereInput = { workspaceId };
  if (simpleConditions.length > 0) {
    const translated = simpleConditions.map((c) => translateCondition(c)).filter((w) => Object.keys(w).length > 0);
    if (translated.length > 0) {
      if (rules.matchMode === "all") (where as Record<string, unknown>).AND = translated;
      else (where as Record<string, unknown>).OR = translated;
    }
  }
  const contacts = await db.contact.findMany({
    where,
    include: { leadScore: true, deals: { include: { stage: true }, orderBy: { updatedAt: "desc" }, take: 1 } },
    take: 1000,
  });

  // Step 2: apply aggregation/last-call conditions in JS against loaded stats.
  if (aggConditions.length === 0) return contacts;
  const stats = await loadAggregateStats(workspaceId);
  const matchAll = rules.matchMode === "all";
  return contacts.filter((contact) => {
    const row = stats.get(contact.id) ?? {};
    const results = aggConditions.map((c) => applyOp(row[canonicalField(c.field)], c.op, c.value));
    return matchAll ? results.every(Boolean) : results.some(Boolean);
  });
}
