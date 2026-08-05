/**
 * node-cron maintenance (worker process):
 * - sweepDueCallbacks: PENDING CallbackTasks due now → enqueue `callback-dial`
 *   (safety net alongside the delayed jobs enqueued at creation time; the
 *   callbackDialJob claim makes double-enqueue harmless).
 * - sweepPostCalls: post-call intelligence + reconciliation on campaign calls.
 * - resetDailyCaps: nightly PhoneNumber.dailyCallsUsed = 0.
 *
 * Webhook emission note: `call.completed` etc. are emitted by guide 06's Dograh
 * webhook receiver — this module NEVER re-emits call-level events. It only emits
 * campaign-domain events (campaign.finished, lead.qualified, contact.opted-out)
 * and transfer.requested for the TransferRequests it creates itself.
 */
import { PrismaClient } from "@prisma/client";
import { getDialerQueue, CALLBACK_DIAL_JOB } from "../lib/queue";
import { buildCallbackDialJob } from "../lib/dialJobs"; // guide 06 producer helpers
import { parseRetryPolicy, computeNextRetry, type Disposition } from "../lib/campaign/retry";
import { shouldSendWhatsAppFallback } from "../lib/campaign/fallback";
import { sendWhatsAppGated } from "./whatsapp";
import { detectOptOut, needsHumanEscalation } from "../lib/campaign/scoring";
import { effectiveTimezone } from "../lib/campaign/windows";
import { classifyInterest, extractCallback } from "./llm";
import { emitWebhookEvent } from "../lib/webhooks";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Nightly: reset per-number daily counters (readme §6.1 daily caps). */
export async function resetDailyCaps(): Promise<void> {
  const res = await db.phoneNumber.updateMany({
    where: { dailyCallsUsed: { gt: 0 } },
    data: { dailyCallsUsed: 0 },
  });
  log(`[cron] daily cap reset: ${res.count} number(s)`);
}

/** Every minute: enqueue due callbacks. */
export async function sweepDueCallbacks(): Promise<void> {
  const due = await db.callbackTask.findMany({
    where: { status: "PENDING", dueAt: { lte: new Date() } },
    take: 20,
  });
  for (const t of due) {
    const jobDef = buildCallbackDialJob(
      { workspaceId: t.workspaceId, callbackTaskId: t.id, phone: t.phone, note: t.note ?? undefined, dueAt: t.dueAt },
      new Date()
    );
    // jobId dedupes repeat sweeps; a same-task delayed job from guide 06 may still
    // coexist — the callbackDialJob PENDING→DONE claim makes that harmless.
    await getDialerQueue().add(CALLBACK_DIAL_JOB, jobDef.data, { ...jobDef.opts, delay: 0, jobId: `cb-${t.id}` });
    log(`[cron] callback due → enqueued ${t.phone} (task ${t.id})`);
  }
}

/** Reconcile a real call whose webhook outcome needs a retry (no-answer/busy/
 *  voicemail) but whose CampaignContact was marked COMPLETED at trigger time. */
async function reconcileCall(call: {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  status: string;
  amdResult: string;
  toNumber: string;
}): Promise<void> {
  if (!call.campaignId) return;
  const cc = await db.campaignContact.findFirst({
    where: { campaignId: call.campaignId, lastCallId: call.id, status: "COMPLETED" },
    include: { campaign: true, contact: { select: { phone: true, name: true } } },
  });
  if (!cc) return; // already reconciled

  const disposition: Disposition =
    call.status === "VOICEMAIL" || call.amdResult === "MACHINE" ? "voicemail"
    : call.status === "BUSY" ? "busy"
    : "no-answer";
  const policy = parseRetryPolicy(cc.campaign.retryPolicy);
  const defaults = { maxAttempts: cc.campaign.maxAttempts, retryDelayMin: cc.campaign.retryDelayMin };
  const next = computeNextRetry(policy, disposition, cc.attempts, defaults, new Date(), Math.random);

  await db.campaignContact.update({
    where: { id: cc.id },
    data: {
      lastResult: disposition,
      status: next.retry ? "RETRY_SCHEDULED" : "FAILED",
      nextAttemptAt: next.nextAttemptAt,
    },
  });
  log(`[postcall] reconcile ${call.toNumber}: ${disposition} → ${next.retry ? "retry" : "FAILED"}`);

  const fb = shouldSendWhatsAppFallback({
    retryPolicyJson: cc.campaign.retryPolicy,
    disposition,
    retryExhausted: !next.retry,
  });
  if (fb.send && fb.templateId) {
    const tpl = await db.whatsAppTemplate.findFirst({
      where: { id: fb.templateId, workspaceId: call.workspaceId, status: "APPROVED" },
    });
    if (tpl) {
      const res = await sendWhatsAppGated({ to: call.toNumber, template: tpl.name, params: [cc.contact.name ?? "Customer"] });
      log(`[postcall] whatsapp-fallback to=${call.toNumber} ok=${res.ok}${res.dryRun ? " (dry-run)" : ""}${res.error ? ` error=${res.error}` : ""}`);
    }
  }
}

/** Opt-out cascade (readme §11): "stop calling me" honored instantly — DncEntry +
 *  contact flag + removal from ALL active campaign queues in the workspace. */
