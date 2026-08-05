import { describe, expect, it } from "vitest";
import { classifySpam, RAPID_REPEAT_MAX_CALLS } from "../src/lib/spamFilter";

const BASE = {
  phone: "+919812345678",
  manualBlocked: false,
  recentCalls: 0,
  maxCallsPerWindow: RAPID_REPEAT_MAX_CALLS,
  prefixes: [] as string[],
};

describe("classifySpam", () => {
  it("clean caller passes", () => {
    expect(classifySpam(BASE)).toEqual({ spam: false });
  });
  it("manual block wins over everything", () => {
    const v = classifySpam({ ...BASE, manualBlocked: true, recentCalls: 99, prefixes: ["+91"] });
    expect(v).toEqual({ spam: true, reason: "manual-block" });
  });
  it("spam prefix blocks", () => {
    const v = classifySpam({ ...BASE, phone: "+911401234567", prefixes: ["+91140"] });
    expect(v).toEqual({ spam: true, reason: "spam-prefix" });
  });
  it("non-matching prefix does not block", () => {
    const v = classifySpam({ ...BASE, phone: "+919812345678", prefixes: ["+91140"] });
    expect(v.spam).toBe(false);
  });
  it("empty prefix entries are ignored", () => {
    const v = classifySpam({ ...BASE, prefixes: [""] });
    expect(v.spam).toBe(false);
  });
  it("rapid repeat over the limit blocks", () => {
    const v = classifySpam({ ...BASE, recentCalls: RAPID_REPEAT_MAX_CALLS + 1 });
    expect(v).toEqual({ spam: true, reason: "rapid-repeat" });
  });
  it("exactly at the limit does NOT block", () => {
    const v = classifySpam({ ...BASE, recentCalls: RAPID_REPEAT_MAX_CALLS });
    expect(v.spam).toBe(false);
  });
  it("manual block takes priority over rapid-repeat", () => {
    const v = classifySpam({ ...BASE, manualBlocked: true, recentCalls: 99 });
    expect(v.reason).toBe("manual-block");
  });
});
