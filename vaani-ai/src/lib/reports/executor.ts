/**
 * Report execution engine (docs/analytics/04 §2).
 * Translates a ReportConfig into Prisma queries. All values are parameterized
 * (no string interpolation of user input), and rows are capped at 10,000.
 */
import { db } from "../db";
import { getDateRange, type DateRange } from "../analytics";
import { marginPercent } from "../analytics";
import type { FilterCondition, MetricKey, ReportConfig, ReportResult, ReportRow } from "./types";

const MAX_ROWS = 10_000;

type CallFilterKey =
  | "direction"
  | "status"
  | "agentId"
  | "campaignId"
  | "interestScore"
  | "outcome"
  | "durationSec"
  | "billedPaise";

const CALL_FILTER_FIELDS = new Set<CallFilterKey>([
  "direction",
  "status",
  "agentId",
  "campaignId",
  "interestScore",
  "outcome",
  "durationSec",
  "billedPaise",
]);

/** Build a Prisma where-clause fragment for one filter condition. */
function filterToWhere(f: FilterCondition): Record<string, unknown> | null {
  const field = f.field;
  if (!CALL_FILTER_FIELDS.has(field as CallFilterKey)) return null; // ignore unknown fields

  const op = f.op;
  const value = f.value;
  switch (op) {
    case "eq":
      if (value === undefined || value === null || value === "") return null;
      return { [field]: value };
    case "neq":
      if (value === undefined || value === null || value === "") return null;
      return { [field]: { not: value } };
    case "in":
      if (!Array.isArray(value) || value.length === 0) return null;
      return { [field]: { in: value } };
    case "isnull":
      return { [field]: op === "isnull" ? null : undefined };
    default:
      return null; // gt/lt/between not supported on call filters (avoids injection through JSON)
  }
}

function translateFilters(filters: FilterCondition[]): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const f of filters) {
    const clause = filterToWhere(f);
    if (clause) Object.assign(where, clause);
  }
  return where;
}

/** Resolve the date range for the report. Custom ranges use start/end ISO dates. */
function resolveRange(config: ReportConfig): DateRange {
  const preset = getDateRange(config.dateRange.preset);
  if (config.dateRange.start && config.dateRange.end) {
    return { start: new Date(config.dateRange.start), end: new Date(config.dateRange.end) };
  }
  return preset;
}

// ---------- Call-source executor (full metric support) ----------

function bucketKey(d: Date, by: string): string {
  switch (by) {
    case "day": return d.toISOString().slice(0, 10);
    case "week": {
      const start = new Date(d.getFullYear(), 0, 1);
      const week = Math.max(1, Math.ceil((d.getTime() - start.getTime()) / (7 * 86400000)));
      return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
    }
    case "month": return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    case "hour": return String(d.getHours()).padStart(2, "0");
    case "dayOfWeek": return String(d.getDay());
    default: return d.toISOString().slice(0, 10);
  }
}

type CallRow = {
  startedAt: Date;
  direction: string;
  status: string;
  durationSec: number;
  billedPaise: number;
  costTelephonyPaise: number;
  costSttPaise: number;
  costLlmPaise: number;
  costTtsPaise: number;
  agentId: string | null;
  campaignId: string | null;
  interestScore: string | null;
};

function callToRow(c: CallRow): ReportRow {
  return {
    date: c.startedAt.toISOString().slice(0, 10),
    day: c.startedAt.toISOString().slice(0, 10),
    hour: bucketKey(c.startedAt, "hour"),
    dayOfWeek: bucketKey(c.startedAt, "dayOfWeek"),
    direction: c.direction,
    status: c.status,
    agentId: c.agentId,
    campaignId: c.campaignId,
    interestScore: c.interestScore,
    durationSec: c.durationSec,
    billedPaise: c.billedPaise,
    costPaise: c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise,
  };
}

