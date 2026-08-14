import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export function createRedisConnection() {
  const conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  // A redis outage must not crash the process: ioredis emits 'error' on
  // connection failures and reconnects automatically (maxRetriesPerRequest:
  // null keeps commands queued during the outage). Swallow + log so BullMQ
  // producers/consumers degrade instead of dying (phase 4 perf-degradation).
  conn.on("error", (err) => {
    console.error(`[redis] connection error: ${err.message}`);
  });
  return conn;
}

export const QUEUES = {
  scheduler: "campaign-scheduler",
  dialer: "campaign-dialer", // shared with guide 06 (callback-dial / manual-dial producers)
  whatsapp: "whatsapp-send",
  chatReply: "chat-reply", // omnichannel AI auto-reply (docs/new-features/04)
} as const;

// ---------- Job names + payloads (contract — do not rename) ----------

export const DIAL_JOB = "dial";
export const CALLBACK_DIAL_JOB = "callback-dial"; // guide 06 contract
export const MANUAL_DIAL_JOB = "manual-dial"; // guide 06 contract
export const WHATSAPP_SEND_JOB = "whatsapp-send";
export const CHAT_REPLY_JOB = "chat-reply";

export type SchedulerJobData = { campaignId: string };

export type DialJobData = {
  campaignId: string;
  campaignContactId: string;
  workspaceId: string;
  phoneNumberId?: string; // pool number claimed by the scheduler (caps already incremented)
};

/** Guide 06 contract — superset of src/lib/dialJobs.ts CallbackDialJobData.
 *  Tolerant consumer: producers today send {workspaceId, callbackTaskId, phone,
 *  note ("MISSED_CALL" for missed calls), requestedBy, enqueuedAt} with a 15-min
 *  delay; producers MAY also set agentId/reason — both are honored when present. */
export type CallbackDialJobData = {
  workspaceId: string;
  callbackTaskId: string;
  phone: string; // E.164 to call back
  note?: string; // e.g. "MISSED_CALL"
  requestedBy: "system";
  enqueuedAt: string; // ISO
  agentId?: string; // optional: force a specific agent for the callback
  reason?: string; // optional structured reason (supersedes note)
};

/** Guide 06 contract — identical shape to src/lib/dialJobs.ts ManualDialJobData. */
export type ManualDialJobData = {
  workspaceId: string;
  userId: string;
  callId: string; // existing Call row (OUTBOUND/RINGING) the worker attaches to
  fromNumber: string; // workspace DID (E.164) to dial from
  toNumber: string; // destination (E.164)
  enqueuedAt: string; // ISO
};

export type WhatsAppSendJobData = {
  workspaceId: string;
  whatsAppCampaignId: string;
  phone: string;
  templateName: string;
  params: string[];
  index: number; // 0-based recipient index
  total: number; // total recipients (last job marks the campaign COMPLETED)
};

export type ChatReplyJobData = {
  conversationId: string;
  workspaceId: string;
};

// ---------- Queue singletons ----------

let schedulerQueue: Queue<SchedulerJobData> | null = null;
let dialerQueue: Queue | null = null;
let whatsappQueue: Queue<WhatsAppSendJobData> | null = null;
let chatReplyQueue: Queue<ChatReplyJobData> | null = null;

export function getSchedulerQueue() {
  if (!schedulerQueue) {
    schedulerQueue = new Queue<SchedulerJobData>(QUEUES.scheduler, {
      connection: createRedisConnection(),
    });
  }
  return schedulerQueue;
}

export function getDialerQueue() {
  if (!dialerQueue) {
    dialerQueue = new Queue(QUEUES.dialer, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 2, // job-level retry (infra failures), NOT contact retries
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return dialerQueue;
}

export function getWhatsAppQueue() {
  if (!whatsappQueue) {
    whatsappQueue = new Queue<WhatsAppSendJobData>(QUEUES.whatsapp, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return whatsappQueue;
}

export function getChatReplyQueue() {
  if (!chatReplyQueue) {
    chatReplyQueue = new Queue<ChatReplyJobData>(QUEUES.chatReply, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return chatReplyQueue;
}

/** Start a 30s repeatable scheduler tick for a campaign. Idempotent. */
export async function ensureCampaignScheduler(campaignId: string) {
  await getSchedulerQueue().add(
    `tick-${campaignId}`,
    { campaignId },
    {
      repeat: { every: 30_000 },
      jobId: `scheduler-${campaignId}`, // dedupe key
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function stopCampaignScheduler(campaignId: string) {
  const q = getSchedulerQueue();
  const repeatable = await q.getRepeatableJobs();
  for (const job of repeatable) {
    if (job.name === `tick-${campaignId}`) {
      await q.removeRepeatableByKey(job.key);
    }
  }
}
