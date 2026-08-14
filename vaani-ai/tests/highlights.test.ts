import { describe, expect, it } from "vitest";
import {
  selectHighlightSegments,
  buildFfmpegFilter,
  MIN_SEGMENTS,
  MAX_SEGMENTS,
  DEFAULT_SEGMENT_MS,
  REEL_CAP_SEC,
} from "../src/lib/highlights";
import type { SegmentSource } from "../src/lib/highlights";

function entry(partial: Partial<SegmentSource> & { timestampMs: number }): SegmentSource {
  return {
    speaker: "CALLER",
    text: "hello",
    sentiment: null,
    sentimentScore: null,
    ...partial,
  };
}

describe("selectHighlightSegments", () => {
  it("returns [] for no entries", () => {
    expect(selectHighlightSegments([])).toEqual([]);
  });

  it("picks positive caller turns first (successful close)", () => {
    const entries = [
      entry({ timestampMs: 0, speaker: "AGENT", text: "Welcome" }),
      entry({ timestampMs: 5000, sentiment: "positive", sentimentScore: 0.8, text: "Yes, I'll take the loan" }),
      entry({ timestampMs: 9000, sentiment: "neutral", sentimentScore: 0, text: "Okay thanks" }),
    ];
    const segs = selectHighlightSegments(entries);
    // Positive turn picked; fallback fills to MIN_SEGMENTS from remaining.
    expect(segs.some((s) => s.text.includes("loan"))).toBe(true);
    expect(segs.length).toBeGreaterThanOrEqual(1);
  });

  it("picks agent rebuttal after a negative caller turn (objection handling)", () => {
    const entries = [
      entry({ timestampMs: 1000, sentiment: "frustrated", sentimentScore: -0.8, text: "This is too expensive!" }),
      entry({ timestampMs: 4000, speaker: "AGENT", text: "Let me check what we can do on the price." }),
      entry({ timestampMs: 8000, sentiment: "positive", sentimentScore: 0.7, text: "That works for me." }),
    ];
    const segs = selectHighlightSegments(entries);
    const agentIdx = segs.findIndex((s) => s.speaker === "AGENT" && s.text.includes("price"));
    const callerIdx = segs.findIndex((s) => s.speaker === "CALLER" && s.text.includes("expensive"));
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(callerIdx).toBeGreaterThanOrEqual(0);
    // Both the objection and the rebuttal are in the reel, in order.
    expect(callerIdx).toBeLessThan(agentIdx);
  });

  it("caps at MAX_SEGMENTS", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({ timestampMs: i * 1000, sentiment: i % 2 === 0 ? "positive" : "neutral", sentimentScore: i % 2 === 0 ? 0.9 : 0.1 })
    );
    const segs = selectHighlightSegments(entries);
    expect(segs.length).toBeLessThanOrEqual(MAX_SEGMENTS);
  });

  it("infers endMs from the next entry's start, default window for the last", () => {
    const entries = [
      entry({ timestampMs: 1000, sentiment: "positive", sentimentScore: 0.8 }),
      entry({ timestampMs: 6000, sentiment: "positive", sentimentScore: 0.9 }),
    ];
    const segs = selectHighlightSegments(entries);
    expect(segs[0].endMs).toBe(6000);
    expect(segs[1].endMs).toBe(6000 + DEFAULT_SEGMENT_MS);
  });
});

describe("buildFfmpegFilter", () => {
  it("builds a concat filter for multiple segments", () => {
    const segs = [
      { speaker: "CALLER" as const, text: "a", startMs: 1000, endMs: 4000 },
      { speaker: "AGENT" as const, text: "b", startMs: 6000, endMs: 9000 },
    ];
    const filter = buildFfmpegFilter(segs);
    expect(filter).toContain("atrim=start=1:end=4");
    expect(filter).toContain("atrim=start=6:end=9");
    expect(filter).toContain("concat=n=2:v=0:a=1");
    expect(filter).toContain(`atrim=0:${REEL_CAP_SEC}`);
  });

  it("handles a single segment without concat", () => {
    const segs = [{ speaker: "AGENT" as const, text: "a", startMs: 0, endMs: 3000 }];
    const filter = buildFfmpegFilter(segs);
    expect(filter).not.toContain("concat=");
    expect(filter).toContain(`atrim=0:${REEL_CAP_SEC}`);
  });

  it("floors sub-second starts to 0", () => {
    const segs = [{ speaker: "CALLER" as const, text: "a", startMs: 500, endMs: 2000 }];
    const filter = buildFfmpegFilter(segs);
    expect(filter).toContain("atrim=start=0:end=2");
  });
});
