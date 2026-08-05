import { describe, expect, it } from "vitest";
import {
  computeNextRetry,
  computeRetryDelayMs,
  isDisposition,
  parseCampaignExtras,
  parseRetryPolicy,
  resolveRetryRule,
  shouldRetry,
} from "../src/lib/campaign/retry";

const DEFAULTS = { maxAttempts: 2, retryDelayMin: 60 };
const NO_JITTER = () => 0.5; // jitter factor exactly 1.0

describe("parseRetryPolicy", () => {
  it("parses per-disposition overrides and keeps extras separate", () => {
    const p = parseRetryPolicy({
      busy: { attempts: 3, delayMin: 30 },
      "no-answer": { attempts: 2, delayMin: 120 },
      voicemail: { attempts: 1, delayMin: 1440 },
      whatsappFallbackTemplateId: "tpl_1",
    });
    expect(p.busy).toEqual({ attempts: 3, delayMin: 30 });
    expect(p["no-answer"]).toEqual({ attempts: 2, delayMin: 120 });
    expect(p.voicemail).toEqual({ attempts: 1, delayMin: 1440 });
    expect(p.failed).toBeUndefined();
  });
  it("rejects invalid rules and junk input", () => {
    expect(parseRetryPolicy(null)).toEqual({});
    expect(parseRetryPolicy({ busy: { attempts: 0, delayMin: 30 } })).toEqual({});
    expect(parseRetryPolicy({ busy: { attempts: 3, delayMin: 1 } })).toEqual({}); // below 5 min
    expect(parseRetryPolicy({ nope: { attempts: 3, delayMin: 30 } })).toEqual({});
  });
  it("parseCampaignExtras reads the WhatsApp fallback template", () => {
    expect(parseCampaignExtras({ whatsappFallbackTemplateId: "tpl_1" })).toEqual({ whatsappFallbackTemplateId: "tpl_1" });
    expect(parseCampaignExtras({})).toEqual({});
    expect(parseCampaignExtras(null)).toEqual({});
  });
});

describe("isDisposition / resolveRetryRule / shouldRetry", () => {
  const policy = parseRetryPolicy({ busy: { attempts: 3, delayMin: 30 } });
  it("validates dispositions", () => {
    expect(isDisposition("busy")).toBe(true);
    expect(isDisposition("voicemail")).toBe(true);
    expect(isDisposition("completed")).toBe(false);
  });
  it("override wins; fallback uses campaign defaults", () => {
    expect(resolveRetryRule(policy, "busy", DEFAULTS)).toEqual({ attempts: 3, delayMin: 30 });
    expect(resolveRetryRule(policy, "no-answer", DEFAULTS)).toEqual({ attempts: 2, delayMin: 60 });
  });
  it("shouldRetry respects per-disposition attempts", () => {
    expect(shouldRetry(policy, "busy", 2, DEFAULTS)).toBe(true); // 2 < 3
    expect(shouldRetry(policy, "busy", 3, DEFAULTS)).toBe(false);
    expect(shouldRetry(policy, "no-answer", 1, DEFAULTS)).toBe(true); // 1 < 2 (default)
    expect(shouldRetry(policy, "no-answer", 2, DEFAULTS)).toBe(false);
  });
});

describe("computeRetryDelayMs (exponential + jitter)", () => {
  it("doubles per attempt, no jitter when rand=0.5", () => {
    expect(computeRetryDelayMs(30, 1, NO_JITTER)).toBe(30 * 60_000);
    expect(computeRetryDelayMs(30, 2, NO_JITTER)).toBe(60 * 60_000);
    expect(computeRetryDelayMs(30, 3, NO_JITTER)).toBe(120 * 60_000);
  });
  it("caps at 24h", () => {
    expect(computeRetryDelayMs(1440, 5, NO_JITTER)).toBe(1440 * 60_000);
  });
  it("jitter stays within ±20%", () => {
    const lo = computeRetryDelayMs(60, 1, () => 0);
    const hi = computeRetryDelayMs(60, 1, () => 0.999);
    expect(lo).toBe(Math.round(60 * 0.8 * 60_000));
    expect(hi).toBeLessThanOrEqual(Math.round(60 * 1.2 * 60_000));
  });
});

describe("computeNextRetry", () => {
  const now = new Date("2025-07-07T10:00:00Z");
  it("schedules the next attempt with the override delay", () => {
    const policy = parseRetryPolicy({ busy: { attempts: 3, delayMin: 30 } });
    const r = computeNextRetry(policy, "busy", 1, DEFAULTS, now, NO_JITTER);
    expect(r.retry).toBe(true);
    expect(r.nextAttemptAt?.toISOString()).toBe("2025-07-07T10:30:00.000Z");
  });
  it("final attempt → no retry", () => {
    const r = computeNextRetry({}, "no-answer", 2, DEFAULTS, now, NO_JITTER);
    expect(r).toEqual({ retry: false, nextAttemptAt: null });
  });
});
