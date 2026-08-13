/**
 * Call-to-deal funnel + comparison queries (docs/analytics/02 §1, §2, §5, §6).
 * DB-touching, workspace-scoped. All money is integer paise.
 */
import { db } from "../db";
import { type DateRange, type FunnelStage, biggestDropoff, funnelConversion, funnelDropoff } from "../analytics";

/** End-to-end call → answered → engaged → qualified → deal → won funnel (guide 02 §1). */
export async function getCallToDealFunnel(workspaceId: string, range: DateRange): Promise<FunnelStage[]> {
  const [totalCalls, answered, engaged, qualified, dealsCreated, dealsWon] = await Promise.all([
    db.call.count({ where: { workspaceId, startedAt: { gte: range.start, lte: range.end } } }),
    db.call.count({ where: { workspaceId, status: "COMPLETED", startedAt: { gte: range.start, lte: range.end } } }),
    db.call.count({ where: { workspaceId, status: "COMPLETED", durationSec: { gte: 60 }, startedAt: { gte: range.start, lte: range.end } } }),
    db.call.count({ where: { workspaceId, interestScore: "HOT", startedAt: { gte: range.start, lte: range.end } } }),
    db.deal.count({ where: { workspaceId, createdAt: { gte: range.start, lte: range.end } } }),
    db.deal.aggregate({
      where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
      _count: true,
      _sum: { valuePaise: true },
    }),
  ]);

  const stages: FunnelStage[] = [
    { stage: "Calls made", count: totalCalls, conversion: null },
    { stage: "Answered", count: answered, conversion: funnelConversion(answered, totalCalls) },
    { stage: "Engaged > 60s", count: engaged, conversion: funnelConversion(engaged, answered) },
    { stage: "Qualified (HOT)", count: qualified, conversion: funnelConversion(qualified, engaged) },
    { stage: "Deal created", count: dealsCreated, conversion: funnelConversion(dealsCreated, qualified) },
    {
      stage: "Deal won",
      count: dealsWon._count,
      conversion: funnelConversion(dealsWon._count, dealsCreated),
      valuePaise: dealsWon._sum.valuePaise ?? 0,
    },
  ];
  return stages;
}

export type DropoffInsight = {
  from: string;
  to: string;
  dropoffPct: number;
  suggestion: string;
};

const SUGGESTIONS: Record<string, string> = {
  "Calls made→Answered": "Most calls go unanswered. Try a different calling window, more retries, or better caller-ID reputation.",
  "Answered→Engaged > 60s": "Answered calls aren't holding. Review the opening hook and script for the first 60 seconds.",
  "Engaged > 60s→Qualified (HOT)": "Engaged calls aren't being classified HOT. Check the lead-scoring prompt and escalation rules.",
  "Qualified (HOT)→Deal created": "HOT leads aren't converting to deals. Try auto-deal creation for HOT calls and faster follow-up.",
  "Deal created→Deal won": "Deals aren't closing. Review follow-up cadence, stage discipline, and qualification before creation.",
};

/** Automatically surface the biggest leak with an action suggestion (guide 02 §2). */
export function biggestDropoffInsight(stages: FunnelStage[]): DropoffInsight | null {
  if (stages.length < 2) return null;
  const idx = biggestDropoff(stages);
  const from = stages[idx];
  const to = stages[idx + 1];
  if (from.count === 0) return null;
  return {
    from: from.stage,
    to: to.stage,
    dropoffPct: funnelDropoff(from.count, to.count),
    suggestion: SUGGESTIONS[`${from.stage}→${to.stage}`] ?? "Review this stage's inputs and follow-up process.",
  };
}

/** Per-campaign funnel comparison (guide 02 §5). */
export async function getCampaignFunnels(workspaceId: string, range: DateRange, limit = 10) {
  const campaigns = await db.campaign.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const rows = await Promise.all(campaigns.map(async (c) => {
    const where = { workspaceId, campaignId: c.id, startedAt: { gte: range.start, lte: range.end } };
    const [calls, answered, hot, dealsCreated, dealsWon] = await Promise.all([
      db.call.count({ where }),
      db.call.count({ where: { ...where, status: "COMPLETED" } }),
      db.call.count({ where: { ...where, interestScore: "HOT" } }),
      db.deal.count({ where: { workspaceId, createdAt: { gte: range.start, lte: range.end } } }),
      db.deal.count({ where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } } }),
    ]);
    return {
      campaignId: c.id,
      campaignName: c.name,
      calls,
      answered,
      hot,
      dealsCreated,
      won: dealsWon,
      callToWin: calls > 0 ? Math.round((dealsWon / calls) * 1000) / 10 : 0, // 1 decimal %
    };
  }));

  return rows
    .filter((r) => r.calls > 0)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, limit);
}

/** Per-agent funnel comparison (guide 02 §6). */
export async function getAgentFunnels(workspaceId: string, range: DateRange, limit = 10) {
  const agents = await db.agent.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  });

  const rows = await Promise.all(agents.map(async (a) => {
    const where = { workspaceId, agentId: a.id, startedAt: { gte: range.start, lte: range.end } };
    const [calls, hot, dealsCreated, dealsWon] = await Promise.all([
      db.call.count({ where }),
      db.call.count({ where: { ...where, interestScore: "HOT" } }),
      db.deal.count({ where: { workspaceId, createdFromCallId: { not: null }, createdAt: { gte: range.start, lte: range.end } } }),
      db.deal.aggregate({
        where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
        _sum: { valuePaise: true },
      }),
    ]);
    return {
      agentId: a.id,
      agentName: a.name,
      calls,
      hot,
      hotRate: calls > 0 ? Math.round((hot / calls) * 100) : 0,
      dealsCreated,
      revenuePerDeal: dealsCreated > 0 ? Math.round((dealsWon._sum.valuePaise ?? 0) / dealsCreated) : 0,
    };
  }));

  return rows
    .filter((r) => r.calls > 0)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, limit);
}
