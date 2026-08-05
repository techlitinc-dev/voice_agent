import { getBusinessHours, type BusinessHoursEntry } from "@/config/businessHours";
import { getHolidays } from "@/config/holidays";

export type BusinessStatus = "open" | "after-hours" | "holiday";

/** Local time parts of `now` in an IANA zone, computed with Intl (no date libs). */
export function timePartsInZone(
  now: Date,
  timeZone: string
): { date: string; day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: days[parts.weekday] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isOpenNow(entry: BusinessHoursEntry, now: Date): boolean {
  const t = timePartsInZone(now, entry.timezone);
  return entry.days.includes(t.day) && t.minutes >= toMinutes(entry.open) && t.minutes < toMinutes(entry.close);
}

export function isHolidayToday(now: Date, timeZone: string, holidays: string[]): boolean {
  return holidays.includes(timePartsInZone(now, timeZone).date);
}

export function businessStatus(entry: BusinessHoursEntry, now: Date, holidays: string[]): BusinessStatus {
  if (isHolidayToday(now, entry.timezone, holidays)) return "holiday";
  return isOpenNow(entry, now) ? "open" : "after-hours";
}

export type GreetingResult = {
  greeting: string;
  businessStatus: BusinessStatus;
  isReturning: boolean;
};

/**
 * Compose the greeting the AI should speak:
 *  - holiday → holiday message; after hours → after-hours message; else base greeting.
 *  - returning caller (Contact found with a name) → "Welcome back, <name>!" prepended.
 */
export function resolveGreeting(input: {
  workspaceSlug: string;
  baseGreeting: string;
  callerName?: string | null;
  now?: Date;
  holidays?: string[];
  /** Test seam: pass an explicit entry instead of the config-file lookup. */
  hoursEntry?: BusinessHoursEntry;
}): GreetingResult {
  const now = input.now ?? new Date();
  const entry = input.hoursEntry ?? getBusinessHours(input.workspaceSlug);
  const holidays = input.holidays ?? getHolidays();
  const status = businessStatus(entry, now, holidays);

  let core: string;
  if (status === "holiday") {
    core = entry.holidayMessage ?? `${input.baseGreeting} We are closed today for a public holiday, but I can still help you or take a message.`;
  } else if (status === "after-hours") {
    core = entry.afterHoursMessage ?? `${input.baseGreeting} We are currently outside business hours, but I can still help you or take a message.`;
  } else {
    core = input.baseGreeting;
  }

  const name = input.callerName?.trim();
  const isReturning = !!name;
  return {
    greeting: isReturning ? `Welcome back, ${name}! ${core}` : core,
    businessStatus: status,
    isReturning,
  };
}
