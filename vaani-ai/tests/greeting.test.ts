import { describe, expect, it } from "vitest";
import {
  businessStatus,
  isHolidayToday,
  isOpenNow,
  resolveGreeting,
  timePartsInZone,
} from "../src/lib/greeting";
import type { BusinessHoursEntry } from "../src/config/businessHours";

const ENTRY: BusinessHoursEntry = {
  timezone: "Asia/Kolkata",
  days: [1, 2, 3, 4, 5, 6],
  open: "10:00",
  close: "20:00",
  afterHoursMessage: "We are closed now.",
  holidayMessage: "Holiday today.",
};

// 2025-07-07 is a Monday. 12:00 UTC = 17:30 IST (open). 04:00 UTC = 09:30 IST (closed).
const MON_OPEN = new Date("2025-07-07T12:00:00Z");
const MON_EARLY = new Date("2025-07-07T04:00:00Z");
const SUN_NOON = new Date("2025-07-06T06:30:00Z"); // Sunday 12:00 IST
const HOLIDAY = new Date("2025-08-15T12:00:00Z"); // in the static calendar
const NO_HOLIDAYS: string[] = [];

describe("timePartsInZone", () => {
  it("converts UTC to IST parts", () => {
    const t = timePartsInZone(MON_OPEN, "Asia/Kolkata");
    expect(t.day).toBe(1); // Monday
    expect(t.minutes).toBe(17 * 60 + 30);
    expect(t.date).toBe("2025-07-07");
  });
});

describe("isOpenNow", () => {
  it("open during hours on a working day", () => {
    expect(isOpenNow(ENTRY, MON_OPEN)).toBe(true);
  });
  it("closed before opening", () => {
    expect(isOpenNow(ENTRY, MON_EARLY)).toBe(false);
  });
  it("closed on Sunday", () => {
    expect(isOpenNow(ENTRY, SUN_NOON)).toBe(false);
  });
  it("boundary: exactly at close is closed", () => {
    expect(isOpenNow(ENTRY, new Date("2025-07-07T14:30:00Z"))).toBe(false); // 20:00 IST
  });
});

describe("isHolidayToday / businessStatus", () => {
  it("detects a holiday from the list", () => {
    expect(isHolidayToday(HOLIDAY, "Asia/Kolkata", ["2025-08-15"])).toBe(true);
  });
  it("holiday beats open hours", () => {
    expect(businessStatus(ENTRY, HOLIDAY, ["2025-08-15"])).toBe("holiday");
  });
  it("after-hours when closed and not holiday", () => {
    expect(businessStatus(ENTRY, MON_EARLY, NO_HOLIDAYS)).toBe("after-hours");
  });
  it("open otherwise", () => {
    expect(businessStatus(ENTRY, MON_OPEN, NO_HOLIDAYS)).toBe("open");
  });
});

describe("resolveGreeting", () => {
  const base = "Namaste! Demo Dental Clinic. How may I help you?";
  it("returning caller during hours → Welcome back + base greeting", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, callerName: "Ramesh Test", now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.greeting).toBe(`Welcome back, Ramesh Test! ${base}`);
    expect(r.businessStatus).toBe("open");
    expect(r.isReturning).toBe(true);
  });
  it("new caller during hours → base greeting unchanged", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, callerName: null, now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.greeting).toBe(base);
    expect(r.isReturning).toBe(false);
  });
  it("after hours → after-hours message", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, now: MON_EARLY, holidays: NO_HOLIDAYS, hoursEntry: ENTRY });
    expect(r.greeting).toBe("We are closed now.");
    expect(r.businessStatus).toBe("after-hours");
  });
  it("holiday → holiday message beats business hours", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, now: HOLIDAY, holidays: ["2025-08-15"], hoursEntry: ENTRY });
    expect(r.greeting).toBe("Holiday today.");
    expect(r.businessStatus).toBe("holiday");
  });
  it("demo-clinic config: after-hours uses the configured clinic message", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, now: MON_EARLY, holidays: NO_HOLIDAYS });
    expect(r.businessStatus).toBe("after-hours");
    expect(r.greeting).toContain("Demo Dental Clinic");
  });
  it("unknown workspace slug falls back to default hours", () => {
    const r = resolveGreeting({ workspaceSlug: "no-such-ws", baseGreeting: base, now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.businessStatus).toBe("open"); // default 09:00-19:00 covers 17:30 IST
  });
  it("blank caller name is not treated as returning", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, callerName: "   ", now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.isReturning).toBe(false);
    expect(r.greeting).toBe(base);
  });
});
