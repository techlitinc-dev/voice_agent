/**
 * Scheduler tick: every 30s per RUNNING campaign. Reads the campaign FRESH each
 * tick (mid-flight script edits take effect on the next batch), enforces windows
 * (per-contact timezone, day-of-week), TRAI hours, consent, DNC, pacing
 * (ramp-up + answer-rate adaptive), slot budget (concurrency / predictive), and
 * pool rotation with caps. Claims rows and enqueues `dial` jobs.
 */
import type { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { getDialerQueue, stopCampaignScheduler, DIAL_JOB, type SchedulerJobData } from "../lib/queue";
import { rampCpm, adaptiveCpm, answerRateFromCalls, tickBatchSize, predictiveSlots } from "../lib/campaign/pacing";
import { isWithinCallingWindows, isWithinTraiHours, parseTimezoneWindows, effectiveTimezone } from "../lib/campaign/windows";
import { pickNumberRoundRobin, type PoolNumber } from "../lib/campaign/pool";
import { consentBlocks, poolUsesPromotionalSeries } from "../lib/campaign/compliance";
import { emitWebhookEvent } from "../lib/webhooks";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const TRAI_ENFORCE = process.env.TRAI_HOURS_ENFORCE !== "false"; // default ON
const CONSENT_ON = process.env.REQUIRE_CONSENT_FOR_PROMOTIONAL === "true";

/** Round-robin cursor per pool id (worker-process memory; a restart just re-enters
 *  rotation at the first number — acceptable, caps are the real protection). */
const lastUsedByPool = new Map<string, string>();

export async function schedulerTick(job: Job<SchedulerJobData>): Promise<void> {
  const { campaignId } = job.data;
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      agent: { select: { id: true, name: true } },
      pool: { include: { numbers: true } },
    },
  });
  if (!campaign || campaign.status !== "RUNNING") {
    await stopCampaignScheduler(campaignId);
    return;
  }

  const now = new Date();
  const tw = parseTimezoneWindows(campaign.timezoneWindows);
  const windowInput = {
    now,
    windowStart: campaign.callingWindowStart,
    windowEnd: campaign.callingWindowEnd,
    timezoneWindows: tw,
  };

  // Fast path: campaign-default timezone outside the window AND no per-contact
  // timezones in play → idle. (Per-contact checks below are authoritative.)
  if (!isWithinCallingWindows({ ...windowInput, contactTimezone: null })) {
    log(`[scheduler] ${campaign.name}: outside default calling window, idle`);
    return;
  }

  // Pacing: ramp-up from startedAt, then answer-rate adaptation.
  const startedAt = campaign.startedAt ?? campaign.createdAt;
  let cpm = rampCpm({ capCpm: campaign.callsPerMinute, startedAt, now });
  const recentCalls = await db.call.findMany({
    where: { workspaceId: campaign.workspaceId, campaignId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { answeredAt: true },
  });
  const answerRate = answerRateFromCalls(recentCalls);
  cpm = adaptiveCpm(cpm, answerRate);

  // Slot budget: concurrency cap, optionally over-booked (predictive).
  const inFlight = await db.campaignContact.count({ where: { campaignId, status: "DIALING" } });
  const slots = predictiveSlots({
    concurrency: campaign.concurrency,
    inFlight,
    predictive: campaign.predictiveDialing,
  });
  const batch = Math.min(tickBatchSize(cpm), slots);
  if (batch <= 0) {
    log(`[scheduler] ${campaign.name}: no free slots (inFlight=${inFlight}/${campaign.concurrency}), idle`);
    return;
  }

  const due = await db.campaignContact.findMany({
    where: {
      campaignId,
      OR: [
        { status: "PENDING" },
        { status: "RETRY_SCHEDULED", nextAttemptAt: { lte: now } },
      ],
    },
    include: { contact: { select: { phone: true, dnc: true, optOutAt: true, timezone: true, consentAt: true } } },
    orderBy: { updatedAt: "asc" },
    take: batch * 5, // over-fetch: per-contact filters below drop some
  });

  if (due.length === 0) {
    const remaining = await db.campaignContact.count({
      where: { campaignId, status: { in: ["PENDING", "RETRY_SCHEDULED", "DIALING"] } },
    });
    if (remaining === 0) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED", finishedAt: new Date() },
      });
      await stopCampaignScheduler(campaignId);
      await emitWebhookEvent(campaign.workspaceId, "campaign.finished", {
        campaignId, name: campaign.name, status: "COMPLETED",
      });
      log(`[scheduler] ${campaign.name}: COMPLETED`);
    }
    return;
  }

  // Batch DNC lookup for the candidate phones (belt-and-suspenders over the flags).
  const phones = due.map((d) => d.contact.phone);
  const dncEntries = await db.dncEntry.findMany({
    where: { workspaceId: campaign.workspaceId, phone: { in: phones } },
    select: { phone: true },
  });
  const dncPhones = new Set(dncEntries.map((d) => d.phone));

  const poolNumbers: PoolNumber[] = (campaign.pool?.numbers ?? []).map((n) => ({
    id: n.id,
    number: n.number,
    numberType: n.numberType,
    dailyCallCap: n.dailyCallCap,
    lifetimeCallCap: n.lifetimeCallCap,
    dailyCallsUsed: n.dailyCallsUsed,
    lifetimeCallsUsed: n.lifetimeCallsUsed,
  }));
  const traiGuard = TRAI_ENFORCE && poolUsesPromotionalSeries(poolNumbers);

  let claimed = 0;
  for (const cc of due) {
    if (claimed >= batch) break;
    const c = cc.contact;

    // Schedule-time scrubs (dial time re-checks everything).
    if (c.dnc || c.optOutAt || dncPhones.has(c.phone)) {
      await db.campaignContact.updateMany({
        where: { id: cc.id, status: { in: ["PENDING", "RETRY_SCHEDULED"] } },
        data: { status: "SKIPPED_DNC", lastResult: "skipped:dnc" },
      });
      continue;
    }
    if (consentBlocks({ consentAt: c.consentAt }, campaign.type, CONSENT_ON)) {
      await db.campaignContact.updateMany({
        where: { id: cc.id, status: { in: ["PENDING", "RETRY_SCHEDULED"] } },
        data: { status: "SKIPPED_DNC", lastResult: "skipped:no-consent" },
      });
      continue;
    }
    const tz = effectiveTimezone({ ...windowInput, contactTimezone: c.timezone });
    if (!isWithinCallingWindows({ ...windowInput, contactTimezone: c.timezone })) continue; // retry next tick
    if (traiGuard && !isWithinTraiHours(now, tz)) continue; // TRAI 09:00–21:00 hard guardrail

    // Pool rotation (only when the campaign has a pool).
    let phoneNumberId: string | undefined;
    if (campaign.poolId) {
      const picked = pickNumberRoundRobin(poolNumbers, lastUsedByPool.get(campaign.poolId) ?? null);
      if (!picked) {
        log(`[scheduler] ${campaign.name}: POOL EXHAUSTED (all numbers capped) — pausing dials this tick`);
        break;
      }
      // Claim capacity atomically; re-check caps in the WHERE clause.
      const capClaim = await db.phoneNumber.updateMany({
        where: {
          id: picked.id,
          OR: [{ dailyCallCap: null }, { dailyCallsUsed: { lt: picked.dailyCallCap ?? 0 } }],
        },
        data: { dailyCallsUsed: { increment: 1 }, lifetimeCallsUsed: { increment: 1 } },
      });
      if (capClaim.count === 0) {
        picked.dailyCallsUsed = picked.dailyCallCap ?? picked.dailyCallsUsed; // mark capped locally
        continue;
      }
      picked.dailyCallsUsed += 1;
      picked.lifetimeCallsUsed += 1;
      lastUsedByPool.set(campaign.poolId, picked.id);
      phoneNumberId = picked.id;
    }

    // Claim the contact row (optimistic: status unchanged since read).
    const claim = await db.campaignContact.updateMany({
      where: { id: cc.id, status: cc.status },
      data: { status: "DIALING" },
    });
    if (claim.count !== 1) {
      if (phoneNumberId) {
        await db.phoneNumber.update({ where: { id: phoneNumberId }, data: { dailyCallsUsed: { decrement: 1 }, lifetimeCallsUsed: { decrement: 1 } } });
      }
      continue;
    }
    await getDialerQueue().add(DIAL_JOB, {
      campaignId,
      campaignContactId: cc.id,
      workspaceId: campaign.workspaceId,
      ...(phoneNumberId ? { phoneNumberId } : {}),
    });
    claimed++;
  }
  if (claimed > 0) {
    log(`[scheduler] ${campaign.name}: enqueued ${claimed} dial(s) (cpm=${cpm}, answerRate=${answerRate ?? "n/a"}, slots=${slots})`);
  }
}
