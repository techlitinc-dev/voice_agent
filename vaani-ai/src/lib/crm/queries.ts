/**
 * CRM analytics queries (guide crm/05 §9.1). Centralized, workspace-scoped
 * queries powering /crm/analytics. All money is integer paise.
 */
import { db } from "../db";

export type DateRange = { start: Date; end: Date };

/** 30d / 90d / 12m ranges (default 30d). */
export function getDateRange(range: string | undefined): DateRange {
  const end = new Date();
  const days = range === "90d" ? 90 : range === "12m" ? 365 : 30;
  const start = new Date(Date.now() - days * 86400000);
  return { start, end };
}

/** Top-level KPIs (guide crm/05 §1.1 + §9.1). */
export async function getCrmStats(workspaceId: string, range: DateRange) {
  const [openDeals, wonDeals, lostDeals, totalDeals] = await Promise.all([
    db.deal.aggregate({ where: { workspaceId, status: "OPEN" }, _sum: { valuePaise: true }, _count: true }),
    db.deal.aggregate({ where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } }, _sum: { valuePaise: true }, _count: true }),
    db.deal.aggregate({ where: { workspaceId, status: "LOST", closedAt: { gte: range.start, lte: range.end } }, _count: true }),
    db.deal.count({ where: { workspaceId, createdAt: { gte: range.start, lte: range.end } } }),
  ]);

  const decided = wonDeals._count + lostDeals._count;
  const winRate = decided > 0 ? Math.round((wonDeals._count / decided) * 100) : 0;

  return {
    openPipelineValue: openDeals._sum.valuePaise || 0,
    openDealCount: openDeals._count,
    wonValue: wonDeals._sum.valuePaise || 0,
    wonCount: wonDeals._count,
    winRate,
    avgDealSize: wonDeals._count > 0 ? Math.round((wonDeals._sum.valuePaise || 0) / wonDeals._count) : 0,
    createdDeals: totalDeals,
  };
}

/** Pipeline funnel: deal counts + value per stage, with colors. */
export async function getFunnel(workspaceId: string) {
  const stages = await db.stage.findMany({
    where: { workspaceId },
    include: { _count: { select: { deals: true } } },
    orderBy: { order: "asc" },
  });
  const deals = await db.deal.findMany({
    where: { workspaceId },
    select: { stageId: true, valuePaise: true },
  });
  const byStage = new Map<string, number>();
  for (const d of deals) byStage.set(d.stageId, (byStage.get(d.stageId) ?? 0) + d.valuePaise);

  return stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color ?? "#94a3b8",
    dealCount: s._count.deals,
    valuePaise: byStage.get(s.id) ?? 0,
  }));
}

