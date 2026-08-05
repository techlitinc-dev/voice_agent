import { describe, expect, it } from "vitest";
import { buildDigestText, frequencyWindowMs, isDigestDue, type DigestStats } from "../src/lib/digest";

describe("frequencyWindowMs", () => {
  it("maps frequencies to windows", () => {
    expect(frequencyWindowMs("DAILY")).toBe(86_400_000);
    expect(frequencyWindowMs("WEEKLY")).toBe(604_800_000);
    expect(frequencyWindowMs("MONTHLY")).toBe(2_592_000_000);
  });
});

describe("isDigestDue", () => {
  const now = new Date("2024-07-08T12:00:00Z");
  it("is due when never sent", () => {
    expect(isDigestDue("DAILY", null, now)).toBe(true);
  });
  it("is due after one full period", () => {
    expect(isDigestDue("DAILY", new Date("2024-07-07T11:59:59Z"), now)).toBe(true);
  });
  it("is NOT due inside the period", () => {
    expect(isDigestDue("DAILY", new Date("2024-07-08T01:00:00Z"), now)).toBe(false);
    expect(isDigestDue("WEEKLY", new Date("2024-07-07T12:00:00Z"), now)).toBe(false);
  });
});

describe("buildDigestText", () => {
  const stats: DigestStats = {
    periodLabel: "last 24 hours",
    calls: 12,
    asrPercent: 75,
    ahtSeconds: 95,
    billedPaise: 48000,
    wholesalePaise: 30000,
    topOutcomes: [{ outcome: "booked", count: 5 }, { outcome: "not-interested", count: 3 }],
    hallucinations: 1,
  };
  it("contains every key metric", () => {
    const t = buildDigestText("Demo Dental Clinic", "DAILY", stats);
    expect(t).toContain("Demo Dental Clinic");
    expect(t).toContain("Calls:              12");
    expect(t).toContain("75%");
    expect(t).toContain("₹480.00");
    expect(t).toContain("₹180.00"); // margin
    expect(t).toContain("- booked: 5");
    expect(t).toContain("Hallucination flags: 1");
  });
  it("handles an empty outcome list", () => {
    const t = buildDigestText("W", "WEEKLY", { ...stats, topOutcomes: [] });
    expect(t).toContain("(no outcomes recorded)");
  });
});
