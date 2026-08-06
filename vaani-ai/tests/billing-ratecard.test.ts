import { describe, expect, it } from "vitest";
import {
  componentCosts,
  retailTotalPaise,
  wholesaleTotalPaise,
  parseRateCardJson,
  DEFAULT_RATE_CARD,
} from "../src/lib/ratecard";
import { decideTrialBilling } from "../src/lib/billing";

describe("componentCosts (per-second metering)", () => {
  it("computes the canonical 200s call from the default rate card", () => {
    const c = componentCosts(200);
    expect(c.costTelephonyPaise).toBe(100); // ceil(200*30/60)
    expect(c.costSttPaise).toBe(60); // ceil(200*18/60)
    expect(c.costLlmPaise).toBe(40); // ceil(200*12/60)
    expect(c.costTtsPaise).toBe(80); // ceil(200*24/60)
    expect(wholesaleTotalPaise(c)).toBe(280);
  });
  it("rounds partial paise UP per second (31s at ₹0.30/min)", () => {
    expect(componentCosts(31).costTelephonyPaise).toBe(16); // ceil(31*30/60)=15.5→16
  });
  it("bills 0 for zero/negative duration", () => {
    expect(wholesaleTotalPaise(componentCosts(0))).toBe(0);
    expect(wholesaleTotalPaise(componentCosts(-5))).toBe(0);
  });
  it("scales per-second, not per-minute (1s call is not a full minute)", () => {
    expect(componentCosts(1).costTelephonyPaise).toBe(1); // ceil(1*30/60)=0.5→1
    expect(componentCosts(60).costTelephonyPaise).toBe(30);
  });
});

describe("retailTotalPaise (markup per component)", () => {
  it("applies the plan markup (starter 40% on the 200s call → 392)", () => {
    expect(retailTotalPaise(componentCosts(200), 40)).toBe(392);
  });
  it("honours per-plan override (enterprise 50%)", () => {
    expect(retailTotalPaise(componentCosts(200), 50)).toBe(420); // 280*1.5
  });
  it("zero cost → zero billed regardless of markup", () => {
    expect(retailTotalPaise(componentCosts(0), 45)).toBe(0);
  });
});

describe("parseRateCardJson (reseller wholesale override)", () => {
  it("falls back to defaults on garbage", () => {
    expect(parseRateCardJson(null)).toEqual(DEFAULT_RATE_CARD);
    expect(parseRateCardJson("junk")).toEqual(DEFAULT_RATE_CARD);
    expect(parseRateCardJson({ telephonyPerMinPaise: -1 })).toEqual(DEFAULT_RATE_CARD);
  });
  it("merges a partial override", () => {
    const r = parseRateCardJson({ telephonyPerMinPaise: 45 });
    expect(r.telephonyPerMinPaise).toBe(45);
    expect(r.sttPerMinPaise).toBe(DEFAULT_RATE_CARD.sttPerMinPaise);
  });
});

describe("decideTrialBilling (trial-minute enforcement)", () => {
  const base = { trialMinutesUsed: 0, trialMinutesLimit: 30, expiresAt: null, callMinutes: 4 };
  const now = new Date("2026-01-10T00:00:00Z");
  it("uses trial minutes when they fit", () => {
    expect(decideTrialBilling({ ...base, now }).useTrial).toBe(true);
  });
  it("bills the wallet when the call does not fit ENTIRELY", () => {
    expect(
      decideTrialBilling({ ...base, trialMinutesUsed: 28, now }).useTrial
    ).toBe(false); // 28+4 > 30
  });
  it("boundary: exact fit is allowed", () => {
    expect(
      decideTrialBilling({ ...base, trialMinutesUsed: 26, now }).useTrial
    ).toBe(true); // 26+4 = 30
  });
  it("expired trial never applies", () => {
    expect(
      decideTrialBilling({ ...base, expiresAt: new Date("2026-01-01"), now }).useTrial
    ).toBe(false);
  });
});
