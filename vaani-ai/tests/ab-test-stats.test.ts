import { describe, expect, it } from "vitest";
import { computeAbStats, AB_CONVERSION_OUTCOMES } from "../src/lib/ab-test-stats";

const MAIN = { id: "v-main", version: 1, label: null, isAbVariant: false, abTrafficPercent: null };
const VARIANT = { id: "v-var", version: 2, label: "shorter greeting", isAbVariant: true, abTrafficPercent: 20 };

function call(agentVersionId: string | null, status: string, outcome: string | null, sentiment: string | null = null) {
  return { agentVersionId, status, outcome, sentiment };
}

describe("computeAbStats", () => {
  it("counts calls, completions and conversions per version", () => {
    const r = computeAbStats({
      versions: [MAIN, VARIANT],
      calls: [
        call("v-main", "COMPLETED", "booked"),
        call("v-main", "COMPLETED", "not-interested"),
        call("v-main", "COMPLETED", "qualified"),
        call("v-var", "COMPLETED", "booked"),
        call("v-var", "FAILED", null),
        call("v-var", "COMPLETED", "message-taken"),
      ],
    });
    const main = r.versions.find((v) => v.versionId === "v-main")!;
    const variant = r.versions.find((v) => v.versionId === "v-var")!;
    expect(main.calls).toBe(3);
    expect(main.completed).toBe(3);
    expect(main.converted).toBe(2);
    expect(main.conversionRate).toBeCloseTo(2 / 3);
    expect(variant.calls).toBe(3);
    expect(variant.completed).toBe(2);
    expect(variant.converted).toBe(1);
  });

  it("declares no winner below the min sample size", () => {
    const r = computeAbStats({
      versions: [MAIN, VARIANT],
      calls: [call("v-main", "COMPLETED", "booked"), call("v-var", "COMPLETED", "not-interested")],
      minCalls: 10,
    });
    expect(r.hasWinner).toBe(false);
    expect(r.winnerVersionId).toBeNull();
  });

  it("declares the higher-converting version the winner at sufficient sample", () => {
    const r = computeAbStats({
      versions: [MAIN, VARIANT],
      minCalls: 2,
      calls: [
        // main: 2/2 convert
        call("v-main", "COMPLETED", "booked"),
        call("v-main", "COMPLETED", "qualified"),
        // variant: 1/2 convert
        call("v-var", "COMPLETED", "booked"),
        call("v-var", "COMPLETED", "not-interested"),
      ],
    });
    expect(r.hasWinner).toBe(true);
    expect(r.winnerVersionId).toBe("v-main");
  });

  it("no winner when conversion rates are tied", () => {
    const r = computeAbStats({
      versions: [MAIN, VARIANT],
      minCalls: 2,
      calls: [
        call("v-main", "COMPLETED", "booked"),
        call("v-main", "COMPLETED", "not-interested"),
        call("v-var", "COMPLETED", "qualified"),
        call("v-var", "COMPLETED", "not-interested"),
      ],
    });
    expect(r.hasWinner).toBe(false);
  });

  it("averages sentiment score per version", () => {
    const r = computeAbStats({
      versions: [MAIN, VARIANT],
      calls: [
        call("v-main", "COMPLETED", "booked", "positive"),
        call("v-main", "COMPLETED", "booked", "negative"),
        call("v-var", "COMPLETED", "booked", "positive"),
      ],
    });
    expect(r.versions.find((v) => v.versionId === "v-main")!.avgSentiment).toBeCloseTo(0);
    expect(r.versions.find((v) => v.versionId === "v-var")!.avgSentiment).toBeCloseTo(0.5);
  });

  it("ignores calls without a version attribution", () => {
    const r = computeAbStats({
      versions: [MAIN],
      calls: [call("v-main", "COMPLETED", "booked"), call(null, "COMPLETED", "booked")],
    });
    expect(r.versions[0].calls).toBe(1);
  });

  it("treats only positive outcomes as conversions", () => {
    expect(AB_CONVERSION_OUTCOMES.has("booked")).toBe(true);
    expect(AB_CONVERSION_OUTCOMES.has("qualified")).toBe(true);
    expect(AB_CONVERSION_OUTCOMES.has("payment-promised")).toBe(true);
    expect(AB_CONVERSION_OUTCOMES.has("not-interested")).toBe(false);
    expect(AB_CONVERSION_OUTCOMES.has("message-taken")).toBe(false);
  });
});
