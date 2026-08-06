import { describe, expect, it } from "vitest";
import { ADDON_CATALOG, addonGateEffect, getAddOn, monthlyAddOnTotal } from "../src/lib/addons";
import { shouldAutoTopUp } from "../src/lib/autotopup";
import { summarizeUsage } from "../src/lib/reseller";
import { trialMinutesRemaining, kycGateError } from "../src/lib/trial";

describe("add-on catalog", () => {
  it("covers the four spec add-ons with unique codes", () => {
    expect(ADDON_CATALOG.map((a) => a.code)).toEqual([
      "extra_line",
      "premium_voices",
      "white_label",
      "dedicated_infra",
    ]);
    expect(new Set(ADDON_CATALOG.map((a) => a.code)).size).toBe(4);
    for (const a of ADDON_CATALOG) expect(a.monthlyPricePaise).toBeGreaterThan(0);
  });
  it("computes monthly totals and gate effects", () => {
    expect(monthlyAddOnTotal(["extra_line", "premium_voices"])).toBe(49900 + 99900);
    expect(monthlyAddOnTotal(["nonsense"])).toBe(0);
    expect(addonGateEffect(["extra_line"], "concurrentLines")).toEqual({ limitBonus: 1, flag: false });
    expect(addonGateEffect(["white_label"], "whiteLabel")).toEqual({ limitBonus: 0, flag: true });
    expect(addonGateEffect(["extra_line"], "whiteLabel")).toEqual({ limitBonus: 0, flag: false });
  });
  it("proration-free purchase: getAddOn prices are the full monthly price", () => {
    expect(getAddOn("extra_line")?.monthlyPricePaise).toBe(49900);
  });
});

describe("shouldAutoTopUp (trigger condition)", () => {
  it("fires only when active AND below threshold", () => {
    expect(shouldAutoTopUp({ active: true, thresholdPaise: 50000 }, 49999)).toBe(true);
    expect(shouldAutoTopUp({ active: true, thresholdPaise: 50000 }, 50000)).toBe(false);
    expect(shouldAutoTopUp({ active: false, thresholdPaise: 50000 }, 100)).toBe(false);
    expect(shouldAutoTopUp(null, 100)).toBe(false);
  });
});

describe("summarizeUsage (reseller rollup aggregation)", () => {
  it("aggregates calls, minutes, revenue, margin", () => {
    const s = summarizeUsage({
      calls: [
        { durationSec: 200, billedPaise: 392, wholesalePaise: 280 },
        { durationSec: 61, billedPaise: 100, wholesalePaise: 70 },
      ],
    });
    expect(s.totalCalls).toBe(2);
    expect(s.totalMinutes).toBe(6); // ceil(200/60)+ceil(61/60) = 4+2
    expect(s.revenuePaise).toBe(492);
    expect(s.costPaise).toBe(350);
    expect(s.marginPaise).toBe(142);
  });
  it("empty input → all zeros", () => {
    expect(summarizeUsage({ calls: [] })).toEqual({
      totalCalls: 0, totalMinutes: 0, revenuePaise: 0, costPaise: 0, marginPaise: 0,
    });
  });
});

describe("trial helpers", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  it("trialMinutesRemaining respects usage and expiry", () => {
    expect(
      trialMinutesRemaining({ trialMinutesUsed: 10, trialMinutesLimit: 30, expiresAt: null }, now)
    ).toBe(20);
    expect(
      trialMinutesRemaining(
        { trialMinutesUsed: 0, trialMinutesLimit: 30, expiresAt: new Date("2026-01-01") },
        now
      )
    ).toBe(0);
    expect(
      trialMinutesRemaining({ trialMinutesUsed: 99, trialMinutesLimit: 30, expiresAt: null }, now)
    ).toBe(0);
  });
  it("kycGateError blocks regulated series until VERIFIED", () => {
    expect(kycGateError("SERIES_140", "NOT_STARTED")).toContain("KYC");
    expect(kycGateError("SERIES_1600", "PENDING")).toContain("KYC");
    expect(kycGateError("SERIES_140", "VERIFIED")).toBeNull();
    expect(kycGateError("LOCAL", "NOT_STARTED")).toBeNull();
  });
});
