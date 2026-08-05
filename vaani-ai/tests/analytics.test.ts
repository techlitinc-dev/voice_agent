import { describe, expect, it } from "vitest";
import {
  agentPerformance,
  buildHeatmap,
  burnPaisePerMinute,
  computeAht,
  computeAsr,
  computeFunnel,
  marginPercent,
  ourNumber,
  perNumberStats,
  ratePercent,
  sumBilledPaise,
  sumWholesalePaise,
  wholesaleCostPaise,
  type AgentPerfCallRow,
  type AnalyticsCallRow,
} from "../src/lib/analytics";

function row(partial: Partial<AnalyticsCallRow>): AnalyticsCallRow {
  return {
    createdAt: new Date("2024-07-02T10:00:00Z"),
    answeredAt: null,
    status: "COMPLETED",
    direction: "OUTBOUND",
    outcome: null,
    fromNumber: "+918040001234",
    toNumber: "+919900000001",
    durationSec: 60,
    billedPaise: 0,
    costTelephonyPaise: 10,
    costSttPaise: 5,
    costLlmPaise: 5,
    costTtsPaise: 10,
    ...partial,
  };
}

describe("computeAsr", () => {
  it("is 0 for no calls", () => {
    expect(computeAsr([])).toBe(0);
  });
  it("counts COMPLETED or answeredAt as answered", () => {
    const calls = [
      row({ status: "COMPLETED" }),
      row({ status: "NO_ANSWER" }),
      row({ status: "BUSY" }),
      row({ status: "IN_PROGRESS", answeredAt: new Date() }),
    ];
    expect(computeAsr(calls)).toBe(50);
  });
});

describe("computeAht", () => {
  it("averages durations in whole seconds", () => {
    expect(computeAht([row({ durationSec: 61 }), row({ durationSec: 62 })])).toBe(62);
    expect(computeAht([])).toBe(0);
  });
});

describe("cost helpers", () => {
  it("sums the 4 components", () => {
    expect(wholesaleCostPaise(row({}))).toBe(30);
  });
  it("sums over a set and computes margin", () => {
    const calls = [row({ billedPaise: 100 }), row({ billedPaise: 100 })];
    expect(sumWholesalePaise(calls)).toBe(60);
    expect(sumBilledPaise(calls)).toBe(200);
    expect(marginPercent(200, 60)).toBe(70);
    expect(marginPercent(0, 60)).toBe(0);
  });
  it("computes burn paise per minute", () => {
    // 2 calls x 60s = 2 minutes; wholesale 30 paise each = 60 -> 30 paise/min
    expect(burnPaisePerMinute([row({}), row({})])).toBe(30);
    expect(burnPaisePerMinute([row({ durationSec: 0, costTelephonyPaise: 0, costSttPaise: 0, costLlmPaise: 0, costTtsPaise: 0 })])).toBe(0);
  });
});

describe("computeFunnel", () => {
  it("builds cumulative dialed->answered->qualified->booked stages", () => {
    const calls = [
      row({ outcome: "booked" }),                       // dialed+answered+qualified+booked
      row({ outcome: "qualified" }),                    // dialed+answered+qualified
      row({ outcome: "not-interested" }),               // dialed+answered
      row({ status: "NO_ANSWER" }),                     // dialed only
      row({ direction: "INBOUND", outcome: "booked" }), // inbound: excluded from funnel
    ];
    expect(computeFunnel(calls)).toEqual({ dialed: 4, answered: 3, qualified: 2, booked: 1 });
  });
});

describe("ratePercent", () => {
  it("guards divide-by-zero", () => {
    expect(ratePercent(5, 0)).toBe(0);
    expect(ratePercent(1, 4)).toBe(25);
  });
});

describe("ourNumber / perNumberStats", () => {
  it("picks fromNumber for outbound and toNumber for inbound", () => {
    expect(ourNumber(row({ direction: "OUTBOUND", fromNumber: "+9114A", toNumber: "+9199B" }))).toBe("+9114A");
    expect(ourNumber(row({ direction: "INBOUND", fromNumber: "+9199B", toNumber: "+9180A" }))).toBe("+9180A");
  });
  it("groups per-number stats sorted by call count", () => {
    const calls = [
      row({ fromNumber: "+9114A" }),
      row({ fromNumber: "+9114A", status: "NO_ANSWER" }),
      row({ fromNumber: "+9114B", billedPaise: 500 }),
    ];
    const stats = perNumberStats(calls);
    expect(stats[0].number).toBe("+9114A");
    expect(stats[0].calls).toBe(2);
    expect(stats[0].asr).toBe(50);
    expect(stats[1].billedPaise).toBe(500);
  });
});

describe("buildHeatmap", () => {
  it("counts only answered calls into day/hour buckets", () => {
    const tue10 = new Date("2024-07-02T10:30:00"); // a Tuesday (getDay()=2) at 10h local
    const calls = [
      row({ createdAt: tue10, answeredAt: tue10 }),
      row({ createdAt: tue10, answeredAt: tue10 }),
      row({ createdAt: tue10, status: "NO_ANSWER", answeredAt: null }),
    ];
    const heat = buildHeatmap(calls);
    expect(heat[tue10.getDay()][tue10.getHours()]).toBe(2);
    expect(heat.flat().reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("agentPerformance", () => {
  it("aggregates adherence, escalation, hallucinations, dead air, QA", () => {
    const calls: AgentPerfCallRow[] = [
      { agentId: "a1", agentName: "Priya", scriptAdherenceScore: 90, hallucinationFlag: false, deadAirSeconds: 2, qaTotal: 38, qaMax: 40 },
      { agentId: "a1", agentName: "Priya", scriptAdherenceScore: 80, hallucinationFlag: true, deadAirSeconds: 6, qaTotal: null, qaMax: null },
      { agentId: "a2", agentName: "Rao", scriptAdherenceScore: null, hallucinationFlag: false, deadAirSeconds: 0, qaTotal: null, qaMax: null },
    ];
    const transfers = new Map([["a1", 1]]);
    const rows = agentPerformance(calls, transfers);
    expect(rows[0].agentId).toBe("a1"); // most calls first
    expect(rows[0].avgScriptAdherence).toBe(85);
    expect(rows[0].escalationRate).toBe(50); // 1 transfer / 2 calls
    expect(rows[0].hallucinations).toBe(1);
    expect(rows[0].avgDeadAirSec).toBe(4);
    expect(rows[0].avgQaPercent).toBe(95); // 38/40
    expect(rows[1].avgScriptAdherence).toBeNull();
    expect(rows[1].avgQaPercent).toBeNull();
  });
});
