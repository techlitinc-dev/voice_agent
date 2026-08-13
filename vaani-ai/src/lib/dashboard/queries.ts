/**
 * Executive dashboard queries (docs/analytics/01-executive-dashboard.md).
 * DB-touching aggregations, workspace-scoped. All money is integer paise.
 * Raw SQL uses quoted PascalCase table names (no @@map in the Prisma schema).
 */
import { db } from "../db";
import { type DateRange, marginPercent, pctChange, sumBilledPaise, sumWholesalePaise, computeAsr } from "../analytics";
import { formatINR } from "../money";

export type CallStats = {
  total: number;
  connected: number;
  connectRate: number; // integer %
  revenuePaise: number;
  wholesalePaise: number;
  marginPct: number; // integer %
  activeUsers: number;
};

/** Core KPI aggregates for a range (executive dashboard guide 01 §2). */
export async function getCallStats(workspaceId: string, range: DateRange): Promise<CallStats> {
  const where = { workspaceId, startedAt: { gte: range.start, lte: range.end } };
  const [calls, users] = await Promise.all([
    db.call.findMany({
      where,
      select: {
        status: true,
        answeredAt: true,
        billedPaise: true,
        costTelephonyPaise: true,
        costSttPaise: true,
        costLlmPaise: true,
        costTtsPaise: true,
      },
    }),
    db.session.groupBy({
      by: ["userId"],
      where: { activeWorkspaceId: workspaceId, lastSeenAt: { gte: range.start, lte: range.end } },
      _count: { _all: true },
    }),
  ]);

  const total = calls.length;
  const connected = calls.filter((c) => c.status === "COMPLETED" || c.answeredAt !== null).length;
  const billedPaise = sumBilledPaise(calls);
  const wholesalePaise = sumWholesalePaise(calls);

  return {
    total,
    connected,
    connectRate: computeAsr(calls),
    revenuePaise: billedPaise,
    wholesalePaise,
    marginPct: marginPercent(billedPaise, wholesalePaise),
    activeUsers: users.length,
  };
}

/** KPI with trend vs the previous equal-length window (guide 01 §2.3). */
export async function getKpiWithTrend(workspaceId: string, current: DateRange, previous: DateRange) {
  const [currentStats, previousStats] = await Promise.all([
    getCallStats(workspaceId, current),
    getCallStats(workspaceId, previous),
  ]);

  return {
    totalCalls: { value: currentStats.total, trend: pctChange(currentStats.total, previousStats.total) },
    connectRate: { value: currentStats.connectRate, trend: pctChange(currentStats.connectRate, previousStats.connectRate) },
    revenue: { value: currentStats.revenuePaise, trend: pctChange(currentStats.revenuePaise, previousStats.revenuePaise) },
    marginPct: { value: currentStats.marginPct, trend: pctChange(currentStats.marginPct, previousStats.marginPct) },
    activeUsers: { value: currentStats.activeUsers, trend: pctChange(currentStats.activeUsers, previousStats.activeUsers) },
  };
}

/** Average CSAT across the range: avg(totalScore / maxScore * 100), integer %. */
export async function getCsat(workspaceId: string, range: DateRange): Promise<{ value: number; scored: number }> {
  const scores = await db.qaScore.findMany({
    where: { workspaceId, createdAt: { gte: range.start, lte: range.end } },
    select: { totalScore: true, maxScore: true },
  });
  const scored = scores.filter((s) => s.maxScore > 0);
  if (scored.length === 0) return { value: 0, scored: 0 };
  const avg = scored.reduce((a, s) => a + (s.totalScore / s.maxScore) * 100, 0) / scored.length;
  return { value: Math.round(avg), scored: scored.length };
}

export type TimeSeriesRow = {
  date: string; // YYYY-MM-DD (or YYYY-Www for weekly)
  inbound: number;
  outbound: number;
  revenuePaise: number;
  costPaise: number;
};

