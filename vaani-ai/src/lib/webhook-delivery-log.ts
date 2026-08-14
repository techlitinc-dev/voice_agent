/**
 * Webhook v2 (docs/new-features/05 §3.9): per-attempt history + retry backoff
 * timeline helpers. Pure functions — the delivery worker appends attemptLog rows
 * on every attempt; the deliveries detail page reconstructs the full retry
 * schedule from them + nextBackoffMs.
 */

export type AttemptLogEntry = {
  attempt: number; // 1-based
  at: string; // ISO timestamp of when the attempt happened
  responseCode: number | null;
  error: string | null; // HTTP "500" / "timeout" / "network"
};

export type RetryTimelineStep = AttemptLogEntry & {
  /** The backoff delay scheduled AFTER this attempt (ms), null when terminal. */
  nextDelayMs: number | null;
  /** Projected (past) or planned (future) attempt time. */
  at: string;
};

/** Append one attempt to an existing attemptLog array (or start a new one). */
export function appendAttemptLog(
  existing: unknown,
  entry: AttemptLogEntry
): AttemptLogEntry[] {
  const parsed = Array.isArray(existing)
    ? (existing as unknown[]).filter(
        (e): e is AttemptLogEntry =>
          !!e && typeof e === "object" && typeof (e as AttemptLogEntry).attempt === "number"
      )
    : [];
  return [...parsed, entry];
}

/**
 * Reconstruct the retry timeline for a delivery from its attemptLog + createdAt.
 * For every recorded attempt we know when it happened; the backoff delay that
 * followed it is nextBackoffMs(attempt). When the delivery is still PENDING,
 * we also project the remaining future attempts (up to WEBHOOK_MAX_ATTEMPTS)
 * using the deterministic schedule so the UI can show what's coming.
 */
export function buildRetryTimeline(input: {
  createdAt: string; // ISO
  attemptLog: unknown;
  status: string; // PENDING | SUCCESS | FAILED
  attempts: number; // current attempts count on the row
  maxAttempts: number;
  nextBackoffMs: (attempt: number) => number;
}): RetryTimelineStep[] {
  const log = Array.isArray(input.attemptLog)
    ? (input.attemptLog as unknown[]).filter(
        (e): e is AttemptLogEntry =>
          !!e && typeof e === "object" && typeof (e as AttemptLogEntry).attempt === "number"
      )
    : [];

  const steps: RetryTimelineStep[] = [];
  const lastRecordedAttempt = log.length > 0 ? Math.max(...log.map((e) => e.attempt)) : 0;
  for (const entry of log) {
    const isFinal =
      entry.attempt >= input.maxAttempts ||
      (input.status === "SUCCESS" && entry.attempt === lastRecordedAttempt);
    const nextDelay = !isFinal ? input.nextBackoffMs(entry.attempt) : null;
    steps.push({ ...entry, nextDelayMs: nextDelay });
  }

  // Project future attempts while the delivery is still being retried.
  if (input.status === "PENDING") {
    const lastAttempt = log.length > 0 ? Math.max(...log.map((e) => e.attempt)) : 0;
    let cursor = lastAttempt > 0 ? new Date(log.find((e) => e.attempt === lastAttempt)!.at) : new Date(input.createdAt);
    // If attempts were recorded, the next one is due after the last backoff.
    if (lastAttempt > 0 && lastAttempt < input.maxAttempts) {
      cursor = new Date(cursor.getTime() + input.nextBackoffMs(lastAttempt));
    }
    for (let a = lastAttempt + 1; a <= input.maxAttempts; a++) {
      steps.push({
        attempt: a,
        at: cursor.toISOString(),
        responseCode: null,
        error: null, // planned — not yet happened
        nextDelayMs: a < input.maxAttempts ? input.nextBackoffMs(a) : null,
      });
      cursor = new Date(cursor.getTime() + input.nextBackoffMs(a));
    }
  }

  return steps;
}
