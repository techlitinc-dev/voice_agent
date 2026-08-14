/**
 * Smart Retries v2 (docs/new-features/05 §3.5): learn per-contact optimal call
 * windows from their answer patterns (day-of-week × hour-of-day) and align retry
 * scheduling to those windows instead of naive now+delay.
 *
 * Pure functions — `now`/`rand` injected (matches campaign/retry.ts + windows.ts)
 * so tests use fixed clocks. The optional LLM scorer is DRY_RUN-guarded exactly
 * like src/lib/sentiment.ts (RETRY_DRY_RUN !== "false" → deterministic mock).
 */

import { localDay, localHHMM, nextOpenWindowTime } from "./windows";

/** A call row shaped for the analysis — only the fields we aggregate on. */
export type AnswerCall = {
  answeredAt: Date | null;
  status: string; // "COMPLETED" is an answer; anything else is not
  timezone?: string | null; // contact-local timezone for bucketing
};

export type HourBuckets = Record<number, Record<number, number>>; // day(0-6) → hour(0-23) → answered count

export const MIN_ANSWER_SAMPLES = 3; // below this we don't trust per-contact patterns
export const DEFAULT_WINDOWS_PER_DAY = 1;
export const DEFAULT_CONSECUTIVE_HOURS = 3;

/**
 * Aggregate answered-call counts per (dayOfWeek, hour) in the contact's timezone.
 * `answeredAt` is used when present, else the call start. Returns an empty map
 * when there are fewer than MIN_ANSWER_SAMPLES answered calls (not enough data).
 */
export function buildHourBuckets(calls: AnswerCall[], tz?: string | null): HourBuckets {
  const buckets: HourBuckets = {};
  let answered = 0;
  for (const call of calls) {
    if (call.status !== "COMPLETED" && !call.answeredAt) continue;
    const ts = call.answeredAt ?? call.status === "COMPLETED" ? call.answeredAt : null;
    if (!ts) continue; // COMPLETED with null answeredAt — no usable timestamp
    const day = localDay(ts, call.timezone ?? tz);
    const hour = Number(localHHMM(ts, call.timezone ?? tz).split(":")[0]);
    buckets[day] = buckets[day] ?? {};
    buckets[day][hour] = (buckets[day][hour] ?? 0) + 1;
    answered += 1;
  }
  return answered >= MIN_ANSWER_SAMPLES ? buckets : {};
}

/**
 * Pick the top hour blocks per day from the buckets → the roadmap's shape:
 * {"mon":["18-21"],"tue":["18-21"]}. A "block" is `consecutiveHours` consecutive
 * hours whose combined count is highest, rendered as "start-end" (start hour to
 * start+consecutiveHours, exclusive end). Days are keyed by 3-letter lowercase
 * weekday ("mon"). Empty when no buckets.
 */
