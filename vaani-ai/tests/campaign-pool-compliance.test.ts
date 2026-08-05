import { describe, expect, it } from "vitest";
import { isCapped, pickNumberRoundRobin, type PoolNumber } from "../src/lib/campaign/pool";
import {
  allowedNumberTypes,
  CAMPAIGN_TYPE_SERIES,
  consentBlocks,
  isNumberTypeAllowed,
  poolUsesPromotionalSeries,
  requiresConsent,
  scrubAgainstDnc,
} from "../src/lib/campaign/compliance";

const num = (id: string, over: Partial<PoolNumber> = {}): PoolNumber => ({
  id,
  number: `+9114000000${id}`,
  numberType: "SERIES_140",
  dailyCallCap: null,
  lifetimeCallCap: null,
  dailyCallsUsed: 0,
  lifetimeCallsUsed: 0,
  ...over,
});

describe("pool caps + round-robin", () => {
  it("detects capped numbers", () => {
    expect(isCapped(num("a", { dailyCallCap: 100, dailyCallsUsed: 100 }))).toBe(true);
    expect(isCapped(num("a", { dailyCallCap: 100, dailyCallsUsed: 99 }))).toBe(false);
    expect(isCapped(num("a", { lifetimeCallCap: 5000, lifetimeCallsUsed: 5000 }))).toBe(true);
    expect(isCapped(num("a"))).toBe(false); // no caps = never capped
  });
  it("rotates strictly after lastUsedId and skips capped numbers", () => {
    const a = num("a");
    const b = num("b", { dailyCallCap: 1, dailyCallsUsed: 1 }); // capped
    const c = num("c");
    expect(pickNumberRoundRobin([a, b, c], null)?.id).toBe("a");
    expect(pickNumberRoundRobin([a, b, c], "a")?.id).toBe("c"); // b skipped
    expect(pickNumberRoundRobin([a, b, c], "c")?.id).toBe("a"); // wraps
  });
  it("returns null when the pool is exhausted or empty", () => {
    expect(pickNumberRoundRobin([], null)).toBeNull();
    expect(pickNumberRoundRobin([num("a", { dailyCallCap: 1, dailyCallsUsed: 1 })], null)).toBeNull();
  });
});

describe("campaign type → TRAI series mapping", () => {
  it("maps all 8 types", () => {
    expect(Object.keys(CAMPAIGN_TYPE_SERIES).sort()).toEqual([
      "APPOINTMENT_REMINDER", "EVENT_INVITE", "FEEDBACK_SURVEY", "LEAD_QUALIFICATION",
      "ORDER_CONFIRMATION", "PAYMENT_REMINDER", "POLITICAL_SURVEY", "REACTIVATION",
    ].sort());
    expect(CAMPAIGN_TYPE_SERIES.PAYMENT_REMINDER).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.APPOINTMENT_REMINDER).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.ORDER_CONFIRMATION).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.FEEDBACK_SURVEY).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.LEAD_QUALIFICATION).toBe("PROMOTIONAL");
    expect(CAMPAIGN_TYPE_SERIES.REACTIVATION).toBe("PROMOTIONAL");
    expect(CAMPAIGN_TYPE_SERIES.EVENT_INVITE).toBe("PROMOTIONAL");
    expect(CAMPAIGN_TYPE_SERIES.POLITICAL_SURVEY).toBe("PROMOTIONAL");
  });
  it("allows 140 for promotional, 1600 for service, international DIDs for both", () => {
    expect(allowedNumberTypes("PAYMENT_REMINDER")).toContain("SERIES_1600");
    expect(allowedNumberTypes("PAYMENT_REMINDER")).not.toContain("SERIES_140");
    expect(isNumberTypeAllowed("LEAD_QUALIFICATION", "SERIES_140")).toBe(true);
    expect(isNumberTypeAllowed("LEAD_QUALIFICATION", "SERIES_1600")).toBe(false);
    expect(isNumberTypeAllowed("LEAD_QUALIFICATION", "LOCAL")).toBe(true); // non-India ok
  });
});

describe("consent (TCPA-style)", () => {
  it("only promotional types require consent", () => {
    expect(requiresConsent("LEAD_QUALIFICATION")).toBe(true);
    expect(requiresConsent("PAYMENT_REMINDER")).toBe(false);
  });
  it("blocks only when enforcement is on, type is promotional, consent missing", () => {
    const noConsent = { consentAt: null };
    const withConsent = { consentAt: new Date() };
    expect(consentBlocks(noConsent, "LEAD_QUALIFICATION", true)).toBe(true);
    expect(consentBlocks(withConsent, "LEAD_QUALIFICATION", true)).toBe(false);
    expect(consentBlocks(noConsent, "LEAD_QUALIFICATION", false)).toBe(false); // enforcement off
    expect(consentBlocks(noConsent, "PAYMENT_REMINDER", true)).toBe(false); // service type
  });
});

describe("scrubAgainstDnc", () => {
  it("partitions dialable vs blocked", () => {
    const rows = [{ phone: "+911" }, { phone: "+912" }, { phone: "+913" }];
    const { dialable, blocked } = scrubAgainstDnc(rows, new Set(["+912"]));
    expect(dialable.map((r) => r.phone)).toEqual(["+911", "+913"]);
    expect(blocked.map((r) => r.phone)).toEqual(["+912"]);
  });
});

describe("poolUsesPromotionalSeries", () => {
  it("drives the TRAI-hours guardrail", () => {
    expect(poolUsesPromotionalSeries([{ numberType: "SERIES_140" }])).toBe(true);
    expect(poolUsesPromotionalSeries([{ numberType: "SERIES_1600" }, { numberType: "LOCAL" }])).toBe(false);
  });
});
