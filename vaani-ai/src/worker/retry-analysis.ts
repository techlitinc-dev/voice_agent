/**
 * Smart Retries v2 analysis worker (docs/new-features/05 §3.5).
 * Nightly: for contacts with enough call history, learn per-contact optimal call
 * windows from answer patterns (day-of-week × hour-of-day) and store them on
 * Contact.optimalCallWindows so the dialer aligns retries into those windows.
 *
 * Idempotent: `lastRetryAnalysisAt` recency guard + `optimalCallWindows` write.
 * Per-contact failures never throw out of the sweep.
 *
 * Data relationship (repo convention): a contact's calls are found via
 * CampaignContact.contactId (NOT Call.fromNumber — that is the workspace DID).
 */
import { PrismaClient } from "@prisma/client";
import { scoreOptimalWindows, MIN_ANSWER_SAMPLES } from "../lib/campaign/optimal";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const ANALYSIS_RECENCY_HOURS = 24 * 7; // re-analyze a contact at most weekly

export async function analyzeRetryPatterns(take = 20): Promise<number> {
  const cutoff = new Date(Date.now() - ANALYSIS_RECENCY_HOURS * 3600_000);
  const contacts = await db.contact.findMany({
    where: {
      OR: [{ lastRetryAnalysisAt: null }, { lastRetryAnalysisAt: { lt: cutoff } }],
    },
    select: { id: true, phone: true, timezone: true, optimalCallWindows: true },
    orderBy: { createdAt: "asc" },
    take,
  });

  let analyzed = 0;
  for (const contact of contacts) {
    try {
      // The contact's answered calls, via CampaignContact → Call (lastCallId or
      // campaign-scoped), in the contact's timezone for bucketing.
      const ccs = await db.campaignContact.findMany({
        where: { contactId: contact.id },
        select: { lastCallId: true, campaignId: true },
        take: 200,
      });
      if (ccs.length === 0) continue;

      // A contact's full answer history: their latest attempt per campaign (lastCallId)
      // PLUS every call placed on their campaigns (the whole attempt history, not
      // just the last one). Call.campaignId → CampaignContact.contactId is the
      // repo's real data relationship (NOT Call.fromNumber — that is the DID).
      const callIds = ccs.map((c) => c.lastCallId).filter((x): x is string => !!x);
      const campaignIds = ccs.map((c) => c.campaignId).filter((x): x is string => !!x);
      const calls = await db.call.findMany({
        where: { OR: [{ id: { in: callIds } }, { campaignId: { in: campaignIds }, toNumber: contact.phone }] },
        select: { status: true, answeredAt: true },
        take: 400,
      });
      const answerCalls = calls.map((c) => ({
        status: c.status,
        answeredAt: c.answeredAt,
        timezone: contact.timezone,
      }));
      // Dedupe by (status, answeredAt) — the same call can match both branches.
      const seen = new Set<string>();
      const deduped = answerCalls.filter((c) => {
        const k = `${c.status}:${c.answeredAt?.getTime() ?? 0}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // Skip contacts without enough answered history (keeps the LLM/mock cheap).
      if (deduped.filter((c) => c.status === "COMPLETED" || c.answeredAt).length < MIN_ANSWER_SAMPLES) {
        await db.contact.update({
          where: { id: contact.id },
          data: { lastRetryAnalysisAt: new Date() },
        });
        continue;
      }

      const { windows, model } = await scoreOptimalWindows({ timezone: contact.timezone }, deduped);
      await db.contact.update({
        where: { id: contact.id },
        data: { optimalCallWindows: windows as object, lastRetryAnalysisAt: new Date() },
      });
      log(`[retry-analysis] contact=${contact.id} windows=${JSON.stringify(windows)} model=${model}`);
      analyzed += 1;
    } catch (e) {
      // Leave lastRetryAnalysisAt null so the next sweep retries this contact.
      console.error(`[retry-analysis] failed for contact ${contact.id}`, e);
    }
  }
  return analyzed;
}

/** Nightly cron wrapper — never throws out of the scheduler. */
export async function runRetryAnalysisSweep(): Promise<void> {
  try {
    const n = await analyzeRetryPatterns();
    log(`[retry-analysis] sweep done — ${n} contact(s) analyzed`);
  } catch (e) {
    console.error("[retry-analysis] sweep error", e);
  }
}
