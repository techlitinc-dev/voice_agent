import { describe, expect, it } from "vitest";
import {
  adaptiveCpm,
  answerRateFromCalls,
  DIAL_AHEAD_RATIO,
  predictiveSlots,
  rampCpm,
  tickBatchSize,
} from "../src/lib/campaign/pacing";

const T0 = new Date("2025-07-07T10:00:00Z");
const after = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("rampCpm (progressive ramp-up)", () => {
  const opts = { capCpm: 32, startedAt: T0, startCpm: 2, doubleEveryMin: 10 };
  it("starts low, doubles every N minutes, stops at the cap", () => {
    expect(rampCpm({ ...opts, now: T0 })).toBe(2);
    expect(rampCpm({ ...opts, now: after(9) })).toBe(2);
    expect(rampCpm({ ...opts, now: after(10) })).toBe(4);
    expect(rampCpm({ ...opts, now: after(20) })).toBe(8);
    expect(rampCpm({ ...opts, now: after(30) })).toBe(16);
    expect(rampCpm({ ...opts, now: after(40) })).toBe(32); // cap reached
    expect(rampCpm({ ...opts, now: after(400) })).toBe(32); // stays at cap
  });
  it("never exceeds the cap even with a high start", () => {
    expect(rampCpm({ capCpm: 5, startedAt: T0, now: after(60), startCpm: 4, doubleEveryMin: 10 })).toBe(5);
  });
});

describe("answerRateFromCalls + adaptiveCpm", () => {
  const calls = (answered: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ answeredAt: i < answered ? new Date() : null }));
  it("returns null below the sample threshold", () => {
    expect(answerRateFromCalls(calls(3, 9))).toBeNull();
    expect(answerRateFromCalls([])).toBeNull();
  });
  it("computes the rolling rate", () => {
    expect(answerRateFromCalls(calls(3, 10))).toBe(0.3);
    expect(answerRateFromCalls(calls(0, 50))).toBe(0);
  });
  it("halves CPS below the threshold, floors at 1, unchanged otherwise", () => {
    expect(adaptiveCpm(20, 0.1, 0.2)).toBe(10);
    expect(adaptiveCpm(1, 0.1, 0.2)).toBe(1);
    expect(adaptiveCpm(20, 0.5, 0.2)).toBe(20);
    expect(adaptiveCpm(20, null, 0.2)).toBe(20); // not enough data → no change
  });
});

describe("tickBatchSize", () => {
  it("scales the 30s tick with CPS, minimum 1", () => {
    expect(tickBatchSize(60)).toBe(30);
    expect(tickBatchSize(10)).toBe(5);
    expect(tickBatchSize(1)).toBe(1);
  });
});

describe("predictiveSlots (readme §15)", () => {
  it("normal mode: free slots = concurrency − inFlight, never negative", () => {
    expect(predictiveSlots({ concurrency: 4, inFlight: 1, predictive: false })).toBe(3);
    expect(predictiveSlots({ concurrency: 4, inFlight: 4, predictive: false })).toBe(0);
    expect(predictiveSlots({ concurrency: 4, inFlight: 9, predictive: false })).toBe(0);
  });
  it("predictive mode over-books at the dial-ahead ratio", () => {
    expect(DIAL_AHEAD_RATIO).toBe(1.5);
    expect(predictiveSlots({ concurrency: 4, inFlight: 0, predictive: true })).toBe(6); // floor(4×1.5)
    expect(predictiveSlots({ concurrency: 4, inFlight: 5, predictive: true })).toBe(1);
    expect(predictiveSlots({ concurrency: 4, inFlight: 6, predictive: true })).toBe(0);
  });
  it("predictive with concurrency 1 still allows at least the base slot", () => {
    expect(predictiveSlots({ concurrency: 1, inFlight: 0, predictive: true })).toBe(1);
  });
});
