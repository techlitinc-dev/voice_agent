import { Queue } from "bullmq";

/**
 * Job contracts on the shared "campaign-dialer" queue.
 * GUIDE 07: your worker MUST handle job names "callback-dial" and "manual-dial"
 * with exactly these payload shapes (contract #1 at the top of guide 06).
 */
export const DIALER_QUEUE_NAME = "campaign-dialer";
export const CALLBACK_DIAL_JOB = "callback-dial";
export const MANUAL_DIAL_JOB = "manual-dial";

export type CallbackDialJobData = {
  workspaceId: string;
  callbackTaskId: string;
  phone: string; // E.164 to call back
  note?: string;
  requestedBy: "system";
  enqueuedAt: string; // ISO
};

export type ManualDialJobData = {
  workspaceId: string;
  userId: string;
  callId: string; // existing Call row (OUTBOUND/RINGING) the worker attaches to
  fromNumber: string; // workspace DID (E.164) to dial from
  toNumber: string; // destination (E.164)
  enqueuedAt: string; // ISO
};

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

/** Pure builders (unit-tested). */
export function buildCallbackDialJob(
  input: { workspaceId: string; callbackTaskId: string; phone: string; note?: string; dueAt: Date },
  now: Date = new Date()
): { name: typeof CALLBACK_DIAL_JOB; data: CallbackDialJobData; opts: typeof JOB_OPTS & { delay: number } } {
  return {
    name: CALLBACK_DIAL_JOB,
    data: {
      workspaceId: input.workspaceId,
      callbackTaskId: input.callbackTaskId,
      phone: input.phone,
      note: input.note,
      requestedBy: "system",
      enqueuedAt: now.toISOString(),
    },
    opts: { ...JOB_OPTS, delay: Math.max(0, input.dueAt.getTime() - now.getTime()) },
  };
}

export function buildManualDialJob(
  input: { workspaceId: string; userId: string; callId: string; fromNumber: string; toNumber: string },
  now: Date = new Date()
): { name: typeof MANUAL_DIAL_JOB; data: ManualDialJobData; opts: typeof JOB_OPTS } {
  return {
    name: MANUAL_DIAL_JOB,
    data: { ...input, enqueuedAt: now.toISOString() },
    opts: JOB_OPTS,
  };
}

// ---------- Producer handle (own Queue instance on the shared queue name) ----------

let queue: Queue | null = null;

function redisConnection(): { host: string; port: number; password?: string } {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

function getDialerQueue(): Queue {
  if (!queue) queue = new Queue(DIALER_QUEUE_NAME, { connection: redisConnection() });
  return queue;
}

export async function enqueueCallbackDial(
  input: { workspaceId: string; callbackTaskId: string; phone: string; note?: string; dueAt: Date }
): Promise<void> {
  const job = buildCallbackDialJob(input);
  await getDialerQueue().add(job.name, job.data, job.opts);
}

export async function enqueueManualDial(
  input: { workspaceId: string; userId: string; callId: string; fromNumber: string; toNumber: string }
): Promise<void> {
  const job = buildManualDialJob(input);
  await getDialerQueue().add(job.name, job.data, job.opts);
}