/** Aggregate a metric over a list of rows (post-query aggregation). */
function aggregateMetric(rows: ReportRow[], metric: MetricKey): number | null {
  if (rows.length === 0) return 0;
  switch (metric) {
    case "count": return rows.length;
    case "sumDuration": return rows.reduce((a, r) => a + Number(r.durationSec ?? 0), 0);
    case "sumBilled": return rows.reduce((a, r) => a + Number(r.billedPaise ?? 0), 0);
    case "sumCost": return rows.reduce((a, r) => a + Number(r.costPaise ?? 0), 0);
    case "margin": {
      const billed = rows.reduce((a, r) => a + Number(r.billedPaise ?? 0), 0);
      const cost = rows.reduce((a, r) => a + Number(r.costPaise ?? 0), 0);
      return billed - cost;
    }
    case "avgDuration": {
      const vals = rows.map((r) => Number(r.durationSec ?? 0)).filter((v) => v > 0);
      return vals.length === 0 ? null : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    case "avgBilled": {
      const vals = rows.map((r) => Number(r.billedPaise ?? 0)).filter((v) => v > 0);
      return vals.length === 0 ? null : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    case "connectRate": {
      const completed = rows.filter((r) => r.status === "COMPLETED").length;
      return rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;
    }
    case "hotCount": return rows.filter((r) => r.interestScore === "HOT").length;
    case "warmCount": return rows.filter((r) => r.interestScore === "WARM").length;
    case "coldCount": return rows.filter((r) => r.interestScore === "COLD").length;
    case "marginPercent": {
      const billed = rows.reduce((a, r) => a + Number(r.billedPaise ?? 0), 0);
      const cost = rows.reduce((a, r) => a + Number(r.costPaise ?? 0), 0);
      return billed > 0 ? Math.round(((billed - cost) / billed) * 100) : 0;
    }
    default: return null;
  }
}

// ---------- Executor ----------

/**
 * Normalize a legacy report config. Older seeds stored groupBy as a bare string
 * ("day") instead of an array; the run/export routes pass raw stored JSON into
 * executeReport, so coerce it here once instead of in every executor.
 */
function normalizeConfig(config: ReportConfig): ReportConfig {
  const groupBy = Array.isArray(config.groupBy)
    ? config.groupBy
    : config.groupBy
      ? [config.groupBy]
      : [];
  const metrics = Array.isArray(config.metrics) && config.metrics.length > 0
    ? config.metrics
    : (["count"] as ReportConfig["metrics"]);
  return { ...config, groupBy, metrics };
}

/** Execute a report config for a workspace. Returns rows + summary. */
export async function executeReport(workspaceId: string, config: ReportConfig): Promise<ReportResult> {
  const normalized = normalizeConfig(config);
  const range = resolveRange(normalized);
  const limit = Math.min(normalized.limit ?? 1000, MAX_ROWS);

  if (normalized.source === "calls") {
    return executeCalls(workspaceId, normalized, range, limit);
  }
  if (normalized.source === "deals") {
    return executeDeals(workspaceId, normalized, range, limit);
  }
  if (normalized.source === "campaigns") {
    return executeCampaigns(workspaceId, normalized, range, limit);
  }
  if (normalized.source === "cost") {
    return executeCost(workspaceId, normalized, range, limit);
  }
  // contacts/tasks/activities fall back to a simple table
  return executeSimpleTable(workspaceId, normalized, range, limit);
}

async function executeCalls(workspaceId: string, config: ReportConfig, range: DateRange, limit: number): Promise<ReportResult> {
  const filterWhere = translateFilters(config.filters);
  const calls = await db.call.findMany({
    where: { workspaceId, startedAt: { gte: range.start, lte: range.end }, ...filterWhere },
    select: {
      startedAt: true,
      direction: true,
      status: true,
      durationSec: true,
      billedPaise: true,
      costTelephonyPaise: true,
      costSttPaise: true,
      costLlmPaise: true,
      costTtsPaise: true,
      agentId: true,
      campaignId: true,
      interestScore: true,
    },
    orderBy: { startedAt: "asc" },
    take: limit,
  });

  const rawRows: ReportRow[] = calls.map(callToRow);
  const groupBy = config.groupBy;
  const metrics: MetricKey[] = config.metrics.length > 0 ? config.metrics : ["count"];

  // Group in memory by the requested dimensions.
  const groups = new Map<string, ReportRow[]>();
  for (const row of rawRows) {
    const key = groupBy.map((g) => JSON.stringify(row[g] ?? "")).join("|");
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const rows: ReportRow[] = [];
  for (const [key, groupRows] of groups.entries()) {
    const out: ReportRow = {};
    groupBy.forEach((g, i) => {
      const raw = key.split("|")[i];
      out[g] = raw === undefined ? null : raw === "" ? null : (JSON.parse(raw) as string | number | null);
    });
    for (const m of metrics) {
      out[m] = aggregateMetric(groupRows, m);
    }
    rows.push(out);
  }

  // Sort.
  const sortBy = config.sortBy;
  if (sortBy && sortBy.field) {
    rows.sort((a, b) => {
      const av = a[sortBy.field];
      const bv = b[sortBy.field];
      if (av === bv) return 0;
      const cmp = (av ?? 0) > (bv ?? 0) ? 1 : -1;
      return sortBy.direction === "desc" ? -cmp : cmp;
    });
  }

  const summary: Record<string, number | string | null> = {};
  for (const m of metrics) summary[m] = aggregateMetric(rawRows, m);

  return {
    name: config.title ?? "Custom report",
    source: "calls",
    columns: [...groupBy, ...metrics],
    rows: rows.slice(0, limit),
    summary,
    chart: config.chart,
    groupBy,
    generatedAt: new Date().toISOString(),
  };
}

/** Deals report: metrics like dealsCreated / dealsWon / revenue, grouped by stage/owner/source/day. */
async function executeDeals(workspaceId: string, config: ReportConfig, range: DateRange, limit: number): Promise<ReportResult> {
  const deals = await db.deal.findMany({
    where: { workspaceId, createdAt: { gte: range.start, lte: range.end } },
    select: {
      id: true,
      status: true,
      valuePaise: true,
      closedAt: true,
      source: true,
      stageId: true,
      ownerUserId: true,
      createdAt: true,
      stage: { select: { name: true } },
      owner: { select: { fullName: true } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const groupBy = config.groupBy;
  const metrics: MetricKey[] = config.metrics.length > 0 ? config.metrics : ["count"];
  const groups = new Map<string, ReportRow[]>();
  for (const d of deals) {
    const row: ReportRow = {
      day: d.createdAt.toISOString().slice(0, 10),
      week: bucketKey(d.createdAt, "week"),
      month: bucketKey(d.createdAt, "month"),
      stage: d.stage?.name ?? "—",
      stageId: d.stageId,
      owner: d.owner?.fullName ?? "—",
      ownerUserId: d.ownerUserId,
      source: d.source ?? "manual",
      status: d.status,
      valuePaise: d.valuePaise,
    };
    const key = groupBy.map((g) => JSON.stringify(row[g] ?? "")).join("|");
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const rows: ReportRow[] = [];
  for (const [key, grp] of groups.entries()) {
    const out: ReportRow = {};
    groupBy.forEach((g, i) => {
      const raw = key.split("|")[i];
      out[g] = raw === undefined ? null : raw === "" ? null : (JSON.parse(raw) as string | number | null);
    });
    for (const m of metrics) {
      if (m === "count" || m === "dealsCreated") out[m] = grp.length;
      else if (m === "dealsWon") out[m] = grp.filter((r) => r.status === "WON").length;
      else if (m === "revenue" || m === "sumValue") out[m] = grp.reduce((a, r) => a + Number(r.valuePaise ?? 0), 0);
      else out[m] = aggregateMetric(grp, m as MetricKey);
    }
    rows.push(out);
  }

  const sortBy = config.sortBy;
  if (sortBy && sortBy.field) {
    rows.sort((a, b) => {
      const av = a[sortBy.field];
      const bv = b[sortBy.field];
      if (av === bv) return 0;
      const cmp = (av ?? 0) > (bv ?? 0) ? 1 : -1;
      return sortBy.direction === "desc" ? -cmp : cmp;
    });
  }

  const summary: Record<string, number | string | null> = {};
  for (const m of metrics) {
    if (m === "count" || m === "dealsCreated") summary[m] = deals.length;
    else if (m === "dealsWon") summary[m] = deals.filter((d) => d.status === "WON").length;
    else if (m === "revenue" || m === "sumValue") summary[m] = deals.reduce((a, d) => a + d.valuePaise, 0);
    else summary[m] = null;
  }

  return {
    name: config.title ?? "Custom deals report",
    source: "deals",
    columns: [...groupBy, ...metrics],
    rows: rows.slice(0, limit),
    summary,
    chart: config.chart,
    groupBy,
    generatedAt: new Date().toISOString(),
  };
}

/** Campaigns report: calls per campaign + connect rate + deals created (best-effort). */
async function executeCampaigns(workspaceId: string, config: ReportConfig, range: DateRange, limit: number): Promise<ReportResult> {
  const campaigns = await db.campaign.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
    take: limit,
  });
  const grouped = await db.call.groupBy({
    by: ["campaignId"],
    where: { workspaceId, campaignId: { not: null }, startedAt: { gte: range.start, lte: range.end } },
    _count: { _all: true },
    _sum: { billedPaise: true },
  });
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));

  const rows: ReportRow[] = grouped.map((g) => ({
    campaign: (g.campaignId && nameById.get(g.campaignId)) ?? "—",
    calls: g._count._all,
    sumBilled: g._sum.billedPaise ?? 0,
  }));

  const metrics = config.metrics.length > 0 ? config.metrics : ["count"];
  const summary: Record<string, number | string | null> = {
    count: rows.reduce((a, r) => a + Number(r.calls ?? 0), 0),
    sumBilled: rows.reduce((a, r) => a + Number(r.sumBilled ?? 0), 0),
  };

  return {
    name: config.title ?? "Campaign report",
    source: "campaigns",
    columns: ["campaign", ...metrics],
    rows,
    summary,
    chart: config.chart,
    groupBy: config.groupBy,
    generatedAt: new Date().toISOString(),
  };
}

/** Cost report: per-provider wholesale cost breakdown (guide 03 §1). */
async function executeCost(workspaceId: string, config: ReportConfig, range: DateRange, limit: number): Promise<ReportResult> {
  const agg = await db.call.aggregate({
    where: { workspaceId, startedAt: { gte: range.start, lte: range.end } },
    _sum: {
      costTelephonyPaise: true,
      costSttPaise: true,
      costLlmPaise: true,
      costTtsPaise: true,
      billedPaise: true,
    },
  });
  const components: ReportRow[] = [
    { component: "Telephony", sumCost: agg._sum.costTelephonyPaise ?? 0 },
    { component: "STT", sumCost: agg._sum.costSttPaise ?? 0 },
    { component: "LLM", sumCost: agg._sum.costLlmPaise ?? 0 },
    { component: "TTS", sumCost: agg._sum.costTtsPaise ?? 0 },
  ];
  const totalCost = components.reduce((a, r) => a + Number(r.sumCost ?? 0), 0);
  const billed = agg._sum.billedPaise ?? 0;

  return {
    name: config.title ?? "Cost breakdown",
    source: "cost",
    columns: ["component", "sumCost"],
    rows: components.slice(0, limit),
    summary: { sumCost: totalCost, sumBilled: billed, margin: billed - totalCost, marginPercent: marginPercent(billed, totalCost) },
    chart: config.chart,
    groupBy: config.groupBy,
    generatedAt: new Date().toISOString(),
  };
}

/** Generic simple-table fallback for contacts/tasks/activities sources. */
async function executeSimpleTable(workspaceId: string, config: ReportConfig, _range: DateRange, _limit: number): Promise<ReportResult> {
  // Only calls have a full aggregation path; for unsupported sources return an
  // empty-but-valid result so the UI can show "source not supported yet".
  return {
    name: config.title ?? config.source,
    source: config.source,
    columns: config.groupBy,
    rows: [],
    summary: { count: 0 },
    chart: config.chart,
    groupBy: config.groupBy,
    generatedAt: new Date().toISOString(),
  };
}

export { MAX_ROWS };
