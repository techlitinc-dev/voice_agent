/**
 * Pure analytics aggregations (spec §8 + executive dashboard guide 01).
 * No DB access — every function takes fixture-friendly row types so Vitest
 * can pin the math exactly. Money is integer paise everywhere.
 */

// ---------- Date ranges (executive dashboard guide 01 §6) ----------

export type DateRange = { start: Date; end: Date };

/** Start of the local day for a date. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** End of the local day for a date (23:59:59.999). */
export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function subMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() - n, 1);
}

export function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

const PRESET_DEFAULTS: Record<string, DateRange> = {};

export function registerDatePreset(preset: string, range: DateRange): void {
  PRESET_DEFAULTS[preset] = range;
}

/** Resolve a dashboard range preset to { start, end }. Defaults to last 7 days. */
export function getDateRange(preset: string): DateRange {
  const now = new Date();
  switch (preset) {
    case "today": return { start: startOfDay(now), end: now };
    case "yesterday": return { start: startOfDay(subDays(now, 1)), end: endOfDay(subDays(now, 1)) };
    case "7d": return { start: subDays(now, 7), end: now };
    case "30d": return { start: subDays(now, 30), end: now };
    case "90d": return { start: subDays(now, 90), end: now };
    case "month": return { start: startOfMonth(now), end: now };
    case "lastmonth": return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
    case "quarter": return { start: startOfQuarter(now), end: now };
    case "custom": return { start: subDays(now, 30), end: now };
    default: return PRESET_DEFAULTS[preset] ?? { start: subDays(now, 7), end: now };
  }
}

/** Same window length as the current range, immediately before it (for trends). */
export function previousRange(range: DateRange): DateRange {
  const span = range.end.getTime() - range.start.getTime();
  return { start: new Date(range.start.getTime() - span), end: new Date(range.start.getTime() - 1) };
}

// ---------- Trend helper (executive dashboard guide 01 §2.3) ----------

/** Integer % change between two periods; 100% when prev is 0 and curr > 0, 0% when both 0. */
export function pctChange(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

export type AnalyticsCallRow = {
  createdAt: Date;
  answeredAt: Date | null;
  status: string; // CallStatus enum as string
  direction: string; // INBOUND | OUTBOUND
  outcome: string | null;
  fromNumber: string;
  toNumber: string;
  durationSec: number;
  billedPaise: number;
  costTelephonyPaise: number;
  costSttPaise: number;
  costLlmPaise: number;
  costTtsPaise: number;
};

/** A call counts as "answered" when it reached COMPLETED or has answeredAt set. */
export function isAnswered(c: Pick<AnalyticsCallRow, "status" | "answeredAt">): boolean {
  return c.status === "COMPLETED" || c.answeredAt !== null;
}

/** ASR (answer seize ratio) as an integer percentage 0-100. */
export function computeAsr(calls: Pick<AnalyticsCallRow, "status" | "answeredAt">[]): number {
  if (calls.length === 0) return 0;
  const answered = calls.filter(isAnswered).length;
  return Math.round((answered / calls.length) * 100);
}

/** AHT (average handle time) in whole seconds, over ALL calls in the set. */
export function computeAht(calls: Pick<AnalyticsCallRow, "durationSec">[]): number {
  if (calls.length === 0) return 0;
  return Math.round(calls.reduce((a, c) => a + c.durationSec, 0) / calls.length);
}

/** Total wholesale cost (paise) = telephony + STT + LLM + TTS. */
export function wholesaleCostPaise(c: Pick<AnalyticsCallRow,
  "costTelephonyPaise" | "costSttPaise" | "costLlmPaise" | "costTtsPaise">): number {
  return c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise;
}

export function sumWholesalePaise(calls: Pick<AnalyticsCallRow,
  "costTelephonyPaise" | "costSttPaise" | "costLlmPaise" | "costTtsPaise">[]): number {
  return calls.reduce((a, c) => a + wholesaleCostPaise(c), 0);
}

export function sumBilledPaise(calls: Pick<AnalyticsCallRow, "billedPaise">[]): number {
  return calls.reduce((a, c) => a + c.billedPaise, 0);
}

/** Gross margin percentage 0-100 (integer). 0 when nothing was billed. */
export function marginPercent(billedPaise: number, wholesalePaise: number): number {
  if (billedPaise <= 0) return 0;
  return Math.round(((billedPaise - wholesalePaise) / billedPaise) * 100);
}

/** Cost-per-minute burn in paise/min over a set of calls (0 when no audio time). */
export function burnPaisePerMinute(calls: AnalyticsCallRow[]): number {
  const minutes = calls.reduce((a, c) => a + c.durationSec, 0) / 60;
  if (minutes <= 0) return 0;
  return Math.round(sumWholesalePaise(calls) / minutes);
}

// ---------- Conversion funnel (spec §8: dialed → answered → qualified → booked) ----------

export type Funnel = { dialed: number; answered: number; qualified: number; booked: number };

/** Stages are cumulative: every "booked" call also counts as qualified+answered+dialed. */
export function computeFunnel(calls: AnalyticsCallRow[]): Funnel {
  const outbound = calls.filter((c) => c.direction === "OUTBOUND");
  const answered = outbound.filter(isAnswered);
  const qualified = answered.filter((c) => c.outcome === "qualified" || c.outcome === "booked");
  const booked = answered.filter((c) => c.outcome === "booked");
  return { dialed: outbound.length, answered: answered.length, qualified: qualified.length, booked: booked.length };
}

/** Reach rate = dialed / contacts-in-campaign expressed as integer %; caller passes counts. */
export function ratePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

// ---------- Per-number performance ----------

export type NumberStats = {
  number: string;
  calls: number;
  answered: number;
  asr: number; // integer %
  totalDurationSec: number;
  billedPaise: number;
};

/**
 * "Our number" for a call: the DID we own — fromNumber for OUTBOUND (we dial FROM it),
 * toNumber for INBOUND (the caller dialed it).
 * NOTE: the Prisma Call model has no phoneNumberId column in v1, so grouping is by
 * the E.164 string. Documented deviation, no schema change.
 */
export function ourNumber(c: Pick<AnalyticsCallRow, "direction" | "fromNumber" | "toNumber">): string {
  return c.direction === "OUTBOUND" ? c.fromNumber : c.toNumber;
}

export function perNumberStats(calls: AnalyticsCallRow[]): NumberStats[] {
  const map = new Map<string, AnalyticsCallRow[]>();
  for (const c of calls) {
    const n = ourNumber(c);
    map.set(n, [...(map.get(n) ?? []), c]);
  }
  return [...map.entries()]
    .map(([number, rows]) => ({
      number,
      calls: rows.length,
      answered: rows.filter(isAnswered).length,
      asr: computeAsr(rows),
      totalDurationSec: rows.reduce((a, c) => a + c.durationSec, 0),
      billedPaise: sumBilledPaise(rows),
    }))
    .sort((a, b) => b.calls - a.calls);
}

// ---------- Best time-to-call heatmap (7 day x 24 hour grid of ANSWERED calls) ----------

/** heat[day][hour] = answered call count. day: 0=Sunday .. 6=Saturday (Date.getDay). */
export function buildHeatmap(calls: AnalyticsCallRow[]): number[][] {
  const heat: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const c of calls) {
    if (!isAnswered(c)) continue;
    const at = c.answeredAt ?? c.createdAt;
    heat[at.getDay()][at.getHours()] += 1;
  }
  return heat;
}

