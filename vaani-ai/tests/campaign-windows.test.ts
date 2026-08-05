import { describe, expect, it } from "vitest";
import {
  effectiveTimezone,
  isWithinCallingWindows,
  isWithinTraiHours,
  localDay,
  localHHMM,
  parseTimezoneWindows,
} from "../src/lib/campaign/windows";

// Fixed clock: 2025-07-07 is a Monday. 10:00 UTC = 15:30 IST = 08:30 San Francisco (PDT).
const MON_1000_UTC = new Date("2025-07-07T10:00:00Z");
// 2025-07-12 is a Saturday.
const SAT_1000_UTC = new Date("2025-07-12T10:00:00Z");

describe("localHHMM / localDay", () => {
  it("formats in the requested timezone", () => {
    expect(localHHMM(MON_1000_UTC, "Asia/Kolkata")).toBe("15:30");
    expect(localHHMM(MON_1000_UTC, "America/Los_Angeles")).toBe("03:00");
    expect(localDay(MON_1000_UTC, "Asia/Kolkata")).toBe(1); // Monday
    expect(localDay(SAT_1000_UTC, "Asia/Kolkata")).toBe(6); // Saturday
  });
  it("falls back to Asia/Kolkata on a bogus timezone (never throws)", () => {
    expect(localHHMM(MON_1000_UTC, "Mars/Olympus")).toBe("15:30");
    expect(localDay(MON_1000_UTC, "Mars/Olympus")).toBe(1);
  });
});

describe("parseTimezoneWindows", () => {
  it("parses a full JSON config", () => {
    const tw = parseTimezoneWindows({
      timezone: "Asia/Kolkata",
      days: [1, 2, 3, 4, 5],
      windows: [["09:00", "13:00"], ["16:00", "19:00"]],
    });
    expect(tw).toEqual({ timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5], windows: [["09:00", "13:00"], ["16:00", "19:00"]] });
  });
  it("drops garbage entries and returns null for unusable input", () => {
    expect(parseTimezoneWindows(null)).toBeNull();
    expect(parseTimezoneWindows("x")).toBeNull();
    expect(parseTimezoneWindows({ days: ["Mon"] })).toBeNull();
    expect(parseTimezoneWindows({ days: [1, 99], windows: [["9am", "5pm"]] })).toEqual({ days: [1] });
  });
});

describe("isWithinCallingWindows", () => {
  const base = { windowStart: "09:00", windowEnd: "19:00" };
  it("honors campaign window in contact timezone", () => {
    // 15:30 IST inside 09–19
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: "Asia/Kolkata", ...base })).toBe(true);
    // 03:00 in LA outside 09–19 (contact in LA)
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: "America/Los_Angeles", ...base })).toBe(false);
  });
  it("falls back to the campaign JSON timezone, then Asia/Kolkata", () => {
    const tw = parseTimezoneWindows({ timezone: "America/Los_Angeles" });
    expect(effectiveTimezone({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: tw })).toBe("America/Los_Angeles");
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: tw })).toBe(false);
    expect(effectiveTimezone({ now: MON_1000_UTC, contactTimezone: null, ...base })).toBe("Asia/Kolkata");
  });
  it("enforces day-of-week rules", () => {
    const weekdays = parseTimezoneWindows({ timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5] });
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: weekdays })).toBe(true);
    expect(isWithinCallingWindows({ now: SAT_1000_UTC, contactTimezone: null, ...base, timezoneWindows: weekdays })).toBe(false);
  });
  it("honors split windows", () => {
    const split = parseTimezoneWindows({ timezone: "Asia/Kolkata", windows: [["09:00", "13:00"], ["16:00", "19:00"]] });
    // 15:30 IST is in the lunch gap
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: split })).toBe(false);
    // 11:30 UTC = 17:00 IST → inside evening window
    expect(isWithinCallingWindows({ now: new Date("2025-07-07T11:30:00Z"), contactTimezone: null, ...base, timezoneWindows: split })).toBe(true);
  });
});

describe("isWithinTraiHours (09:00–21:00 contact-local)", () => {
  it("allows inside, blocks outside", () => {
    expect(isWithinTraiHours(MON_1000_UTC, "Asia/Kolkata")).toBe(true); // 15:30
    expect(isWithinTraiHours(new Date("2025-07-07T02:30:00Z"), "Asia/Kolkata")).toBe(false); // 08:00
    expect(isWithinTraiHours(new Date("2025-07-07T16:00:00Z"), "Asia/Kolkata")).toBe(false); // 21:30
  });
  it("boundary: 09:00 allowed, 21:00 blocked", () => {
    expect(isWithinTraiHours(new Date("2025-07-07T03:30:00Z"), "Asia/Kolkata")).toBe(true); // 09:00
    expect(isWithinTraiHours(new Date("2025-07-07T15:30:00Z"), "Asia/Kolkata")).toBe(false); // 21:00
  });
});
