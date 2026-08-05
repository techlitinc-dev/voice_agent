import { describe, expect, it } from "vitest";
import { computeDeadAirSeconds, DEAD_AIR_THRESHOLD_MS } from "../src/lib/qa/deadair";

describe("computeDeadAirSeconds", () => {
  it("returns 0 for empty / single entry", () => {
    expect(computeDeadAirSeconds([])).toBe(0);
    expect(computeDeadAirSeconds([{ speaker: "AGENT", timestampMs: 0 }])).toBe(0);
  });

  it("counts only slow AGENT responses after the caller spoke", () => {
    const entries = [
      { speaker: "AGENT", timestampMs: 0 },
      { speaker: "CALLER", timestampMs: 4000 },
      { speaker: "AGENT", timestampMs: 12000 }, // 8000ms after caller -> 5000ms excess
    ];
    expect(computeDeadAirSeconds(entries)).toBe(5);
  });

  it("ignores caller-side pauses (caller slow to answer the agent)", () => {
    const entries = [
      { speaker: "AGENT", timestampMs: 0 },
      { speaker: "CALLER", timestampMs: 30000 }, // caller thought for 30s — not agent dead air
      { speaker: "AGENT", timestampMs: 31000 }, // fast reply
    ];
    expect(computeDeadAirSeconds(entries)).toBe(0);
  });

  it("handles unsorted input and multiple gaps", () => {
    const entries = [
      { speaker: "AGENT", timestampMs: 20000 }, // 10s after caller -> 7s excess
      { speaker: "CALLER", timestampMs: 4000 },
      { speaker: "AGENT", timestampMs: 5000 }, // 1s after caller -> fine
      { speaker: "CALLER", timestampMs: 10000 },
      { speaker: "AGENT", timestampMs: 0 },
    ];
    expect(computeDeadAirSeconds(entries)).toBe(7);
  });

  it("respects a custom threshold", () => {
    const entries = [
      { speaker: "CALLER", timestampMs: 0 },
      { speaker: "AGENT", timestampMs: 2500 },
    ];
    expect(computeDeadAirSeconds(entries, 1000)).toBe(2); // 2500-1000 = 1500ms -> rounds to 2
    expect(computeDeadAirSeconds(entries, DEAD_AIR_THRESHOLD_MS)).toBe(0);
  });
});
