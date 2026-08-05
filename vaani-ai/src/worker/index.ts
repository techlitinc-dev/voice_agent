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

const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false"; // default true — safe
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

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

  cron.schedule("* * * * *", () => {
    sweepDueCallbacks().catch((e) => console.error("[cron] sweepDueCallbacks", e));
    sweepPostCalls().catch((e) => console.error("[cron] sweepPostCalls", e));
  });
  cron.schedule("0 3 * * *", () => {
    resetDailyCaps().catch((e) => console.error("[cron] resetDailyCaps", e));
  });

  log("worker ready — scheduler + dialer + whatsapp + cron (callbacks, post-call, nightly cap reset)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
