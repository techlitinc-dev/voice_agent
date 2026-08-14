/**
 * A/B test conversion tracking (docs/new-features/05 §3.8).
 *
 * "Converts better" = the serving version's share of calls that end with a
 * positive outcome. We treat booked / qualified / payment-promised as
 * conversions; everything else (not-interested, dnc, other, message-taken)
 * does not. Math is pure + unit-tested so the UI and any API can share it.
 */

/** Outcomes that count as a conversion for A/B comparison. */
export const AB_CONVERSION_OUTCOMES = new Set([
  "booked",
  "qualified",
  "payment-promised",
  "payment-link-sent",
]);

export type AbVersionStats = {
  versionId: string;
  version: number;
  label: string | null;
  isAbVariant: boolean;
  abTrafficPercent: number | null;
  calls: number;
  completed: number;
  converted: number;
  /** converted / calls (0 when no calls). */
  conversionRate: number;
  /** Average sentiment score of calls served by this version (-1..1), or null. */
  avgSentiment: number | null;
};

export type AbComparison = {
  /** Stats per published version (main + variant). */
  versions: AbVersionStats[];
  /** The winning versionId by conversion rate, or null when undecidable. */
  winnerVersionId: string | null;
  /** Minimum sample size before we call a winner (avoid noise). */
  minCalls: number;
  /** True when a winner was declared. */
  hasWinner: boolean;
};

/** Compute per-version stats from raw call rows. Pure — unit-tested. */
export function computeAbStats(input: {
  versions: { id: string; version: number; label: string | null; isAbVariant: boolean; abTrafficPercent: number | null }[];
  calls: {
    agentVersionId: string | null;
    status: string;
    outcome: string | null;
    sentiment: string | null;
  }[];
  minCalls?: number;
}): AbComparison {
  const minCalls = input.minCalls ?? 10;

  const stats = new Map<string, AbVersionStats>();
  for (const v of input.versions) {
    stats.set(v.id, {
      versionId: v.id,
      version: v.version,
      label: v.label,
      isAbVariant: v.isAbVariant,
      abTrafficPercent: v.abTrafficPercent,
      calls: 0,
      completed: 0,
      converted: 0,
      conversionRate: 0,
      avgSentiment: null,
    });
  }

  const sentimentSums = new Map<string, { total: number; count: number }>();

  for (const c of input.calls) {
    if (!c.agentVersionId) continue;
    const s = stats.get(c.agentVersionId);
    if (!s) continue;
    s.calls += 1;
    if (c.status === "COMPLETED") {
      s.completed += 1;
      if (c.outcome && AB_CONVERSION_OUTCOMES.has(c.outcome)) {
        s.converted += 1;
      }
    }
    const score =
      c.sentiment === "positive" ? 0.5 : c.sentiment === "negative" ? -0.5 : 0;
    if (c.sentiment) {
      const cur = sentimentSums.get(c.agentVersionId) ?? { total: 0, count: 0 };
      cur.total += score;
      cur.count += 1;
      sentimentSums.set(c.agentVersionId, cur);
    }
  }

  const versions = [...stats.values()].map((s) => {
    s.conversionRate = s.calls > 0 ? s.converted / s.calls : 0;
    const sent = sentimentSums.get(s.versionId);
    s.avgSentiment = sent && sent.count > 0 ? sent.total / sent.count : null;
    return s;
  });

  // Winner: the version with the higher conversion rate, only when BOTH have
  // enough calls and the rates actually differ.
  const withCalls = versions.filter((v) => v.calls >= minCalls);
  let winnerVersionId: string | null = null;
  if (withCalls.length === 2 && withCalls[0].conversionRate !== withCalls[1].conversionRate) {
    winnerVersionId = withCalls[0].conversionRate > withCalls[1].conversionRate
      ? withCalls[0].versionId
      : withCalls[1].versionId;
  }

  return {
    versions,
    winnerVersionId,
    minCalls,
    hasWinner: winnerVersionId !== null,
  };
}
