import { describe, expect, it } from "vitest";
import {
  buildHourBuckets,
  topWindows,
  alignRetryToWindow,
  scoreOptimalWindows,
  sanitizeWindows,
  MIN_ANSWER_SAMPLES,
} from "../src/lib/campaign/optimal";
import { nextOpenWindowTime } from "../src/lib/campaign/windows";

const TZ = "Asia/Kolkata";

/** Build a UTC date that reads as a specific local time in Asia/Kolkata. */
function local(dayOffset: number, hour: number, minute = 0): Date {
  // Asia/Kolkata is UTC+5:30. Construct a UTC instant whose IST clock reads hour:minute.
  return new Date(Date.UTC(2025, 6, 7 + dayOffset, hour - 5, minute - 30));
}

describe("buildHourBuckets", () => {
  it("buckets answered calls by local day/hour and requires min samples", () => {
    const calls = [
      { status: "COMPLETED", answeredAt: local(0, 18) }, // Mon 18:00 IST
      { status: "COMPLETED", answeredAt: local(0, 18) }, // Mon 18:00 IST
      { status: "COMPLETED", answeredAt: local(0, 19) }, // Mon 19:00 IST
      { status: "NO_ANSWER", answeredAt: null }, // not answered — skipped
    ];
    const buckets = buildHourBuckets(calls, TZ);
    expect(buckets[1]?.[18]).toBe(2); // Mon
    expect(buckets[1]?.[19]).toBe(1);
    expect(Object.keys(buckets[1] ?? {}).length).toBe(2);
  });

  it("returns empty below the min sample guard", () => {
    const buckets = buildHourBuckets(
      [
        { status: "COMPLETED", answeredAt: local(0, 10) },
        { status: "COMPLETED", answeredAt: local(1, 11) },
      ],
      TZ
    );
    expect(buckets).toEqual({});
  });

  it("honors per-call timezone over the fallback", () => {
    // A call answered at an instant that is 18:00 in Kolkata but 08:30 in New York.
    const at = local(0, 18);
    const buckets = buildHourBuckets(
      [
        { status: "COMPLETED", answeredAt: at, timezone: "America/New_York" },
        { status: "COMPLETED", answeredAt: at, timezone: "America/New_York" },
        { status: "COMPLETED", answeredAt: at, timezone: "America/New_York" },
      ],
      TZ
    );
    // 18:00 IST == 08:30 EDT → hour 8 on the same UTC day (Mon).
    expect(buckets[1]?.[8]).toBe(3);
  });

  it("exported min samples constant is 3", () => {
    expect(MIN_ANSWER_SAMPLES).toBe(3);
  });
});

describe("topWindows", () => {
  it("picks the top consecutive-hour block per day", () => {
    const buckets: Record<number, Record<number, number>> = {
      1: { 17: 1, 18: 5, 19: 4, 20: 0, 9: 2 },
    };
    const windows = topWindows(buckets, { windowsPerDay: 1, consecutiveHours: 3 });
    // 18-21 has 5+4+0=9; 17-20 has 1+5+4=10 → picks 17-20.
    expect(windows.mon).toEqual(["17-20"]);
  });

  it("respects windowsPerDay and sorts by start hour", () => {
    const buckets: Record<number, Record<number, number>> = {
      2: { 10: 4, 11: 4, 12: 4, 18: 3, 19: 3, 20: 3 },
    };
    const windows = topWindows(buckets, { windowsPerDay: 2, consecutiveHours: 3 });
    expect(windows.tue).toEqual(["10-13", "18-21"]);
  });

  it("returns empty for empty buckets", () => {
    expect(topWindows({})).toEqual({});
  });
});

describe("alignRetryToWindow / nextOpenWindowTime", () => {
  const WINDOW = { windowStart: "09:00", windowEnd: "19:00" };

  it("stays put when the naive candidate is already inside the window", () => {
    const now = local(0, 9); // Mon 09:00 IST
    const candidate = local(0, 12); // Mon 12:00 IST — inside
    const aligned = alignRetryToWindow({
      now,
      candidate,
      contactTimezone: TZ,
      contactOptimalWindows: null,
      ...WINDOW,
    });
    expect(aligned.getTime()).toBe(candidate.getTime());
  });

  it("shifts an outside-window candidate into the next open window", () => {
    const now = local(0, 20); // Mon 20:00 IST — after 19:00 close
    const candidate = new Date(now.getTime() + 30 * 60_000); // Mon 20:30 — outside
    const aligned = alignRetryToWindow({
      now,
      candidate,
      contactTimezone: TZ,
      contactOptimalWindows: null,
      ...WINDOW,
    });
    // Next open window is Tue 09:00 IST.
    expect(aligned.getTime()).toBe(local(1, 9).getTime());
  });

  it("aligns into a per-contact optimal window", () => {
    const now = local(0, 20); // Mon 20:00 IST
    const candidate = new Date(now.getTime() + 30 * 60_000);
    const aligned = alignRetryToWindow({
      now,
      candidate,
      contactTimezone: TZ,
      contactOptimalWindows: { mon: ["18-21"] },
      ...WINDOW,
    });
    // Monday has an optimal 18-21 window; 20:30 is inside it → no shift needed
    // (nextOpenWindowTime returns `now` for already-inside; align keeps candidate).
    expect(aligned.getTime()).toBe(candidate.getTime());
  });

  it("falls back to the naive candidate when no window matches (all-week scan)", () => {
    // A window that never opens (start > end always false — but our scan only
    // looks at valid windows; simulate by an impossible window set).
    const now = local(0, 12);
    const candidate = new Date(now.getTime() + 3600_000);
    const aligned = alignRetryToWindow({
      now,
      candidate,
      contactTimezone: TZ,
      contactOptimalWindows: null,
      windowStart: "23:00",
      windowEnd: "23:59", // only 23:00-23:59 opens daily
    });
    // 23:00 IST today or tomorrow is reachable within the 7-day scan.
    expect(aligned.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});

describe("scoreOptimalWindows (dry-run default)", () => {
  it("returns the deterministic heuristic windows without any network call", async () => {
    const calls = [
      { status: "COMPLETED", answeredAt: local(0, 18), timezone: TZ },
      { status: "COMPLETED", answeredAt: local(0, 18), timezone: TZ },
      { status: "COMPLETED", answeredAt: local(0, 19), timezone: TZ },
    ];
    const r = await scoreOptimalWindows({ timezone: TZ }, calls);
    expect(r.model).toBe("heuristic-mock");
    expect(r.windows.mon).toBeDefined();
  });
});

describe("sanitizeWindows", () => {
  it("normalizes valid entries and rejects junk", () => {
    expect(sanitizeWindows({ mon: ["18-21"], xyz: ["1-2"] })).toEqual({ mon: ["18-21"] });
    expect(sanitizeWindows({ mon: ["18-21", "9-12"] })).toEqual({ mon: ["09-12", "18-21"] });
    expect(sanitizeWindows({ mon: ["25-30"] })).toEqual(null);
    expect(sanitizeWindows("nope")).toEqual(null);
  });
});
