import { describe, expect, it } from "vitest";
import {
  agentPerformance,
  avgCostPerCallPaise,
  biggestDropoff,
  buildHeatmap,
  burnPaisePerMinute,
  computeAht,
  computeAsr,
  computeFunnel,
  computeMrr,
  computeRevenueRecognition,
  computeTimeToConversion,
  costPerMinutePaise,
  funnelConversion,
  funnelDropoff,
  getDateRange,
  marginPercent,
  ourNumber,
  pctChange,
  perNumberStats,
  previousRange,
  ratePercent,
  retentionBucket,
  roiMultiple,
  startOfDay,
  subDays,
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

// ---------- Executive dashboard helpers (guide 01 §2.3 + §6) ----------

describe("pctChange", () => {
  it("computes integer % change", () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
  });
  it("guards divide-by-zero: 100% when prev is 0 and curr > 0, else 0%", () => {
    expect(pctChange(5, 0)).toBe(100);
    expect(pctChange(0, 0)).toBe(0);
  });
});

describe("getDateRange", () => {
  it("'today' starts at local midnight", () => {
    const range = getDateRange("today");
    expect(range.start.getTime()).toBe(startOfDay(new Date()).getTime());
    expect(range.end.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it("'7d' spans exactly 7 days", () => {
    const range = getDateRange("7d");
    expect(range.start.getTime()).toBe(subDays(new Date(), 7).getTime());
  });
  it("defaults to last 7 days for unknown presets", () => {
    const range = getDateRange("nope");
    expect(range.start.getTime()).toBe(subDays(new Date(), 7).getTime());
  });
});

describe("previousRange", () => {
  it("builds an equal-length window before the current range", () => {
    const current = { start: new Date("2024-07-08T00:00:00Z"), end: new Date("2024-07-15T00:00:00Z") };
    const prev = previousRange(current);
    expect(prev.start.toISOString()).toBe("2024-07-01T00:00:00.000Z");
    expect(prev.end.toISOString()).toBe("2024-07-07T23:59:59.999Z");
  });
});

// ---------- Funnel & cohort helpers (guide 02 §1, §3, §4) ----------

describe("funnelConversion / funnelDropoff", () => {
  it("computes integer % conversion between stages", () => {
    expect(funnelConversion(450, 1000)).toBe(45);
    expect(funnelConversion(0, 100)).toBe(0);
  });
  it("guards divide-by-zero", () => {
    expect(funnelConversion(5, 0)).toBe(100);
    expect(funnelConversion(0, 0)).toBe(0);
  });
  it("computes drop-off %", () => {
    expect(funnelDropoff(1000, 450)).toBe(55);
    expect(funnelDropoff(0, 0)).toBe(0);
  });
});

describe("biggestDropoff", () => {
  it("finds the stage with the largest absolute drop", () => {
    const stages = [
      { stage: "A", count: 1000, conversion: null },
      { stage: "B", count: 450, conversion: 45 },
      { stage: "C", count: 300, conversion: 67 },
      { stage: "D", count: 120, conversion: 40 },
      { stage: "E", count: 70, conversion: 58 },
    ];
    expect(biggestDropoff(stages)).toBe(0); // 1000-450 = 550 is the biggest absolute drop
  });
  it("handles flat and empty funnels", () => {
    expect(biggestDropoff([{ stage: "A", count: 10, conversion: null }, { stage: "B", count: 10, conversion: 100 }])).toBe(0);
    expect(biggestDropoff([])).toBe(0);
  });
});

describe("retentionBucket", () => {
  it("maps elapsed time to week-0/1/2/4/8 buckets", () => {
    const day = 86400000;
    expect(retentionBucket(0)).toBe("week0");
    expect(retentionBucket(6.9 * day)).toBe("week0");
    expect(retentionBucket(7 * day)).toBe("week1");
    expect(retentionBucket(13 * day)).toBe("week1");
    expect(retentionBucket(14 * day)).toBe("week2");
    expect(retentionBucket(27 * day)).toBe("week2");
    expect(retentionBucket(28 * day)).toBe("week4");
    expect(retentionBucket(55 * day)).toBe("week4");
    expect(retentionBucket(56 * day)).toBe("week8");
    expect(retentionBucket(365 * day)).toBe("week8");
  });
});

describe("computeTimeToConversion", () => {
  it("buckets days-to-close and computes median + average", () => {
    const days = [1, 2, 5, 6, 9, 20, 45]; // sorted: 1,2,5,6,9,20,45
    const result = computeTimeToConversion(days);
    expect(result.buckets).toEqual({ "0-3": 2, "4-7": 2, "8-14": 1, "15-30": 1, "30+": 1 });
    expect(result.median).toBe(6);
    expect(result.average).toBeCloseTo(12.571, 1);
  });
  it("handles empty input", () => {
    const result = computeTimeToConversion([]);
    expect(result.buckets).toEqual({ "0-3": 0, "4-7": 0, "8-14": 0, "15-30": 0, "30+": 0 });
    expect(result.median).toBeNull();
    expect(result.average).toBeNull();
  });
});

// ---------- Cost & revenue attribution helpers (guide 03) ----------

describe("roiMultiple", () => {
  it("computes revenue/cost multiple", () => {
    expect(roiMultiple(22000, 14000)).toBe(1.57);
    expect(roiMultiple(8100, 6300)).toBe(1.29);
  });
  it("guards divide-by-zero", () => {
    expect(roiMultiple(100, 0)).toBe(0);
  });
});

describe("costPerMinutePaise / avgCostPerCallPaise", () => {
  it("computes cost per minute from cost + duration", () => {
    // 1000 paise over 5 min (300s) = 200 paise/min
    expect(costPerMinutePaise(1000, 300)).toBe(200);
    expect(costPerMinutePaise(1000, 0)).toBe(0);
  });
  it("computes avg cost per call", () => {
    expect(avgCostPerCallPaise(1000, 4)).toBe(250);
    expect(avgCostPerCallPaise(1000, 0)).toBe(0);
  });
});

describe("computeRevenueRecognition", () => {
  it("recognizes completed billing, estimates pending, defers wallet", () => {
    const result = computeRevenueRecognition({
      completedBilledPaise: 5000,
      activeCalls: 3,
      avgCostPaisePerCall: 200,
      walletBalancePaise: 12000,
    });
    expect(result.recognizedPaise).toBe(5000);
    expect(result.pendingCalls).toBe(3);
    expect(result.pendingEstimatePaise).toBe(600);
    expect(result.deferredPaise).toBe(12000);
  });
});

describe("computeMrr", () => {
  it("sums plan + usage MRR", () => {
    const mrr = computeMrr(200000, 50000); // ₹2,000 + ₹500
    expect(mrr.planMrrPaise).toBe(200000);
    expect(mrr.usageMrrPaise).toBe(50000);
    expect(mrr.totalMrrPaise).toBe(250000);
  });
});
