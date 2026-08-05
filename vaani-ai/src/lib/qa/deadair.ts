/**
 * Dead-air heuristic (spec §8 dead-air detection).
 *
 * v1 approximation: TranscriptEntry has a single timestampMs (when the utterance
 * STARTED), not per-utterance durations. So we measure AGENT RESPONSIVENESS:
 * whenever the caller finished a turn and the agent needed more than
 * DEAD_AIR_THRESHOLD_MS to start replying, the excess counts as dead air.
 * Caller-side thinking time (agent spoke, caller slow) is never counted.
 */

export const DEAD_AIR_THRESHOLD_MS = 3000;

export type DeadAirEntry = { speaker: string; timestampMs: number };

/** Total dead-air seconds (integer, rounded) for one call's transcript entries. */
export function computeDeadAirSeconds(
  entries: DeadAirEntry[],
  thresholdMs: number = DEAD_AIR_THRESHOLD_MS,
): number {
  if (entries.length < 2) return 0;
  const sorted = [...entries].sort((a, b) => a.timestampMs - b.timestampMs);
  let totalMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.speaker === "CALLER" && cur.speaker === "AGENT") {
      const gap = cur.timestampMs - prev.timestampMs;
      if (gap > thresholdMs) totalMs += gap - thresholdMs;
    }
  }
  return Math.round(totalMs / 1000);
}
