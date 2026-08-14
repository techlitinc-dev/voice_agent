import { describe, it, expect } from "vitest";
import {
  mockClassify,
  isSentimentLabel,
  avgScore,
  overallLabel,
  computeTrend,
  summarizeSentiment,
} from "./sentiment";

describe("mockClassify (SENTIMENT_DRY_RUN default)", () => {
  it("maps strong negative phrases to angry/frustrated", () => {
    expect(mockClassify("This is absolutely terrible, I am furious!").label).toBe("angry");
    expect(mockClassify("I am so fed up with this service").label).toBe("frustrated");
  });

  it("maps mild negatives to negative", () => {
    expect(mockClassify("No, I am not interested. Cancel it.").label).toBe("negative");
  });

  it("maps positive phrases to joyful/positive", () => {
    expect(mockClassify("That is amazing, thank you so much!").label).toBe("joyful");
    expect(mockClassify("Yes, that sounds good.").label).toBe("positive");
  });

  it("falls back to neutral", () => {
    expect(mockClassify("What are your timings?")).toEqual({ label: "neutral", score: 0 });
  });

  it("scores stay within [-1, 1]", () => {
    for (const sample of ["terrible worst appalling", "amazing excellent love", "ok fine sure", "hi there"]) {
      const { score } = mockClassify(sample);
      expect(score).toBeGreaterThanOrEqual(-1);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("isSentimentLabel", () => {
  it("accepts the six labels, rejects anything else", () => {
    for (const l of ["positive", "neutral", "negative", "angry", "frustrated", "joyful"]) {
      expect(isSentimentLabel(l)).toBe(true);
    }
    expect(isSentimentLabel("angry ")).toBe(false);
    expect(isSentimentLabel("")).toBe(false);
    expect(isSentimentLabel(42)).toBe(false);
  });
});

describe("avgScore / overallLabel", () => {
  it("averages scores", () => {
    expect(avgScore([{ score: 1 }, { score: -1 }])).toBe(0);
    expect(avgScore([{ score: 0.5 }, { score: 0.7 }])).toBeCloseTo(0.6);
    expect(avgScore([])).toBe(0);
  });

  it("maps average to coarse label with ±0.2 thresholds", () => {
    expect(overallLabel(0.3)).toBe("positive");
    expect(overallLabel(-0.3)).toBe("negative");
    expect(overallLabel(0.1)).toBe("neutral");
    expect(overallLabel(0)).toBe("neutral");
  });
});

describe("computeTrend", () => {
  it("improving when scores rise over time", () => {
    expect(computeTrend([{ score: -0.8 }, { score: -0.2 }, { score: 0.5 }])).toBe("improving");
  });

  it("declining when scores fall over time", () => {
    expect(computeTrend([{ score: 0.7 }, { score: 0.1 }, { score: -0.6 }])).toBe("declining");
  });

  it("stable when flat or a single point", () => {
    expect(computeTrend([{ score: 0.2 }, { score: 0.2 }, { score: 0.2 }])).toBe("stable");
    expect(computeTrend([{ score: 0.5 }])).toBe("stable");
    expect(computeTrend([])).toBe("stable");
  });
});

describe("summarizeSentiment", () => {
  it("combines overall + trend", () => {
    const s = summarizeSentiment([
      { ts: 0, score: -0.8, label: "angry" },
      { ts: 10, score: -0.5, label: "frustrated" },
      { ts: 20, score: 0.4, label: "positive" },
    ]);
    expect(s.trend).toBe("improving");
    expect(s.overall).toBe("negative"); // avg ≈ -0.3 → negative
  });
});
