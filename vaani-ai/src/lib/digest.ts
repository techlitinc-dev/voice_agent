/**
 * Scheduled email digests (spec §8). Pure builders are unit-tested; the DB/mail
 * job lives in src/worker/digest.ts.
 */

export type DigestFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

/** Window in ms covered by one digest period. */
export function frequencyWindowMs(freq: DigestFrequency): number {
  switch (freq) {
    case "DAILY": return 24 * 3600 * 1000;
    case "WEEKLY": return 7 * 24 * 3600 * 1000;
    case "MONTHLY": return 30 * 24 * 3600 * 1000;
  }
}

/** A digest is due when never sent, or lastSentAt is older than one full period. */
export function isDigestDue(
  frequency: DigestFrequency,
  lastSentAt: Date | null,
  now: Date,
): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= frequencyWindowMs(frequency);
}

export type DigestStats = {
  periodLabel: string;    // e.g. "last 24 hours"
  calls: number;
  asrPercent: number;
  ahtSeconds: number;
  billedPaise: number;
  wholesalePaise: number;
  topOutcomes: Array<{ outcome: string; count: number }>;
  hallucinations: number;
};

function inr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** Plain-text digest body (pure — fully unit-testable). */
export function buildDigestText(workspaceName: string, frequency: DigestFrequency, s: DigestStats): string {
  const outcomes =
    s.topOutcomes.length === 0
      ? "  (no outcomes recorded)"
      : s.topOutcomes.map((o) => `  - ${o.outcome}: ${o.count}`).join("\n");
  const margin = s.billedPaise - s.wholesalePaise;
  return [
    `Vaani AI ${frequency.toLowerCase()} digest — ${workspaceName}`,
    `Period: ${s.periodLabel}`,
    ``,
    `Calls:              ${s.calls}`,
    `Answer rate (ASR):  ${s.asrPercent}%`,
    `Avg call (AHT):     ${s.ahtSeconds}s`,
    `Billed:             ${inr(s.billedPaise)}`,
    `Wholesale cost:     ${inr(s.wholesalePaise)}`,
    `Gross margin:       ${inr(margin)}`,
    `Hallucination flags: ${s.hallucinations}`,
    ``,
    `Top outcomes:`,
    outcomes,
    ``,
    `— Vaani AI`,
  ].join("\n");
}
