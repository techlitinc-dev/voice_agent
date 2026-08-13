/**
 * Cost & revenue attribution queries (docs/analytics/03).
 * DB-touching, workspace-scoped. All money is integer paise.
 */
import { db } from "../db";
import {
  type DateRange,
  type RevenueRecognition,
  type Mrr,
  computeRevenueRecognition,
  computeMrr,
  costPerMinutePaise,
  marginPercent,
  roiMultiple,
} from "../analytics";
import { formatINR } from "../money";

export type CostByAgentRow = {
  agentId: string;
  agentName: string;
  calls: number;
  avgDurationSec: number;
  avgCostPaise: number;
  costPerMinPaise: number;
  avgBilledPaise: number;
  totalWholesalePaise: number;
  totalBilledPaise: number;
  marginPct: number;
};

/** Per-agent unit economics (guide 03 §2). */
export async function getCostByAgent(workspaceId: string, range: DateRange): Promise<CostByAgentRow[]> {
  const grouped = await db.call.groupBy({
    by: ["agentId"],
    where: { workspaceId, agentId: { not: null }, startedAt: { gte: range.start, lte: range.end } },
    _count: { _all: true },
    _avg: { durationSec: true, billedPaise: true },
    _sum: {
      costTelephonyPaise: true,
      costSttPaise: true,
      costLlmPaise: true,
      costTtsPaise: true,
      billedPaise: true,
    },
  });
  const agents = await db.agent.findMany({
    where: { workspaceId, id: { in: grouped.map((g) => g.agentId).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  return grouped
    .map((g) => {
      const totalWholesale =
        (g._sum.costTelephonyPaise ?? 0) +
        (g._sum.costSttPaise ?? 0) +
        (g._sum.costLlmPaise ?? 0) +
        (g._sum.costTtsPaise ?? 0);
      const totalBilled = g._sum.billedPaise ?? 0;
      const avgCost = g._count._all > 0 ? Math.round(totalWholesale / g._count._all) : 0;
      const totalDuration = Math.round((g._avg.durationSec ?? 0) * g._count._all);
      return {
        agentId: g.agentId as string,
        agentName: (g.agentId && nameById.get(g.agentId)) ?? "Unknown",
        calls: g._count._all,
        avgDurationSec: Math.round(g._avg.durationSec ?? 0),
        avgCostPaise: avgCost,
        costPerMinPaise: costPerMinutePaise(totalWholesale, totalDuration),
        avgBilledPaise: Math.round(g._avg.billedPaise ?? 0),
        totalWholesalePaise: totalWholesale,
        totalBilledPaise: totalBilled,
        marginPct: marginPercent(totalBilled, totalWholesale),
      };
    })
    .sort((a, b) => b.avgCostPaise - a.avgCostPaise);
}

export type CampaignRoiRow = {
  campaignId: string;
  campaignName: string;
  calls: number;
  totalCostPaise: number;
  revenuePaise: number;
  marginPaise: number;
  marginPct: number;
  roi: number; // multiple, e.g. 1.57
};

/** Per-campaign ROI (guide 03 §3). */
export async function getCampaignRoi(workspaceId: string, range: DateRange, limit = 20): Promise<CampaignRoiRow[]> {
  const grouped = await db.call.groupBy({
    by: ["campaignId"],
    where: { workspaceId, campaignId: { not: null }, startedAt: { gte: range.start, lte: range.end } },
    _count: { _all: true },
    _sum: {
      costTelephonyPaise: true,
      costSttPaise: true,
      costLlmPaise: true,
      costTtsPaise: true,
      billedPaise: true,
    },
  });
  const campaigns = await db.campaign.findMany({
    where: { workspaceId, id: { in: grouped.map((g) => g.campaignId).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));

  return grouped
    .map((g) => {
      const totalCost =
        (g._sum.costTelephonyPaise ?? 0) +
        (g._sum.costSttPaise ?? 0) +
        (g._sum.costLlmPaise ?? 0) +
        (g._sum.costTtsPaise ?? 0);
      const revenue = g._sum.billedPaise ?? 0;
      const margin = revenue - totalCost;
      return {
        campaignId: g.campaignId as string,
        campaignName: (g.campaignId && nameById.get(g.campaignId)) ?? "Unknown",
        calls: g._count._all,
        totalCostPaise: totalCost,
        revenuePaise: revenue,
        marginPaise: margin,
        marginPct: marginPercent(revenue, totalCost),
        roi: roiMultiple(revenue, totalCost),
      };
    })
    .sort((a, b) => b.marginPaise - a.marginPaise)
    .slice(0, limit);
}

/** Revenue recognition: recognized, pending, deferred (guide 03 §4.1). */
export async function getRevenueRecognition(workspaceId: string, range: DateRange): Promise<RevenueRecognition> {
  const [completed, active, wallet] = await Promise.all([
    db.call.aggregate({
      where: { workspaceId, status: "COMPLETED", startedAt: { gte: range.start, lte: range.end } },
      _sum: { billedPaise: true },
    }),
    db.call.findMany({
      where: { workspaceId, status: { in: ["RINGING", "IN_PROGRESS"] } },
      select: {
        durationSec: true,
        costTelephonyPaise: true,
        costSttPaise: true,
        costLlmPaise: true,
        costTtsPaise: true,
      },
    }),
    db.wallet.findUnique({ where: { workspaceId }, select: { balancePaise: true } }),
  ]);

  const avgCostPaise = active.length > 0
    ? Math.round(active.reduce((a, c) => a + (c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise), 0) / active.length)
    : 0;

  return computeRevenueRecognition({
    completedBilledPaise: completed._sum.billedPaise ?? 0,
    activeCalls: active.length,
    avgCostPaisePerCall: avgCostPaise,
    walletBalancePaise: wallet?.balancePaise ?? 0,
  });
}

/** MRR from plan + month-to-date usage (guide 03 §4.2). */
export async function getMrr(workspaceId: string): Promise<Mrr> {
  const [subscription, monthUsage] = await Promise.all([
    db.subscription.findFirst({
      where: { workspaceId },
      include: { plan: { select: { monthlyPricePaise: true } } },
    }),
    db.call.aggregate({
      where: { workspaceId, startedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
      _sum: { billedPaise: true },
    }),
  ]);
  const planPaise = subscription?.plan.monthlyPricePaise ?? 0;
  const usagePaise = monthUsage._sum.billedPaise ?? 0;
  return computeMrr(planPaise, usagePaise);
}

export type TenantProfitabilityRow = {
  workspaceId: string;
  name: string;
  slug: string;
  revenuePaise: number;
  costPaise: number;
  marginPaise: number;
  marginPct: number;
  status: "healthy" | "low" | "losing";
};

/** Per-child-tenant profitability for resellers (guide 03 §5). */
export async function getTenantProfitability(parentWorkspaceId: string, range: DateRange): Promise<TenantProfitabilityRow[]> {
  const reseller = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId },
    include: { children: { select: { id: true, name: true, slug: true } } },
  });
  if (!reseller) return [];

  const rows: TenantProfitabilityRow[] = [];
  for (const child of reseller.children) {
    const calls = await db.call.findMany({
      where: { workspaceId: child.id, startedAt: { gte: range.start, lte: range.end } },
      select: {
        billedPaise: true,
        costTelephonyPaise: true,
        costSttPaise: true,
        costLlmPaise: true,
        costTtsPaise: true,
      },
    });
    const revenuePaise = calls.reduce((a, c) => a + c.billedPaise, 0);
    const costPaise = calls.reduce((a, c) => a + (c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise), 0);
    const marginPaise = revenuePaise - costPaise;
    const marginPct = marginPercent(revenuePaise, costPaise);
    rows.push({
      workspaceId: child.id,
      name: child.name,
      slug: child.slug,
      revenuePaise,
      costPaise,
      marginPaise,
      marginPct,
      status: marginPaise < 0 ? "losing" : marginPct < 15 ? "low" : "healthy",
    });
  }
  return rows.sort((a, b) => b.marginPaise - a.marginPaise);
}

/** Provider cost share for the donut (guide 03 §1.2). */
export async function getCostBreakdown(workspaceId: string, range: DateRange) {
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
  return {
    telephony: agg._sum.costTelephonyPaise ?? 0,
    stt: agg._sum.costSttPaise ?? 0,
    llm: agg._sum.costLlmPaise ?? 0,
    tts: agg._sum.costTtsPaise ?? 0,
    billed: agg._sum.billedPaise ?? 0,
  };
}

export { formatINR };
