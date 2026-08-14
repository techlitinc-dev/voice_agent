import { describe, expect, it } from "vitest";
import { appendAttemptLog, buildRetryTimeline } from "../src/lib/webhook-delivery-log";
import { nextBackoffMs, WEBHOOK_MAX_ATTEMPTS } from "../src/lib/webhook-sign";

const NO_DELAY = () => 0;
const T0 = "2026-08-14T09:00:00.000Z";

describe("appendAttemptLog", () => {
  it("starts a new log when none exists", () => {
    const log = appendAttemptLog(null, { attempt: 1, at: T0, responseCode: null, error: "timeout" });
    expect(log).toEqual([{ attempt: 1, at: T0, responseCode: null, error: "timeout" }]);
  });

  it("appends to an existing log", () => {
    const first = appendAttemptLog(null, { attempt: 1, at: T0, responseCode: 500, error: "HTTP 500" });
    const second = appendAttemptLog(first, { attempt: 2, at: "2026-08-14T09:01:00.000Z", responseCode: 200, error: null });
    expect(second).toHaveLength(2);
    expect(second[1].attempt).toBe(2);
  });

  it("drops junk entries from the existing array", () => {
    const log = appendAttemptLog([{ nope: true }, { attempt: 1, at: T0, responseCode: null, error: null }], {
      attempt: 2,
      at: T0,
      responseCode: null,
      error: null,
    });
    expect(log).toHaveLength(2);
    expect(log[0].attempt).toBe(1);
  });
});

describe("buildRetryTimeline", () => {
  it("reconstructs a SUCCESS timeline with backoff delays after each attempt", () => {
    const timeline = buildRetryTimeline({
      createdAt: T0,
      attemptLog: [
        { attempt: 1, at: T0, responseCode: 500, error: "HTTP 500" },
        { attempt: 2, at: "2026-08-14T09:00:30.000Z", responseCode: 200, error: null },
      ],
      status: "SUCCESS",
      attempts: 2,
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      nextBackoffMs,
    });
    expect(timeline).toHaveLength(2);
    expect(timeline[0].nextDelayMs).toBe(30_000); // nextBackoffMs(1)
    expect(timeline[1].nextDelayMs).toBeNull(); // terminal success
    expect(timeline[1].responseCode).toBe(200);
  });

  it("projects remaining future attempts while PENDING", () => {
    const timeline = buildRetryTimeline({
      createdAt: T0,
      attemptLog: [
        { attempt: 1, at: T0, responseCode: 503, error: "HTTP 503" },
        { attempt: 2, at: "2026-08-14T09:00:30.000Z", responseCode: 503, error: "HTTP 503" },
      ],
      status: "PENDING",
      attempts: 2,
      maxAttempts: 4, // small for the test
      nextBackoffMs: (a) => a * 1000, // simple deterministic schedule
    });
    // 2 recorded + 2 projected (attempts 3 and 4).
    expect(timeline).toHaveLength(4);
    expect(timeline[2].error).toBeNull(); // planned
    expect(timeline[2].at).toBe("2026-08-14T09:00:32.000Z"); // 30s + 2s backoff
    expect(timeline[3].nextDelayMs).toBeNull(); // last attempt, no further backoff
  });

  it("handles empty attemptLog (enqueued but never attempted)", () => {
    const timeline = buildRetryTimeline({
      createdAt: T0,
      attemptLog: null,
      status: "PENDING",
      attempts: 0,
      maxAttempts: 3,
      nextBackoffMs: NO_DELAY,
    });
    // Projects attempts 1..3 from createdAt with zero delay.
    expect(timeline).toHaveLength(3);
    expect(timeline[0].at).toBe(T0);
    expect(timeline[2].nextDelayMs).toBeNull();
  });
});