/** Daily (default) / weekly / monthly buckets for a range (guide 01 §3.3). */
export async function getCallsTimeSeries(workspaceId: string, range: DateRange, by: "day" | "week" | "month" = "day"): Promise<TimeSeriesRow[]> {
  const calls = await db.call.findMany({
    where: { workspaceId, startedAt: { gte: range.start, lte: range.end } },
    select: {
      startedAt: true,
      direction: true,
      billedPaise: true,
      costTelephonyPaise: true,
      costSttPaise: true,
      costLlmPaise: true,
      costTtsPaise: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const map = new Map<string, TimeSeriesRow>();
  for (const c of calls) {
    const key = bucketKey(c.startedAt, by);
    const row = map.get(key) ?? { date: key, inbound: 0, outbound: 0, revenuePaise: 0, costPaise: 0 };
    if (c.direction === "INBOUND") row.inbound += 1;
    else row.outbound += 1;
    row.revenuePaise += c.billedPaise;
    row.costPaise += c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise;
    map.set(key, row);
  }
  return [...map.values()];
}

function bucketKey(d: Date, by: "day" | "week" | "month"): string {
  if (by === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (by === "week") {
    // ISO-ish week key: year + week-of-year (Mon-based, same convention as CRM weekly view).
    const start = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((d.getTime() - start.getTime()) / (7 * 86400000));
    return `${d.getFullYear()}-W${String(Math.max(1, week)).padStart(2, "0")}`;
  }
  return d.toISOString().slice(0, 10);
}

export type AgentRow = { agentId: string | null; agentName: string; calls: number; billedPaise: number };

/** Calls + revenue grouped by agent (guide 01 §4.1). */
export async function getCallsByAgent(workspaceId: string, range: DateRange): Promise<AgentRow[]> {
  const grouped = await db.call.groupBy({
    by: ["agentId"],
    where: { workspaceId, startedAt: { gte: range.start, lte: range.end } },
    _count: { _all: true },
    _sum: { billedPaise: true },
  });
  const agents = await db.agent.findMany({
    where: { workspaceId, id: { in: grouped.map((g) => g.agentId).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  return grouped
    .map((g) => ({
      agentId: g.agentId,
      agentName: (g.agentId && nameById.get(g.agentId)) ?? "Unassigned",
      calls: g._count._all,
      billedPaise: g._sum.billedPaise ?? 0,
    }))
    .sort((a, b) => b.calls - a.calls);
}

export type CampaignRow = {
  campaignId: string | null;
  campaignName: string;
  calls: number;
  connected: number;
  billedPaise: number;
  connectRate: number; // integer % connected
};

/** Calls + connect rate per campaign, with a conversion overlay (guide 01 §4.2). */
export async function getCallsByCampaign(workspaceId: string, range: DateRange): Promise<CampaignRow[]> {
  const grouped = await db.call.groupBy({
    by: ["campaignId"],
    where: { workspaceId, startedAt: { gte: range.start, lte: range.end } },
    _count: { _all: true },
    _sum: { billedPaise: true },
  });
  const campaigns = await db.campaign.findMany({
    where: { workspaceId, id: { in: grouped.map((g) => g.campaignId).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const connectedByCampaign = await db.call.groupBy({
    by: ["campaignId"],
    where: {
      workspaceId,
      campaignId: { in: grouped.map((g) => g.campaignId).filter(Boolean) as string[] },
      startedAt: { gte: range.start, lte: range.end },
      status: "COMPLETED",
    },
    _count: { _all: true },
  });
  const connectedMap = new Map(connectedByCampaign.map((c) => [c.campaignId, c._count._all]));

  return grouped
    .map((g) => {
      const calls = g._count._all;
      const connected = g.campaignId ? (connectedMap.get(g.campaignId) ?? 0) : 0;
      return {
        campaignId: g.campaignId,
        campaignName: (g.campaignId && nameById.get(g.campaignId)) ?? "Direct / no campaign",
        calls,
        connected,
        billedPaise: g._sum.billedPaise ?? 0,
        connectRate: calls > 0 ? Math.round((connected / calls) * 100) : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export type SourceRow = { source: string; calls: number };

/** Call volume by source: inbound DIDs, campaigns, marketplace, API (guide 01 §4.3). */
export async function getCallsBySource(workspaceId: string, range: DateRange): Promise<SourceRow[]> {
  const calls = await db.call.findMany({
    where: { workspaceId, startedAt: { gte: range.start, lte: range.end } },
    select: { campaignId: true, direction: true, fromNumber: true, toNumber: true },
  });
  const map = new Map<string, number>();
  for (const c of calls) {
    let source = "API";
    if (c.campaignId) source = "Campaign";
    else if (c.direction === "INBOUND") source = "Inbound DID";
    map.set(source, (map.get(source) ?? 0) + 1);
  }
  return [...map.entries()].map(([source, count]) => ({ source, calls: count })).sort((a, b) => b.calls - a.calls);
}

// ---------- Alerts (guide 01 §1 ROW 4) ----------

export type AlertItem = { id: string; severity: "danger" | "warning" | "info"; title: string; detail: string };

/** Operational alerts: low wallet, stale deals, overdue tasks, failed calls. */
export async function getAlerts(workspaceId: string): Promise<AlertItem[]> {
  const alerts: AlertItem[] = [];

  const wallet = await db.wallet.findUnique({ where: { workspaceId } });
  if (wallet && wallet.balancePaise < wallet.lowBalanceAlertPaise) {
    alerts.push({
      id: "low-wallet",
      severity: "danger",
      title: "Low wallet balance",
      detail: `Balance ${formatINR(wallet.balancePaise)} is below your alert threshold of ${formatINR(wallet.lowBalanceAlertPaise)}.`,
    });
  }

  const [staleDeals, overdueTasks, failedToday] = await Promise.all([
    db.deal.count({ where: { workspaceId, status: "OPEN", updatedAt: { lt: new Date(Date.now() - 21 * 86400000) } } }),
    db.task.count({ where: { workspaceId, status: "PENDING", dueAt: { lt: new Date() } } }),
    db.call.count({
      where: { workspaceId, status: "FAILED", startedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    }),
  ]);

  if (staleDeals > 0) {
    alerts.push({ id: "stale-deals", severity: "warning", title: `${staleDeals} stale deal${staleDeals > 1 ? "s" : ""}`, detail: "Open deals with no update in 21+ days." });
  }
  if (overdueTasks > 0) {
    alerts.push({ id: "overdue-tasks", severity: "warning", title: `${overdueTasks} overdue task${overdueTasks > 1 ? "s" : ""}`, detail: "Pending tasks past their due date." });
  }
  if (failedToday > 0) {
    alerts.push({ id: "failed-calls", severity: "info", title: `${failedToday} failed call${failedToday > 1 ? "s" : ""} in 24h`, detail: "Calls that ended in FAILED status." });
  }

  return alerts;
}

// ---------- Active calls (guide 01 §1 ROW 4 + §5) ----------

export type ActiveCall = {
  id: string;
  fromNumber: string;
  toNumber: string;
  direction: string;
  status: string;
  agentName: string;
  durationSec: number;
  startedAt: string;
};

/** In-progress / ringing calls for the live tiles. */
export async function getActiveCalls(workspaceId: string): Promise<{ calls: ActiveCall[]; queueDepth: number }> {
  const [calls, queued] = await Promise.all([
    db.call.findMany({
      where: { workspaceId, status: { in: ["RINGING", "IN_PROGRESS"] } },
      include: { agent: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    db.call.count({ where: { workspaceId, status: "RINGING" } }),
  ]);
  return {
    calls: calls.map((c) => ({
      id: c.id,
      fromNumber: c.fromNumber,
      toNumber: c.toNumber,
      direction: c.direction,
      status: c.status,
      agentName: c.agent?.name ?? "—",
      durationSec: c.durationSec,
      startedAt: c.startedAt.toISOString(),
    })),
    queueDepth: queued,
  };
}