async function optOutCascade(input: { workspaceId: string; phone: string; callId: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.dncEntry.upsert({
      where: { workspaceId_phone: { workspaceId: input.workspaceId, phone: input.phone } },
      update: {},
      create: { workspaceId: input.workspaceId, phone: input.phone, source: "OPT_OUT", reason: `mid-call opt-out (call ${input.callId})` },
    });
    await tx.contact.updateMany({
      where: { workspaceId: input.workspaceId, phone: input.phone },
      data: { dnc: true, optOutAt: new Date() },
    });
    const removed = await tx.campaignContact.updateMany({
      where: {
        status: { in: ["PENDING", "RETRY_SCHEDULED"] },
        contact: { workspaceId: input.workspaceId, phone: input.phone },
        campaign: { workspaceId: input.workspaceId, status: { in: ["DRAFT", "RUNNING", "PAUSED"] } },
      },
      data: { status: "SKIPPED_DNC", lastResult: "skipped:opt-out" },
    });
    log(`[postcall] OPT-OUT cascade ${input.phone}: removed from ${removed.count} campaign queue(s)`);
  });
  await emitWebhookEvent(input.workspaceId, "contact.opted-out", { phone: input.phone, callId: input.callId });
}

/** Post-call sweep (every minute): interest scoring, callback extraction, opt-out
 *  cascade, sentiment escalation, and retry reconciliation. Processes calls whose
 *  interestReason is still null (marker: we always write it after processing). */
export async function sweepPostCalls(): Promise<void> {
  // 1) Retry reconciliation for ended-but-unsuccessful real calls.
  const unsuccessful = await db.call.findMany({
    where: {
      direction: "OUTBOUND",
      campaignId: { not: null },
      OR: [{ status: { in: ["NO_ANSWER", "BUSY", "VOICEMAIL"] } }, { amdResult: "MACHINE" }],
    },
    take: 20,
    orderBy: { createdAt: "asc" },
  });
  for (const call of unsuccessful) await reconcileCall(call);

  // 2) Intelligence on completed calls with a transcript.
  const done = await db.call.findMany({
    where: {
      direction: "OUTBOUND",
      campaignId: { not: null },
      status: "COMPLETED",
      interestScore: null,
      interestReason: null,
      transcript: { not: null },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
    include: { campaign: { select: { type: true, timezoneWindows: true } } },
  });
  for (const call of done) {
    const transcript = call.transcript ?? "";
    const contact = await db.contact.findFirst({
      where: { workspaceId: call.workspaceId, phone: call.toNumber },
      select: { id: true, timezone: true },
    });

    // a) interest scoring (LLM; dry-run mock)
    const scored = await classifyInterest({ transcript, campaignType: call.campaign?.type ?? "LEAD_QUALIFICATION" });
    await db.call.update({
      where: { id: call.id },
      data: scored
        ? { interestScore: scored.score, interestReason: scored.reason }
        : { interestReason: "unscored" }, // marker so we don't reprocess forever
    });
    if (scored?.score === "HOT") {
      await emitWebhookEvent(call.workspaceId, "lead.qualified", {
        callId: call.id, phone: call.toNumber, score: "HOT", reason: scored.reason,
      });
    }

    // b) opt-out cascade — runs BEFORE callback scheduling (compliance first).
    //    An opted-out caller gets NO callback; an angry one still gets the human flag.
    const optedOut = detectOptOut({ outcome: call.outcome, transcript });
    if (optedOut) {
      await optOutCascade({ workspaceId: call.workspaceId, phone: call.toNumber, callId: call.id });
    }

    // c) callback extraction ("call me tomorrow at 5") — skipped after opt-out
    const cb = optedOut ? { requested: false as const } : await extractCallback({
      transcript,
      timezone: effectiveTimezone({
        now: new Date(),
        contactTimezone: contact?.timezone ?? null,
        windowStart: "09:00",
        windowEnd: "19:00",
        timezoneWindows: null,
      }),
      now: new Date(),
    });
    if (cb.requested && cb.dueAt) {
      const task = await db.callbackTask.create({
        data: {
          workspaceId: call.workspaceId,
          contactId: contact?.id ?? null,
          campaignId: call.campaignId,
          callId: call.id,
          phone: call.toNumber,
          note: cb.note ?? "callback requested mid-call",
          dueAt: cb.dueAt,
        },
      });
      const jobDef = buildCallbackDialJob(
        { workspaceId: call.workspaceId, callbackTaskId: task.id, phone: call.toNumber, note: task.note ?? undefined, dueAt: cb.dueAt },
        new Date()
      );
      await getDialerQueue().add(CALLBACK_DIAL_JOB, jobDef.data, { ...jobDef.opts, jobId: `cb-${task.id}` });
      log(`[postcall] callback scheduled ${call.toNumber} at ${cb.dueAt.toISOString()}`);
    }

    // d) sentiment escalation → human flag (guide 06 TransferRequest contract)
    if (needsHumanEscalation({ sentiment: call.sentiment, outcome: call.outcome, transcript })) {
      await db.transferRequest.create({
        data: {
          workspaceId: call.workspaceId,
          callId: call.id,
          queue: "escalations",
          reason: "angry/abusive caller on outbound call — polite exit done by AI, human follow-up needed",
          contextSnapshot: {
            summary: call.summary ?? null,
            sentiment: call.sentiment ?? null,
            transcriptTail: transcript.slice(-1000),
          },
        },
      });
      await emitWebhookEvent(call.workspaceId, "transfer.requested", { callId: call.id, queue: "escalations" });
      log(`[postcall] escalation → TransferRequest for call ${call.id}`);
    }
  }
}
