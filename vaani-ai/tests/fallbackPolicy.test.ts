import { describe, expect, it } from "vitest";
import {
  decideTransfer,
  parseHumanTransferConfig,
  type HumanTransferConfig,
} from "../src/lib/fallbackPolicy";

const CONFIG: HumanTransferConfig = {
  queue: "support",
  skill: "hindi",
  vipNumbers: ["+919812345678"],
  queueDestinations: { support: "+919800000001" },
  autoTransfer: {
    onExplicitRequest: true,
    onRepeatedMisunderstanding: true,
    onLowConfidence: false,
    onVip: true,
  },
  maxMisunderstandings: 3,
};

describe("parseHumanTransferConfig", () => {
  it("parses a full config", () => {
    const c = parseHumanTransferConfig(CONFIG);
    expect(c.queue).toBe("support");
    expect(c.maxMisunderstandings).toBe(3);
  });
  it("undefined/null/garbage → defaults, never throws", () => {
    for (const raw of [undefined, null, "garbage", 42, { autoTransfer: "nope" }]) {
      const c = parseHumanTransferConfig(raw);
      expect(c.queue).toBe("support");
      expect(c.vipNumbers).toEqual([]);
      expect(c.autoTransfer.onExplicitRequest).toBe(true);
      expect(c.autoTransfer.onLowConfidence).toBe(false);
    }
  });
  it("partial config fills defaults", () => {
    const c = parseHumanTransferConfig({ queue: "sales", vipNumbers: ["+91"] });
    expect(c.queue).toBe("sales");
    expect(c.autoTransfer.onVip).toBe(true);
  });
});

describe("decideTransfer", () => {
  it("VIP caller transfers with reason vip", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+919812345678" });
    expect(d).toEqual({ transfer: true, reason: "vip", queue: "support", skill: "hindi" });
  });
  it("explicit human request transfers", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", explicitHumanRequest: true });
    expect(d.reason).toBe("explicit-request");
  });
  it("repeated misunderstanding at threshold transfers", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", misunderstandingCount: 3 });
    expect(d.reason).toBe("repeated-misunderstanding");
  });
  it("below threshold does not transfer", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", misunderstandingCount: 2 });
    expect(d.transfer).toBe(false);
  });
  it("low confidence ignored when disabled", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", lowConfidence: true });
    expect(d.transfer).toBe(false);
  });
  it("low confidence transfers when enabled", () => {
    const c = { ...CONFIG, autoTransfer: { ...CONFIG.autoTransfer, onLowConfidence: true } };
    const d = decideTransfer(c, { callerPhone: "+911", lowConfidence: true });
    expect(d.reason).toBe("low-confidence");
  });
  it("VIP beats explicit request (priority order)", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+919812345678", explicitHumanRequest: true });
    expect(d.reason).toBe("vip");
  });
  it("disabled VIP flag stops VIP transfer", () => {
    const c = { ...CONFIG, autoTransfer: { ...CONFIG.autoTransfer, onVip: false } };
    const d = decideTransfer(c, { callerPhone: "+919812345678" });
    expect(d.transfer).toBe(false);
  });
  it("calm call does not transfer", () => {
    expect(decideTransfer(CONFIG, { callerPhone: "+911" }).transfer).toBe(false);
  });
});