export function topWindows(
  buckets: HourBuckets,
  opts: { windowsPerDay?: number; consecutiveHours?: number } = {}
): Record<string, string[]> {
  const windowsPerDay = opts.windowsPerDay ?? DEFAULT_WINDOWS_PER_DAY;
  const consecutiveHours = opts.consecutiveHours ?? DEFAULT_CONSECUTIVE_HOURS;
  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const out: Record<string, string[]> = {};
  for (const [dayStr, hours] of Object.entries(buckets)) {
    const day = Number(dayStr);
    // Sliding window over consecutive hours; score = sum of counts.
    const candidates: { start: number; score: number }[] = [];
    for (let h = 0; h <= 24 - consecutiveHours; h++) {
      let score = 0;
      for (let k = 0; k < consecutiveHours; k++) score += hours[h + k] ?? 0;
      candidates.push({ start: h, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.start - b.start);
    const picks = candidates.slice(0, windowsPerDay).sort((a, b) => a.start - b.start);
    const blocks = picks
      .filter((p) => p.score > 0)
      .map((p) => `${String(p.start).padStart(2, "0")}-${String(p.start + consecutiveHours).padStart(2, "0")}`);
    if (blocks.length > 0) out[DAY_KEYS[day]] = blocks;
  }
  return out;
}

/**
 * Align a retry `nextAttemptAt` (naive now+delay) into the next open calling
 * window. Precedence: contact optimal windows (per-day blocks) → campaign default
 * window (windowStart/windowEnd). Uses nextOpenWindowTime from windows.ts which
 * scans forward hourly; returns the aligned Date, or the naive candidate when no
 * window can be found (never returns null on the hot path).
 */
export function alignRetryToWindow(input: {
  now: Date;
  candidate: Date; // naive now+delay before alignment
  contactTimezone?: string | null;
  contactOptimalWindows?: Record<string, string[]> | null;
  windowStart: string;
  windowEnd: string;
}): Date {
  const aligned = nextOpenWindowTime(input.now, {
    now: input.now,
    contactTimezone: input.contactTimezone,
    contactOptimalWindows: input.contactOptimalWindows,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    timezoneWindows: null,
  });
  // Prefer the candidate when it's already inside a window (nextOpenWindowTime
  // returns `now` for that case); otherwise use the aligned time. If no window
  // exists at all, fall back to the naive candidate so retries still happen.
  if (aligned && aligned.getTime() === input.now.getTime()) return input.candidate;
  return aligned ?? input.candidate;
}

/**
 * DRY_RUN-guarded LLM scorer for optimal windows. RETRY_DRY_RUN !== "false"
 * (default) returns a deterministic mock derived from the hour buckets — the full
 * flow works offline and is unit-testable. The real path calls OpenRouter with a
 * classification prompt and never throws (falls back to the mock on error).
 */
export async function scoreOptimalWindows(
  contact: { timezone?: string | null; optimalCallWindows?: unknown },
  calls: AnswerCall[],
  opts: { windowsPerDay?: number; consecutiveHours?: number } = {}
): Promise<{ windows: Record<string, string[]>; model: string }> {
  const buckets = buildHourBuckets(calls, contact.timezone);
  const heuristic = topWindows(buckets, opts);
  if (process.env.RETRY_DRY_RUN !== "false") {
    return { windows: heuristic, model: "heuristic-mock" };
  }
  try {
    const model = process.env.RETRY_MODEL ?? "meta-llama/llama-3.1-8b-instruct";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You analyze call answer patterns. Given the per-day/hour answered counts, return JSON like {"mon":["18-21"],"tue":["18-21"]} with 1-2 hour blocks (start-end, exclusive end) per weekday the contact is most likely to answer. Use 3-hour blocks. Empty object when no data.',
          },
          {
            role: "user",
            content: `Timezone: ${contact.timezone ?? "Asia/Kolkata"}\nBuckets: ${JSON.stringify(buckets)}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const windows = sanitizeWindows(parsed);
    return { windows: windows ?? heuristic, model };
  } catch {
    return { windows: heuristic, model: "heuristic-mock" };
  }
}

/** Validate + normalize an LLM-produced windows object to the {"mon":["18-21"]} shape. */
export function sanitizeWindows(input: unknown): Record<string, string[]> | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, string>;
  const out: Record<string, string[]> = {};
  for (const [day, blocks] of Object.entries(o)) {
    if (!/^(sun|mon|tue|wed|thu|fri|sat)$/.test(day)) continue;
    if (!Array.isArray(blocks)) continue;
    const valid = blocks
      .filter((b) => typeof b === "string")
      .map((b) => /^(\d{1,2})-(\d{1,2})$/.exec(b))
      .filter((m): m is RegExpExecArray => !!m && Number(m[1]) >= 0 && Number(m[1]) <= 23 && Number(m[2]) > Number(m[1]) && Number(m[2]) <= 24)
      .map((m) => `${String(Number(m[1])).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`)
      .sort();
    if (valid.length > 0) out[day] = valid;
  }
  return Object.keys(out).length > 0 ? out : null;
}
