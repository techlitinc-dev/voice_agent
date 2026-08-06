/**
 * Campaign worker. Run with: npm run worker
 * - BullMQ: campaign-scheduler (ticks), campaign-dialer (dial / callback-dial /
 *   manual-dial), whatsapp-send (throttled template sends).
 * - node-cron: callback sweep + post-call sweep (every minute), daily cap reset
 *   (03:00).
 * CAMPAIGN_DRY_RUN=true simulates dials AND post-call LLM results — no Dograh, no
 * OpenRouter, no cost.
 */
import { Worker } from "bullmq";
import cron from "node-cron";
import { createRedisConnection, QUEUES } from "../lib/queue";
import type { DialJobData, CallbackDialJobData, ManualDialJobData, WhatsAppSendJobData } from "../lib/queue";
import { DIAL_JOB, CALLBACK_DIAL_JOB, MANUAL_DIAL_JOB } from "../lib/queue";
import { schedulerTick } from "./campaignTick";
import { dialJob, callbackDialJob, manualDialJob, whatsappSendJob } from "./dial";
import { resetDailyCaps, sweepDueCallbacks, sweepPostCalls } from "./maintenance";
import {
  chargeMonthlyRentals,
  chargeMonthlyAddOns,
  chargeMonthlyPlanFees,
  generateAllMonthlyInvoices,
} from "./billing";
import { runAutoTopUpSweep } from "../lib/autotopup";
import { db } from "../lib/db";
import { ingestRecording } from "../lib/storage";
import { postCallSweep } from "./postcall";
import { deliverWebhooks } from "./webhook-delivery";
import { startCronJobs } from "./cron";
import { gdprSweep } from "./gdpr";

const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false"; // default true — safe
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Sweep calls whose recording is still a pending remote URL; ingest into MinIO. */
async function recordingSweeper() {
  const pending = await db.call.findMany({
    where: { recordingKey: { startsWith: "pending:" } },
    take: 10,
    orderBy: { createdAt: "asc" },
  });
  for (const call of pending) {
    const sourceUrl = call.recordingKey!.slice("pending:".length);
    const key = `${call.workspaceId}/${call.id}.wav`;
    try {
      await ingestRecording(sourceUrl, key);
      await db.call.update({ where: { id: call.id }, data: { recordingKey: key } });
      log(`[recordings] ingested ${call.id}`);
    } catch (e) {
      console.error(`[recordings] failed for ${call.id}`, e);
      // Leave as pending; retried on next sweep. After 24h of failures, give up:
      if (Date.now() - call.createdAt.getTime() > 24 * 3600 * 1000) {
        await db.call.update({ where: { id: call.id }, data: { recordingKey: null } });
      }
    }
  }
}

async function main() {
  log(`worker starting (CAMPAIGN_DRY_RUN=${DRY_RUN}, TRAI_HOURS_ENFORCE=${process.env.TRAI_HOURS_ENFORCE ?? "true"}, REQUIRE_CONSENT=${process.env.REQUIRE_CONSENT_FOR_PROMOTIONAL ?? "false"})`);
  const connection = createRedisConnection();

  new Worker(QUEUES.scheduler, schedulerTick, { connection, concurrency: 5 });

  new Worker<DialJobData | CallbackDialJobData | ManualDialJobData>(
    QUEUES.dialer,
    async (job) => {
      switch (job.name) {
        case DIAL_JOB:
          return dialJob(job as never);
        case CALLBACK_DIAL_JOB:
          return callbackDialJob(job as never);
        case MANUAL_DIAL_JOB:
          return manualDialJob(job as never);
        default:
          log(`[dialer] unknown job name "${job.name}" — ignored`);
      }
    },
    { connection, concurrency: 10 }
  );

  new Worker<WhatsAppSendJobData>(QUEUES.whatsapp, whatsappSendJob, {
    connection,
    concurrency: 2,
    limiter: { max: 5, duration: 1000 }, // 5 msgs/sec — provider-friendly throttle
  });

  setInterval(() => {
    recordingSweeper().catch((e) => console.error("[recordings] sweep error", e));
  }, 60_000);

  setInterval(() => {
    postCallSweep().catch((e) => console.error("[postcall] sweep error", e));
  }, 45_000);

  setInterval(() => {
    deliverWebhooks().catch((e) => console.error("[webhooks] delivery error", e));
  }, Number(process.env.WEBHOOK_RETRY_INTERVAL_MS ?? 15_000));

  startCronJobs();

  setInterval(() => {
    gdprSweep().catch((e) => console.error("[gdpr] sweep error", e));
  }, 60_000);

  cron.schedule("* * * * *", () => {
    sweepDueCallbacks().catch((e) => console.error("[cron] sweepDueCallbacks", e));
    sweepPostCalls().catch((e) => console.error("[cron] sweepPostCalls", e));
  });
  cron.schedule("0 3 * * *", () => {
    resetDailyCaps().catch((e) => console.error("[cron] resetDailyCaps", e));
  });

  // Billing (guide 09): monthly charges on the 1st; auto-top-up sweep every 15 min.
  // All monthly debits are idempotent via fixed ledger references — overlap-safe.
  cron.schedule("15 3 1 * *", () => {
    chargeMonthlyRentals().catch((e) => console.error("[cron] chargeMonthlyRentals", e));
    chargeMonthlyAddOns().catch((e) => console.error("[cron] chargeMonthlyAddOns", e));
    chargeMonthlyPlanFees().catch((e) => console.error("[cron] chargeMonthlyPlanFees", e));
  });
  cron.schedule("30 4 1 * *", () => {
    generateAllMonthlyInvoices().catch((e) => console.error("[cron] generateAllMonthlyInvoices", e));
  });
  cron.schedule("*/15 * * * *", () => {
    runAutoTopUpSweep().catch((e) => console.error("[cron] runAutoTopUpSweep", e));
  });

  log("worker ready — scheduler + dialer + whatsapp + cron (callbacks, post-call, nightly cap reset)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
