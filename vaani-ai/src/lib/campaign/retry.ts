import { alignRetryToWindow } from "./optimal";

/**
 * Retry policy (readme §6.1 "configurable attempts per disposition, smart spacing").
 * Campaign.retryPolicy JSON overrides per disposition; scalar maxAttempts/retryDelayMin
 * are the fallback. Spacing = exponential backoff (×2 per attempt, capped 24h) + ±20%
 * jitter so retries don't thunder-herd.
 */

export const DISPOSITIONS = ["busy", "no-answer", "failed", "voicemail"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type RetryRule = { attempts: number; delayMin: number };
export type RetryPolicy = Partial<Record<Disposition, RetryRule>>;

export type CampaignExtras = {
  /** readme §9 call-to-WhatsApp fallback: send this template after final no-answer. */
  whatsappFallbackTemplateId?: string;
};

const MAX_DELAY_MIN = 24 * 60;

export function isDisposition(s: string): s is Disposition {
  return (DISPOSITIONS as readonly string[]).includes(s);
}

/** Tolerant parser for Campaign.retryPolicy JSON (ignores unknown keys, keeps extras). */
export function parseRetryPolicy(json: unknown): RetryPolicy {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  const out: RetryPolicy = {};
  for (const d of DISPOSITIONS) {
    const v = o[d];
    if (v && typeof v === "object") {
      const r = v as Record<string, unknown>;
      const attempts = Number(r.attempts);
      const delayMin = Number(r.delayMin);
      if (Number.isInteger(attempts) && attempts >= 1 && attempts <= 10 &&
          Number.isFinite(delayMin) && delayMin >= 5 && delayMin <= MAX_DELAY_MIN) {
        out[d] = { attempts, delayMin };
      }
    }
  }
  return out;
}

/** Non-disposition extras stored in the same JSON column. */
export function parseCampaignExtras(json: unknown): CampaignExtras {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  const out: CampaignExtras = {};
  if (typeof o.whatsappFallbackTemplateId === "string" && o.whatsappFallbackTemplateId.length > 0) {
    out.whatsappFallbackTemplateId = o.whatsappFallbackTemplateId;
  }
  return out;
}

/** Effective rule for a disposition: policy override → campaign defaults. */
export function resolveRetryRule(
  policy: RetryPolicy,
  disposition: Disposition,
  defaults: { maxAttempts: number; retryDelayMin: number }
): RetryRule {
  return policy[disposition] ?? { attempts: defaults.maxAttempts, delayMin: defaults.retryDelayMin };
}

/** Should this contact be retried after `attemptsSoFar` attempts at `disposition`? */
export function shouldRetry(
  policy: RetryPolicy,
  disposition: Disposition,
  attemptsSoFar: number,
  defaults: { maxAttempts: number; retryDelayMin: number }
): boolean {
  return attemptsSoFar < resolveRetryRule(policy, disposition, defaults).attempts;
}

/**
 * Smart spacing: base × 2^(attemptsSoFar-1), capped at 24h, ±20% jitter.
 * `rand` is injected (Math.random in prod, fixed in tests) → deterministic tests.
 */
export function computeRetryDelayMs(baseDelayMin: number, attemptsSoFar: number, rand: () => number): number {
  const exp = Math.min(baseDelayMin * 2 ** Math.max(0, attemptsSoFar - 1), MAX_DELAY_MIN);
  const jitter = 0.8 + rand() * 0.4; // 0.8 … 1.2
  return Math.round(exp * jitter * 60_000);
}

/** Full decision: retry (and when) or final failure. */
export function computeNextRetry(
  policy: RetryPolicy,
  disposition: Disposition,
  attemptsSoFar: number,
  defaults: { maxAttempts: number; retryDelayMin: number },
  now: Date,
  rand: () => number
): { retry: boolean; nextAttemptAt: Date | null } {
  if (!shouldRetry(policy, disposition, attemptsSoFar, defaults)) {
    return { retry: false, nextAttemptAt: null };
  }
  const rule = resolveRetryRule(policy, disposition, defaults);
  return {
    retry: true,
    nextAttemptAt: new Date(now.getTime() + computeRetryDelayMs(rule.delayMin, attemptsSoFar, rand)),
  };
}

/**
 * Smart Retries v2 (docs/new-features/05 §3.5): computeNextRetry + alignment of
 * the naive nextAttemptAt into the next open calling window (contact optimal
 * windows learned from answer patterns, else the campaign default window).
 * Pure — `now`/`rand` injected. Falls back to the unaligned candidate when the
 * contact has no window data (identical to computeNextRetry then).
 */
export function computeNextRetryAligned(input: {
  policy: RetryPolicy;
  disposition: Disposition;
  attemptsSoFar: number;
  defaults: { maxAttempts: number; retryDelayMin: number };
  now: Date;
  rand: () => number;
  contactTimezone?: string | null;
  contactOptimalWindows?: Record<string, string[]> | null;
  windowStart: string; // campaign callingWindowStart fallback
  windowEnd: string; // campaign callingWindowEnd fallback
}): { retry: boolean; nextAttemptAt: Date | null } {
  const base = computeNextRetry(input.policy, input.disposition, input.attemptsSoFar, input.defaults, input.now, input.rand);
  if (!base.retry || !base.nextAttemptAt) return base;
  const aligned = alignRetryToWindow({
    now: input.now,
    candidate: base.nextAttemptAt,
    contactTimezone: input.contactTimezone,
    contactOptimalWindows: input.contactOptimalWindows,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });
  return { retry: true, nextAttemptAt: aligned };
}
