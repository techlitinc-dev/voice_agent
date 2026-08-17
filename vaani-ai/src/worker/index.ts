/**
 * Campaign worker. Run with: npm run worker
 * - BullMQ: campaign-scheduler (ticks), campaign-dialer (dial / callback-dial /
 *   manual-dial), whatsapp-send (throttled template sends).
 * - node-cron: callback sweep + post-call sweep (every minute), daily cap reset
 *   (03:00).
 * CAMPAIGN_DRY_RUN=true simulates dials AND post-call LLM results — no Dograh, no
 * OpenRouter, no cost.
 */
import { createServer } from "node:http";
import { Worker } from "bullmq";
import cron from "node-cron";
import { createRedisConnection, QUEUES } from "../lib/queue";
import type { DialJobData, CallbackDialJobData, ManualDialJobData, WhatsAppSendJobData, ChatReplyJobData } from "../lib/queue";
import { DIAL_JOB, CALLBACK_DIAL_JOB, MANUAL_DIAL_JOB } from "../lib/queue";
import { schedulerTick } from "./campaignTick";
import { dialJob, callbackDialJob, manualDialJob, whatsappSendJob } from "./dial";
import { chatReplyJob } from "./chat-reply";
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
import { runRetryAnalysisSweep } from "./retry-analysis";
import { queueDepth, workerLagSeconds } from "../lib/metrics";
import { workerLogger } from "../lib/logger";
import { startTracing } from "../lib/tracing";

const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false"; // default true — safe
const logger = workerLogger();
const log = (...a: unknown[]) => logger.info(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

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
  startTracing();
  log(`worker starting (CAMPAIGN_DRY_RUN=${DRY_RUN}, TRAI_HOURS_ENFORCE=${process.env.TRAI_HOURS_ENFORCE ?? "true"}, REQUIRE_CONSENT=${process.env.REQUIRE_CONSENT_FOR_PROMOTIONAL ?? "false"})`);
  const connection = createRedisConnection();

  // Cron/interval registrations run ONLY on the primary worker (guide 12 scaling).
  const RUN_CRON = process.env.RUN_CRON !== "false";

  new Worker(QUEUES.scheduler, schedulerTick, {
    connection,
    concurrency: Number(process.env.SCHEDULER_CONCURRENCY ?? 5),
  });

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
    {
      connection,
      // Env-tunable concurrency + rate limiter (scalability doc §4.1).
      concurrency: Number(process.env.DIAL_CONCURRENCY ?? 10),
      limiter: {
        max: Number(process.env.DIAL_RATE_PER_SEC ?? 50),
        duration: 1000,
      },
    }
  );

  new Worker<WhatsAppSendJobData>(QUEUES.whatsapp, whatsappSendJob, {
    connection,
    concurrency: Number(process.env.WHATSAPP_CONCURRENCY ?? 2),
    limiter: { max: 5, duration: 1000 }, // 5 msgs/sec — provider-friendly throttle
  });

  // Omnichannel AI auto-reply (docs/new-features/04). No limiter — replies are
  // conversational, not bulk sends.
  new Worker<ChatReplyJobData>(QUEUES.chatReply, chatReplyJob, {
    connection,
    concurrency: Number(process.env.CHATREPLY_CONCURRENCY ?? 5),
  });

  if (RUN_CRON) {
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
  }

  if (RUN_CRON) {
    cron.schedule("* * * * *", () => {
      sweepDueCallbacks().catch((e) => console.error("[cron] sweepDueCallbacks", e));
      sweepPostCalls().catch((e) => console.error("[cron] sweepPostCalls", e));
    });
    cron.schedule("0 3 * * *", () => {
      resetDailyCaps().catch((e) => console.error("[cron] resetDailyCaps", e));
    });
    // Smart Retries v2 (docs/new-features/05 §3.5): nightly optimal-window learning.
    cron.schedule("0 2 * * *", () => {
      runRetryAnalysisSweep().catch((e) => console.error("[cron] retry-analysis", e));
    });
  }

  // Billing (guide 09): monthly charges on the 1st; auto-top-up sweep every 15 min.
  // All monthly debits are idempotent via fixed ledger references — overlap-safe.
  if (RUN_CRON) {
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
  }

  // Queue-depth + worker-lag gauges (observability doc §2.1/§2.2). Read every
  // 30s; failures are logged, never fatal. The worker exposes its own /metrics
  // scrape target (see startMetricsServer below) because BullMQ gauges live in
  // the worker process, separate from the web app's registry.
  setInterval(async () => {
    try {
      for (const q of Object.values(QUEUES)) {
        const queue = new (await import("bullmq")).Queue(q, { connection: createRedisConnection() });
        try {
          const counts = await queue.getJobCounts("waiting", "delayed");
          const oldest = await queue.getDelayed(0, 0); // earliest scheduled job
          queueDepth.labels(q).set((counts.waiting ?? 0) + (counts.delayed ?? 0));
          if (oldest[0]?.timestamp) {
            workerLagSeconds.labels(q).set(Math.max(0, (Date.now() - oldest[0].timestamp) / 1000));
          }
        } finally {
          await queue.close();
        }
      }
    } catch (e) {
      console.error("[metrics] queue depth read failed", e);
    }
  }, 30_000);

  log("worker ready — scheduler + dialer + whatsapp + chat-reply + cron (callbacks, post-call, nightly cap reset)");
  startMetricsServer();
}

/** Expose the worker's metrics registry on METRICS_PORT (default 3001) so
 *  Prometheus can scrape the BullMQ gauges without hitting the web app.
 *  Same bearer-token guard as /api/metrics. */
function startMetricsServer() {
  const port = Number(process.env.METRICS_PORT ?? 3001);
  const token = process.env.METRICS_TOKEN;
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" || req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    try {
      const { metricsText } = await import("../lib/metrics");
      const body = await metricsText();
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(body);
    } catch (e) {
      console.error("[metrics] export failed", e);
      res.writeHead(500).end("metrics error");
    }
  });
  server.listen(port, () => log(`[metrics] worker exporter on :${port}/metrics`));
  server.on("error", (e: Error) => console.error("[metrics] exporter error", e));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