// ---------- Agent performance (spec §8) ----------

export type AgentPerfCallRow = {
  agentId: string | null;
  agentName: string;
  scriptAdherenceScore: number | null;
  hallucinationFlag: boolean;
  deadAirSeconds: number;
  qaTotal: number | null; // latest QaScore totalScore (null when unscored)
  qaMax: number | null;
};

export type AgentPerfRow = {
  agentId: string;
  agentName: string;
  calls: number;
  avgScriptAdherence: number | null; // 0-100, null when no scores
  escalationRate: number; // integer % of calls that produced a TransferRequest
  hallucinations: number;
  avgDeadAirSec: number;
  avgQaPercent: number | null; // avg(totalScore/maxScore*100), null when unscored
};

/**
 * transfersForAgent: map agentId -> number of TransferRequests raised on that
 * agent's calls (computed by the caller with a groupBy query).
 */
export function agentPerformance(
  calls: AgentPerfCallRow[],
  transfersForAgent: Map<string, number>,
): AgentPerfRow[] {
  const map = new Map<string, AgentPerfCallRow[]>();
  for (const c of calls) {
    if (!c.agentId) continue;
    map.set(c.agentId, [...(map.get(c.agentId) ?? []), c]);
  }
  const rows: AgentPerfRow[] = [];
  for (const [agentId, rowsForAgent] of map.entries()) {
    const adherence = rowsForAgent.filter((c) => c.scriptAdherenceScore !== null);
    const qa = rowsForAgent.filter((c) => c.qaTotal !== null && c.qaMax !== null && c.qaMax > 0);
    rows.push({
      agentId,
      agentName: rowsForAgent[0].agentName,
      calls: rowsForAgent.length,
      avgScriptAdherence:
        adherence.length === 0
          ? null
          : Math.round(adherence.reduce((a, c) => a + (c.scriptAdherenceScore ?? 0), 0) / adherence.length),
      escalationRate: ratePercent(transfersForAgent.get(agentId) ?? 0, rowsForAgent.length),
      hallucinations: rowsForAgent.filter((c) => c.hallucinationFlag).length,
      avgDeadAirSec: Math.round(rowsForAgent.reduce((a, c) => a + c.deadAirSeconds, 0) / rowsForAgent.length),
      avgQaPercent:
        qa.length === 0
          ? null
          : Math.round(qa.reduce((a, c) => a + ((c.qaTotal ?? 0) / (c.qaMax ?? 1)) * 100, 0) / qa.length),
    });
  }
  return rows.sort((a, b) => b.calls - a.calls);
}

// ---------- Call-to-deal funnel (guide 02 §1) ----------

