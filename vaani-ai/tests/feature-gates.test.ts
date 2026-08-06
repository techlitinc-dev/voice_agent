import { describe, expect, it } from "vitest";
import { evaluateGate, STARTER_DEFAULTS } from "../src/lib/feature-gates";
import type { PlanGateFields } from "../src/lib/feature-gates";

const growth: PlanGateFields = {
  code: "growth",
  maxAgents: 10,
  maxSeats: 10,
  concurrentLines: 10,
  whiteLabel: false,
  premiumVoices: true,
  dedicatedInfra: false,
  featureGates: { qa_scoring: true, api_access: true },
};

describe("evaluateGate — numeric plan limits", () => {
  it("blocks at the plan limit (starter maxAgents=2)", () => {
    const g = evaluateGate({ plan: null, activeAddOns: [], gate: "maxAgents", used: 2 });
    expect(g.allowed).toBe(false);
    expect(g.limit).toBe(2);
    expect(g.planCode).toBe("starter"); // no subscription → starter defaults
  });
  it("allows below the limit", () => {
    expect(evaluateGate({ plan: null, activeAddOns: [], gate: "maxAgents", used: 1 }).allowed).toBe(true);
  });
  it("extra_line add-on raises concurrentLines", () => {
    const g = evaluateGate({
      plan: null,
      activeAddOns: ["extra_line", "extra_line"],
      gate: "concurrentLines",
      used: 3,
    });
    expect(g.limit).toBe(4); // 2 + 2 add-on lines
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("addon");
  });
});

describe("evaluateGate — boolean features", () => {
  it("whiteLabel off on starter, on via add-on", () => {
    expect(evaluateGate({ plan: null, activeAddOns: [], gate: "whiteLabel" }).allowed).toBe(false);
    const g = evaluateGate({ plan: null, activeAddOns: ["white_label"], gate: "whiteLabel" });
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("addon");
  });
  it("premiumVoices on from the plan itself", () => {
    const g = evaluateGate({ plan: growth, activeAddOns: [], gate: "premiumVoices" });
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("plan");
  });
});

describe("evaluateGate — featureGates JSON keys", () => {
  it("reads arbitrary keys from Plan.featureGates", () => {
    expect(evaluateGate({ plan: growth, activeAddOns: [], gate: "qa_scoring" }).allowed).toBe(true);
    expect(evaluateGate({ plan: growth, activeAddOns: [], gate: "reseller_panel" }).allowed).toBe(false);
  });
  it("starter defaults expose nothing", () => {
    expect(STARTER_DEFAULTS.featureGates).toBeNull();
    expect(evaluateGate({ plan: null, activeAddOns: [], gate: "api_access" }).allowed).toBe(false);
  });
});
