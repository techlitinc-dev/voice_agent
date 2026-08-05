/**
 * Pure analytics aggregations (spec §8). No DB access — every function takes
 * fixture-friendly row types so Vitest can pin the math exactly.
 * Money is integer paise everywhere.
 */

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
export function computeAsr(calls: AnalyticsCallRow[]): number {
  if (calls.length === 0) return 0;
  const answered = calls.filter(isAnswered).length;
  return Math.round((answered / calls.length) * 100);
}

/** AHT (average handle time) in whole seconds, over ALL calls in the set. */
export function computeAht(calls: AnalyticsCallRow[]): number {
  if (calls.length === 0) return 0;
  return Math.round(calls.reduce((a, c) => a + c.durationSec, 0) / calls.length);
}

/** Total wholesale cost (paise) = telephony + STT + LLM + TTS. */
export function wholesaleCostPaise(c: Pick<AnalyticsCallRow,
  "costTelephonyPaise" | "costSttPaise" | "costLlmPaise" | "costTtsPaise">): number {
  return c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise;
}

export function sumWholesalePaise(calls: AnalyticsCallRow[]): number {
  return calls.reduce((a, c) => a + wholesaleCostPaise(c), 0);
}

export function sumBilledPaise(calls: AnalyticsCallRow[]): number {
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
