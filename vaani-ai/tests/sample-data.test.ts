import { describe, expect, it } from "vitest";
import {
  SAMPLE_PHONE_PREFIX,
  SAMPLE_PREFIX,
  buildSampleCalls,
  buildSampleContacts,
  sampleCallWhere,
  sampleContactWhere,
} from "@/lib/sample-data";

const WS = "ws_test_123";

describe("buildSampleContacts", () => {
  it("creates 5 contacts, all workspace-scoped and marked by the reserved phone range", () => {
    const rows = buildSampleContacts(WS);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.workspaceId).toBe(WS);
      expect(r.phone.startsWith(SAMPLE_PHONE_PREFIX)).toBe(true);
      expect(r.name.startsWith(SAMPLE_PREFIX)).toBe(true);
      expect(r.attributes.sample).toBe(true);
      expect(r.timezone).toBe("Asia/Kolkata");
    }
  });

  it("phone numbers are unique", () => {
    const phones = buildSampleContacts(WS).map((r) => r.phone);
    expect(new Set(phones).size).toBe(phones.length);
  });
});

describe("buildSampleCalls", () => {
  const calls = buildSampleCalls({
    workspaceId: WS,
    agentId: "agent_1",
    campaignId: "camp_1",
    businessNumber: "+918040009999",
  });

  it("creates 5 completed calls with integer-paise cost fields", () => {
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect(c.workspaceId).toBe(WS);
      expect(c.status).toBe("COMPLETED");
      for (const field of [
        c.costTelephonyPaise,
        c.costSttPaise,
        c.costLlmPaise,
        c.costTtsPaise,
        c.billedPaise,
      ]) {
        expect(Number.isInteger(field)).toBe(true);
      }
    }
  });

  it("mixes inbound and outbound; outbound calls are tied to the sample campaign", () => {
    const inbound = calls.filter((c) => c.direction === "INBOUND");
    const outbound = calls.filter((c) => c.direction === "OUTBOUND");
    expect(inbound.length).toBeGreaterThan(0);
    expect(outbound.length).toBeGreaterThan(0);
    for (const c of outbound) expect(c.campaignId).toBe("camp_1");
    for (const c of inbound) expect(c.campaignId).toBeNull();
  });

  it("every call touches either the sample phone range or the Sample prefix (clearable)", () => {
    for (const c of calls) {
      const marked =
        c.fromNumber.startsWith(SAMPLE_PHONE_PREFIX) ||
        c.toNumber.startsWith(SAMPLE_PHONE_PREFIX) ||
        c.summary.startsWith(SAMPLE_PREFIX);
      expect(marked).toBe(true);
    }
  });

  it("billed paise is 0 for a 0-second call (no free-ride, no negative)", () => {
    const noAnswer = calls.find((c) => c.durationSec === 0);
    expect(noAnswer?.billedPaise).toBe(0);
  });
});

describe("sample where fragments", () => {
  it("are always workspace-scoped", () => {
    expect(sampleCallWhere(WS).workspaceId).toBe(WS);
    expect(sampleContactWhere(WS).workspaceId).toBe(WS);
    expect(sampleContactWhere(WS).phone.startsWith).toBe(SAMPLE_PHONE_PREFIX);
  });
});