export type FunnelStage = {
  stage: string;
  count: number;
  conversion: number | null; // integer % vs the previous stage
  valuePaise?: number;
  avgTime?: string;
};

/** Conversion from prev -> curr as integer % (100% when prev is 0 but curr > 0). */
export function funnelConversion(curr: number, prev: number): number {
  if (prev <= 0) return curr > 0 ? 100 : 0;
  return Math.round((curr / prev) * 100);
}

/** Drop-off % from prev -> curr (0 when prev is 0). */
export function funnelDropoff(prev: number, curr: number): number {
  if (prev <= 0) return 0;
  return Math.round(((prev - curr) / prev) * 100);
}

/** Stage index with the largest absolute drop-off (0 when flat/empty). */
export function biggestDropoff(stages: FunnelStage[]): number {
  let max = 0;
  let idx = 0;
  for (let i = 0; i + 1 < stages.length; i++) {
    const drop = stages[i].count - stages[i + 1].count;
    if (drop > max) {
      max = drop;
      idx = i;
    }
  }
  return idx;
}

// ---------- Cohort retention (guide 02 §3) ----------

export type CohortRow = {
  cohortMonth: string; // YYYY-MM
  cohortSize: number;
  week0: number;
  week1: number;
  week2: number;
  week4: number;
  week8: number;
};

export const COHORT_WEEKS = ["week0", "week1", "week2", "week4", "week8"] as const;

/**
 * Bucket an elapsed (ms) into week-0/1/2/4/8 retention buckets, matching the
 * retention matrix semantics: week1 = 7-13d, week2 = 14-27d, week4 = 28-55d,
 * week8 = 56d+.
 */
export function retentionBucket(elapsedMs: number): (typeof COHORT_WEEKS)[number] | null {
  const days = elapsedMs / 86400000;
  if (days < 7) return "week0";
  if (days < 14) return "week1";
  if (days < 28) return "week2";
  if (days < 56) return "week4";
  return "week8";
}

// ---------- Time to conversion (guide 02 §4) ----------

export type TimeToConversion = {
  buckets: Record<"0-3" | "4-7" | "8-14" | "15-30" | "30+", number>;
  median: number | null; // days
  average: number | null; // days
};

export type TimeToConversionBucket = "0-3" | "4-7" | "8-14" | "15-30" | "30+";

export function timeToConversionBucket(days: number): TimeToConversionBucket {
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  if (days <= 30) return "15-30";
  return "30+";
}

/** Days-to-close distribution + median/average from per-deal day counts. */
export function computeTimeToConversion(daysToClose: number[]): TimeToConversion {
  const buckets: TimeToConversion["buckets"] = { "0-3": 0, "4-7": 0, "8-14": 0, "15-30": 0, "30+": 0 };
  for (const days of daysToClose) buckets[timeToConversionBucket(days)] += 1;
  const sorted = [...daysToClose].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n === 0
    ? null
    : n % 2 === 1
      ? sorted[(n - 1) / 2]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const average = n === 0 ? null : sorted.reduce((a, b) => a + b, 0) / n;
  return { buckets, median, average };
}

// ---------- Cost & revenue attribution (guide 03) ----------

/** ROI multiple (e.g. 1.57×) from revenue/cost; 0 when cost is 0. */
export function roiMultiple(revenuePaise: number, costPaise: number): number {
  if (costPaise <= 0) return 0;
  return Math.round((revenuePaise / costPaise) * 100) / 100;
}

/** Cost/min in paise from total cost + duration; 0 when no audio time. */
export function costPerMinutePaise(costPaise: number, durationSec: number): number {
  const minutes = durationSec / 60;
  if (minutes <= 0) return 0;
  return Math.round(costPaise / minutes);
}

/** Avg cost/call in paise; 0 when no calls. */
export function avgCostPerCallPaise(costPaise: number, calls: number): number {
  if (calls <= 0) return 0;
  return Math.round(costPaise / calls);
}

// ---------- Revenue recognition (guide 03 §4.1) ----------

export type RevenueRecognition = {
  recognizedPaise: number; // SUM(billedPaise) on COMPLETED calls
  pendingCalls: number; // active (RINGING/IN_PROGRESS) calls not yet billed
  pendingEstimatePaise: number; // active calls × avg cost/call
  deferredPaise: number; // wallet balance not yet consumed
};

export function computeRevenueRecognition(input: {
  completedBilledPaise: number;
  activeCalls: number;
  avgCostPaisePerCall: number;
  walletBalancePaise: number;
}): RevenueRecognition {
  return {
    recognizedPaise: input.completedBilledPaise,
    pendingCalls: input.activeCalls,
    pendingEstimatePaise: Math.round(input.activeCalls * input.avgCostPaisePerCall),
    deferredPaise: input.walletBalancePaise,
  };
}

// ---------- MRR/ARR (guide 03 §4.2) ----------

export type Mrr = { planMrrPaise: number; usageMrrPaise: number; totalMrrPaise: number };

export function computeMrr(planPaise: number, usagePaise: number): Mrr {
  return { planMrrPaise: planPaise, usageMrrPaise: usagePaise, totalMrrPaise: planPaise + usagePaise };
}


