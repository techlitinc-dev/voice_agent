/**
 * Timezone-aware calling windows (readme §6.1 "scheduling") + TRAI permitted-hours
 * guardrail (readme §11: 09:00–21:00 contact-local for promotional/SERIES_140).
 * Pure functions; `now` is always injected so tests use fixed clocks.
 */

export const TRAI_START = "09:00";
export const TRAI_END = "21:00"; // exclusive
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type TimezoneWindows = {
  timezone?: string; // IANA, campaign default when the contact has none
  days?: number[]; // 0=Sunday … 6=Saturday; empty/undefined = every day
  windows?: [string, string][]; // HH:mm pairs; overrides windowStart/windowEnd when present
};

/** Tolerant parser for Campaign.timezoneWindows JSON. Returns null when unusable. */
export function parseTimezoneWindows(json: unknown): TimezoneWindows | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const out: TimezoneWindows = {};
  if (typeof o.timezone === "string" && o.timezone.length > 0) out.timezone = o.timezone;
  if (Array.isArray(o.days)) {
    const days = o.days.filter((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) as number[];
    if (days.length > 0) out.days = days;
  }
  if (Array.isArray(o.windows)) {
    const wins: [string, string][] = [];
    for (const w of o.windows) {
      if (
        Array.isArray(w) && w.length === 2 &&
        typeof w[0] === "string" && /^\d{2}:\d{2}$/.test(w[0]) &&
        typeof w[1] === "string" && /^\d{2}:\d{2}$/.test(w[1])
      ) wins.push([w[0], w[1]]);
    }
    if (wins.length > 0) out.windows = wins;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** "HH:mm" in a timezone. Invalid timezone → DEFAULT_TIMEZONE (never throws). */
export function localHHMM(now: Date, timeZone?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone ?? DEFAULT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h === "24" ? "00" : h}:${m}`;
  } catch {
    return localHHMM(now, DEFAULT_TIMEZONE);
  }
}

/** Day of week (0=Sunday) in a timezone. Invalid timezone → DEFAULT_TIMEZONE. */
export function localDay(now: Date, timeZone?: string | null): number {
  try {
    const w = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone ?? DEFAULT_TIMEZONE,
      weekday: "short",
    }).format(now);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
  } catch {
    return localDay(now, DEFAULT_TIMEZONE);
  }
}

export type WindowInput = {
  now: Date;
  contactTimezone?: string | null; // Contact.timezone wins when set
  windowStart: string; // campaign fallback "HH:mm"
  windowEnd: string;
  timezoneWindows?: TimezoneWindows | null; // parsed Campaign.timezoneWindows
};

/** Effective timezone for a dial: contact → campaign JSON → default. */
export function effectiveTimezone(input: WindowInput): string {
  return input.contactTimezone ?? input.timezoneWindows?.timezone ?? DEFAULT_TIMEZONE;
}

/** Is `now` inside ANY permitted window for this contact (day-of-week + windows)? */
export function isWithinCallingWindows(input: WindowInput): boolean {
  const tz = effectiveTimezone(input);
  if (input.timezoneWindows?.days && !input.timezoneWindows.days.includes(localDay(input.now, tz))) {
    return false;
  }
  const hhmm = localHHMM(input.now, tz);
  const wins = input.timezoneWindows?.windows ?? [[input.windowStart, input.windowEnd] as [string, string]];
  return wins.some(([s, e]) => hhmm >= s && hhmm <= e);
}

/** TRAI/TCCCPR: promotional (SERIES_140) calls only 09:00–21:00 contact-local. */
export function isWithinTraiHours(now: Date, timeZone?: string | null): boolean {
  const hhmm = localHHMM(now, timeZone ?? DEFAULT_TIMEZONE);
  return hhmm >= TRAI_START && hhmm < TRAI_END;
}

/**
 * The next time `now` falls inside ANY permitted calling window, scanning forward
 * hour by hour. Pure + clock-injected (matches retry.ts). Used by Smart Retries v2
 * to align a retry's nextAttemptAt to an open window instead of a naive now+delay
 * that can land outside the calling window and sit idle until the next tick.
 * Returns `now` unchanged when it is already inside a window. Falls back to the
 * campaign default window (windowStart/windowEnd) when no per-contact windows are
 * given (timezoneWindows.windows overrides both). Returns null when the campaign
 * window itself is invalid.
 */
export function nextOpenWindowTime(
  now: Date,
  input: WindowInput & { contactOptimalWindows?: Record<string, string[]> | null }
): Date | null {
  const perContact = input.contactOptimalWindows;
  const wins: [string, string][] = input.timezoneWindows?.windows
    ?? (perContact && Object.keys(perContact).length > 0
      ? Object.entries(perContact).map(([d, hs]) => [d, toWindowEnd(hs)] as [string, string])
      : [[input.windowStart, input.windowEnd] as [string, string]]);
  if (wins.length === 0) return null;

  // If already inside a permitted window right now, stay put.
  if (isWithinCallingWindows({ ...input, timezoneWindows: input.timezoneWindows ?? { windows: wins } })) {
    return now;
  }

  const hourMs = 3600_000;
  const MAX_SCAN = 24 * 7; // up to a week ahead; campaigns retry within hours
  for (let i = 1; i <= MAX_SCAN; i++) {
    const candidate = new Date(now.getTime() + i * hourMs);
    if (isWithinCallingWindows({ ...input, now: candidate, timezoneWindows: input.timezoneWindows ?? { windows: wins } })) {
      return candidate;
    }
  }
  return null;
}

/** "18:00" → "21:00" for a per-contact windows entry (["18-21"] → end "21"). */
function toWindowEnd(blocks: string[]): string {
  if (blocks.length === 0) return "23:59";
  const last = blocks[blocks.length - 1];
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(last);
  if (!m) return "23:59";
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (Number.isNaN(start) || Number.isNaN(end)) return "23:59";
  return `${String(end).padStart(2, "0")}:00`;
}
