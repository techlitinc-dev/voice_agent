import { describe, expect, it } from "vitest";
import {
  buildCallbackDialJob,
  buildManualDialJob,
  CALLBACK_DIAL_JOB,
  DIALER_QUEUE_NAME,
  MANUAL_DIAL_JOB,
} from "../src/lib/dialJobs";

const NOW = new Date("2025-07-07T12:00:00Z");

describe("queue name contract", () => {
  it("is the shared campaign-dialer queue (guide 07 consumes it)", () => {
    expect(DIALER_QUEUE_NAME).toBe("campaign-dialer");
  });
});

describe("buildCallbackDialJob", () => {
  it("builds the callback-dial payload with delay until dueAt", () => {
    const dueAt = new Date("2025-07-07T12:15:00Z");
    const job = buildCallbackDialJob(
      { workspaceId: "w1", callbackTaskId: "t1", phone: "+919812345678", note: "MISSED_CALL", dueAt },
      NOW
    );
    expect(job.name).toBe(CALLBACK_DIAL_JOB);
    expect(job.data).toEqual({
      workspaceId: "w1",
      callbackTaskId: "t1",
      phone: "+919812345678",
      note: "MISSED_CALL",
      requestedBy: "system",
      enqueuedAt: NOW.toISOString(),
    });
    expect(job.opts.delay).toBe(15 * 60_000);
    expect(job.opts.attempts).toBe(3);
  });
  it("past dueAt → zero delay, never negative", () => {
    const job = buildCallbackDialJob(
      { workspaceId: "w1", callbackTaskId: "t1", phone: "+919812345678", dueAt: new Date("2025-07-07T11:00:00Z") },
      NOW
    );
    expect(job.opts.delay).toBe(0);
  });
});

describe("buildManualDialJob", () => {
  it("builds the manual-dial payload with no delay", () => {
    const job = buildManualDialJob(
      { workspaceId: "w1", userId: "u1", callId: "c1", fromNumber: "+918040001234", toNumber: "+919812345678" },
      NOW
    );
    expect(job.name).toBe(MANUAL_DIAL_JOB);
    expect(job.data.callId).toBe("c1");
    expect(job.data.fromNumber).toBe("+918040001234");
    expect(job.data.enqueuedAt).toBe(NOW.toISOString());
    expect("delay" in job.opts).toBe(false);
    expect(job.opts.backoff).toEqual({ type: "exponential", delay: 60_000 });
  });
});