/** Won revenue bucketed by day/week for the area chart. */
export async function getRevenueTimeSeries(workspaceId: string, range: DateRange, by: "day" | "week" = "day") {
  const won = await db.deal.findMany({
    where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
    select: { closedAt: true, valuePaise: true },
  });
  const map = new Map<string, { date: string; valuePaise: number; count: number }>();
  for (const d of won) {
    if (!d.closedAt) continue;
    const t = d.closedAt;
    const key = by === "week"
      ? `${t.getFullYear()}-W${String(Math.ceil((t.getTime() - new Date(t.getFullYear(), 0, 1).getTime()) / (7 * 86400000))).padStart(2, "0")}`
      : t.toISOString().slice(0, 10);
    const row = map.get(key) ?? { date: key, valuePaise: 0, count: 0 };
    row.valuePaise += d.valuePaise;
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Won deals grouped by source (inbound / campaign / manual / api / ai-tool / call). */
export async function getRevenueBySource(workspaceId: string, range: DateRange) {
  const won = await db.deal.findMany({
    where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
    select: { source: true, valuePaise: true },
  });
  const map = new Map<string, { deals: number; revenue: number }>();
  for (const d of won) {
    const label = (d.source ?? "manual").split(":")[0] ?? "manual";
    const row = map.get(label) ?? { deals: 0, revenue: 0 };
    row.deals += 1;
    row.revenue += d.valuePaise;
    map.set(label, row);
  }
  return [...map.entries()].map(([source, v]) => ({
    source,
    deals: v.deals,
    revenue: v.revenue,
    avgSize: v.deals > 0 ? Math.round(v.revenue / v.deals) : 0,
  })).sort((a, b) => b.revenue - a.revenue);
}

/** Sales rep leaderboard (guide crm/05 §4.1). */
export async function getRepPerformance(workspaceId: string, range: DateRange) {
  const won = await db.deal.groupBy({
    by: ["ownerUserId"],
    where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
    _count: true,
    _sum: { valuePaise: true },
  });
  const users = await db.user.findMany({
    where: { id: { in: won.map((r) => r.ownerUserId).filter(Boolean) as string[] } },
    select: { id: true, fullName: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));

  return Promise.all(won.map(async (r) => {
    const ownerUserId = r.ownerUserId;
    if (!ownerUserId) return null;
    const totalAssigned = await db.deal.count({ where: { workspaceId, ownerUserId } });
    const openCount = await db.deal.count({ where: { workspaceId, ownerUserId, status: "OPEN" } });
    return {
      ownerUserId,
      name: nameById.get(ownerUserId) ?? "Unknown",
      dealsWon: r._count,
      revenue: r._sum.valuePaise || 0,
      winRate: totalAssigned > 0 ? Math.round((r._count / totalAssigned) * 100) : 0,
      openDeals: openCount,
    };
  })).then((rows) => rows.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => b.revenue - a.revenue));
}

/** Stage aging report (guide crm/05 §5): open deals + days in current stage.
 *  Alert levels: ok (<14d), warning (14–20d), stale (>=21d). */
export async function getStageAging(workspaceId: string) {
  const deals = await db.deal.findMany({
    where: { workspaceId, status: "OPEN" },
    include: { stage: true, owner: { select: { fullName: true } }, contact: { select: { name: true } } },
  });
  const activities = await db.activity.findMany({
    where: { workspaceId, dealId: { in: deals.map((d) => d.id) }, type: "STAGE_CHANGED" },
    select: { dealId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const lastChange = new Map<string, Date>();
  for (const a of activities) {
    if (a.dealId && !lastChange.has(a.dealId)) lastChange.set(a.dealId, a.createdAt);
  }

  return deals.map((d) => {
    const since = lastChange.get(d.id) ?? d.createdAt;
    const daysInStage = Math.max(0, Math.floor((Date.now() - since.getTime()) / 86400000));
    const alert: "stale" | "warning" | "ok" = daysInStage >= 21 ? "stale" : daysInStage >= 14 ? "warning" : "ok";
    return {
      id: d.id,
      title: d.title,
      stage: d.stage.name,
      stageColor: d.stage.color,
      valuePaise: d.valuePaise,
      daysInStage,
      alert,
      owner: d.owner?.fullName ?? null,
      contactName: d.contact?.name ?? null,
      lastActivityAt: since,
    };
  }).sort((a, b) => b.daysInStage - a.daysInStage);
}

/** Cohort analysis by deal creation month (guide crm/05 §6). */
export async function getCohorts(workspaceId: string, months = 6) {
  const since = new Date();
  since.setMonth(since.getMonth() - months + 1);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const deals = await db.deal.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    select: { id: true, createdAt: true, status: true, closedAt: true },
  });
  const activities = await db.activity.findMany({
    where: { workspaceId, type: "STAGE_CHANGED", createdAt: { gte: since } },
    select: { dealId: true, createdAt: true },
  });
  // First stage-change per deal = time to "Contacted".
  const firstChange = new Map<string, Date>();
  for (const a of activities) {
    if (!a.dealId) continue;
    const d = firstChange.get(a.dealId);
    if (!d || a.createdAt < d) firstChange.set(a.dealId, a.createdAt);
  }

  const byMonth = new Map<string, { count: number; toContactedDays: number[]; toWonDays: number[]; won: number }>();
  for (const d of deals) {
    const key = d.createdAt.toISOString().slice(0, 7);
    const row = byMonth.get(key) ?? { count: 0, toContactedDays: [], toWonDays: [], won: 0 };
    row.count += 1;
    if (d.status === "WON" && d.closedAt) {
      row.won += 1;
      row.toWonDays.push(Math.max(0, (d.closedAt.getTime() - d.createdAt.getTime()) / 86400000));
    }
    const fc = firstChange.get(d.id);
    if (fc) row.toContactedDays.push(Math.max(0, (fc.getTime() - d.createdAt.getTime()) / 86400000));
    byMonth.set(key, row);
  }

  return [...byMonth.entries()].sort().map(([month, v]) => ({
    month,
    count: v.count,
    avgToContacted: v.toContactedDays.length ? Math.round(v.toContactedDays.reduce((a, b) => a + b, 0) / v.toContactedDays.length * 10) / 10 : null,
    avgToWon: v.toWonDays.length ? Math.round(v.toWonDays.reduce((a, b) => a + b, 0) / v.toWonDays.length * 10) / 10 : null,
    winRate: v.count > 0 ? Math.round((v.won / v.count) * 100) : 0,
  }));
}

/** Voice-to-pipeline attribution (guide crm/05 §7). */
export async function getVoiceAttribution(workspaceId: string, range: DateRange) {
  const totalCalls = await db.call.count({ where: { workspaceId, startedAt: { gte: range.start, lte: range.end } } });
  const callsThatCreatedDeal = await db.deal.count({
    where: { workspaceId, createdFromCallId: { not: null }, createdAt: { gte: range.start, lte: range.end } },
  });
  const callsThatMovedStage = await db.activity.count({
    where: { workspaceId, type: { in: ["STAGE_CHANGED", "DEAL_WON", "DEAL_LOST"] }, callId: { not: null }, createdAt: { gte: range.start, lte: range.end } },
  });
  const revenueFromCalls = await db.deal.aggregate({
    where: { workspaceId, createdFromCallId: { not: null }, status: "WON" },
    _sum: { valuePaise: true },
  });
  const totalWonRevenue = await db.deal.aggregate({
    where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
    _sum: { valuePaise: true },
  });

  return {
    totalCalls,
    callsThatCreatedDeal,
    dealCreateRate: totalCalls > 0 ? Math.round((callsThatCreatedDeal / totalCalls) * 100) : 0,
    callsThatMovedStage,
    stageMoveRate: totalCalls > 0 ? Math.round((callsThatMovedStage / totalCalls) * 100) : 0,
    revenueFromCalls: revenueFromCalls._sum.valuePaise || 0,
    totalWonRevenue: totalWonRevenue._sum.valuePaise || 0,
  };
}

/** Weighted pipeline forecast (guide crm/05 §3.3). */
export async function getForecast(workspaceId: string) {
  const deals = await db.deal.findMany({
    where: { workspaceId, status: "OPEN" },
    select: { stageId: true, valuePaise: true, expectedClose: true, stage: { select: { probability: true } } },
  });
  const thisMonth = deals.reduce((s, d) => s + Math.round((d.valuePaise * (d.stage?.probability ?? 0)) / 100), 0);
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);
  const nextMonthWeighted = deals
    .filter((d) => d.expectedClose && d.expectedClose >= nextMonth && d.expectedClose <= nextMonthEnd)
    .reduce((s, d) => s + Math.round((d.valuePaise * (d.stage?.probability ?? 0)) / 100), 0);

  return { thisMonth, nextMonthWeighted };
}
