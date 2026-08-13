/**
 * Lead scoring engine (guide crm/04 §2). Computes a 0–100 score per contact
 * from six weighted factors, stores it in LeadScore (one row per contact).
 * Max = 100. Grade: A (80+), B (60+), C (40+), D (<40).
 */
import { db } from "../db";

export type ScoreFactors = {
  intent: number;         // 0–30  — latest call interest
  engagement: number;     // 0–25  — call count + duration
  recency: number;        // 0–15  — last call age
  pipeline: number;       // 0–15  — deal stage progress
  value: number;          // 0–10  — open deal value
  responsiveness: number; // 0–5   — inbound ratio
};

export const MAX_SCORE = 100;

export function gradeForScore(score: number): string {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

export function scoreIntent(interest?: string | null): number {
  if (interest === "HOT") return 30;
  if (interest === "WARM") return 15;
  return 0;
}

export function scoreEngagement(callCount: number): number {
  if (callCount >= 7) return 25;
  if (callCount >= 4) return 15;
  if (callCount >= 2) return 10;
  if (callCount >= 1) return 5;
  return 0;
}

export function scoreRecency(lastCallAt?: Date | null): number {
  if (!lastCallAt) return 0;
  const hoursAgo = (Date.now() - lastCallAt.getTime()) / 3600000;
  if (hoursAgo < 24) return 15;
  if (hoursAgo < 72) return 12;
  if (hoursAgo < 168) return 8;
  if (hoursAgo < 720) return 4;
  return 0;
}

export function scorePipeline(stageNames: (string | null | undefined)[]): number {
  // Best stage counts: Qualified=5, Negotiation=10, Won=15.
  let best = 0;
  for (const name of stageNames) {
    const n = (name ?? "").toLowerCase();
    if (n.includes("won")) best = Math.max(best, 15);
    else if (n.includes("negotiat")) best = Math.max(best, 10);
    else if (n.includes("qualif")) best = Math.max(best, 5);
  }
  return best;
}

export function scoreValue(openValuesPaise: number[]): number {
  const max = Math.max(0, ...openValuesPaise);
  if (max >= 50_000_000) return 10; // ₹50L+
  if (max >= 500_000) return 8;     // ₹5L+
  if (max >= 50_000) return 5;      // ₹50K+
  if (max > 0) return 2;            // < ₹50K
  return 0;
}

export function scoreResponsiveness(callCount: number, inboundCount: number): number {
  if (callCount > 0 && inboundCount / callCount > 0.5) return 5;
  return 0;
}

/** Recompute + upsert the LeadScore for one contact (guide crm/04 §2.3). */
export async function recomputeLeadScore(workspaceId: string, contactId: string): Promise<void> {
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, phone: true, deals: { select: { status: true, valuePaise: true, stage: { select: { name: true } } } } },
  });
  if (!contact) return;

  const calls = await db.call.findMany({
    where: { workspaceId, OR: [{ fromNumber: contact.phone }, { toNumber: contact.phone }] },
    select: { direction: true, startedAt: true, durationSec: true, interestScore: true },
  });

  const inboundCount = calls.filter((c) => c.direction === "INBOUND").length;
  const lastCall = calls.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

  const openValues = contact.deals.filter((d) => d.status === "OPEN").map((d) => d.valuePaise);
  const stageNames = contact.deals.map((d) => d.stage?.name);

  const factors: ScoreFactors = {
    intent: scoreIntent(lastCall?.interestScore),
    engagement: scoreEngagement(calls.length),
    recency: scoreRecency(lastCall?.startedAt),
    pipeline: scorePipeline(stageNames),
    value: scoreValue(openValues),
    responsiveness: scoreResponsiveness(calls.length, inboundCount),
  };

  const score = Object.values(factors).reduce((a, b) => a + b, 0);
  const grade = gradeForScore(score);

  const reasons: string[] = [];
  if (lastCall?.interestScore === "HOT") reasons.push("HOT interest on last call");
  else if (lastCall?.interestScore === "WARM") reasons.push("WARM interest on last call");
  if (calls.length >= 2) reasons.push(`${calls.length} total calls (engaged)`);
  if (lastCall) {
    const days = Math.max(0, Math.round((Date.now() - lastCall.startedAt.getTime()) / 86400000));
    reasons.push(days === 0 ? "Contacted today" : `Last contacted ${days} day${days === 1 ? "" : "s"} ago`);
  }
  if (factors.pipeline >= 5) reasons.push(`Pipeline stage: ${stageNames.find((n) => n) ?? ""}`);
  if (openValues.length > 0) reasons.push(`Open deal value ${openValues[0]}`);

  await db.leadScore.upsert({
    where: { contactId },
    create: { workspaceId, contactId, score, grade, reasons, factors: factors as object },
    update: { score, grade, reasons, factors: factors as object, computedAt: new Date() },
  });
}

/** Recompute scores for all contacts with any activity in the last N days. */
export async function recomputeAllLeadScores(workspaceId: string, touchedDays = 7): Promise<number> {
  const since = new Date(Date.now() - touchedDays * 86400000);
  const contacts = await db.contact.findMany({
    where: {
      workspaceId,
      OR: [
        { createdAt: { gte: since } },
        { activities: { some: { createdAt: { gte: since } } } },
      ],
    },
    select: { id: true },
  });
  for (const c of contacts) {
    try {
      await recomputeLeadScore(workspaceId, c.id);
    } catch (e) {
      console.error(`[scoring] failed for contact ${c.id}`, e);
    }
  }
  return contacts.length;
}
