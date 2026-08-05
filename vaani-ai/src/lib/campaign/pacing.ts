/**
 * Throttling & pacing (readme §6.1) + predictive dial-ahead slots (readme §15).
 * - Progressive ramp-up: a campaign starts at `startCpm` and doubles every
 *   `doubleEveryMin` until it reaches its callsPerMinute cap (protects new DIDs
 *   from instant spam-flagging).
 * - Answer-rate adaptive pacing: below `threshold` rolling answer rate, CPS halves
 *   (floor 1); too few samples → no change.
 * - Predictive slots: over-book dial jobs at ratio × free slots (AI pickup ⇒ no
 *   abandonment; see the guide's honesty note).
 */

export const DIAL_AHEAD_RATIO = 1.5; // readme §15 — fixed, documented
export const MIN_ANSWER_SAMPLES = 10; // need this many recent calls before adapting

export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Current calls/minute after ramp-up. */
export function rampCpm(input: {
  capCpm: number;
  startedAt: Date;
  now: Date;
  startCpm?: number; // default CAMPAIGN_RAMP_START_CPM (2)
  doubleEveryMin?: number; // default CAMPAIGN_RAMP_DOUBLE_MINUTES (10)
}): number {
  const start = Math.max(1, input.startCpm ?? envInt("CAMPAIGN_RAMP_START_CPM", 2));
  const every = Math.max(1, input.doubleEveryMin ?? envInt("CAMPAIGN_RAMP_DOUBLE_MINUTES", 10));
  const elapsedMin = Math.max(0, (input.now.getTime() - input.startedAt.getTime()) / 60_000);
  const doublings = Math.floor(elapsedMin / every);
  return Math.min(input.capCpm, start * 2 ** doublings);
}

/** Rolling answer rate from recent calls; null when too few samples. */
export function answerRateFromCalls(calls: { answeredAt: Date | null }[]): number | null {
  if (calls.length < MIN_ANSWER_SAMPLES) return null;
  const answered = calls.filter((c) => c.answeredAt !== null).length;
  return answered / calls.length;
}

/** Adaptive pacing: below threshold → halve (floor 1); null rate → unchanged. */
export function adaptiveCpm(cpm: number, answerRate: number | null, threshold?: number): number {
  if (answerRate === null) return cpm;
  const t = threshold ?? Number(process.env.CAMPAIGN_ANSWER_RATE_THRESHOLD ?? "0.2");
  if (answerRate < t) return Math.max(1, Math.floor(cpm / 2));
  return cpm;
}

/** How many dials to enqueue per scheduler tick of `tickSeconds`. */
export function tickBatchSize(cpm: number, tickSeconds = 30): number {
  return Math.max(1, Math.floor((cpm * tickSeconds) / 60));
}

/**
 * Predictive dial-ahead slots (readme §15): how many NEW dial jobs may be in flight.
 * Normal mode: free slots = concurrency − inFlight (never negative).
 * Predictive mode: floor(concurrency × ratio) − inFlight — over-books because the AI
 * always picks up (abandonment ≈ 0; see the guide note).
 */
export function predictiveSlots(input: {
  concurrency: number;
  inFlight: number;
  predictive: boolean;
  ratio?: number;
}): number {
  const budget = input.predictive
    ? Math.max(input.concurrency, Math.floor(input.concurrency * (input.ratio ?? DIAL_AHEAD_RATIO)))
    : input.concurrency;
  return Math.max(0, budget - input.inFlight);
}
