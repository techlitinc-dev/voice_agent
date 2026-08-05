import { describe, expect, it } from "vitest";
import {
  nextBackoffMs,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_MAX_ATTEMPTS,
} from "../src/lib/webhook-sign";

describe("signWebhookPayload / verifyWebhookSignature", () => {
  const secret = "whsec_test_0123456789";
  const body = '{"event":"call.completed","callId":"c1"}';

  it("produces a sha256= prefixed hex signature", () => {
    const sig = signWebhookPayload(secret, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("verifies a correct signature", () => {
    expect(verifyWebhookSignature(secret, body, signWebhookPayload(secret, body))).toBe(true);
  });

  it("rejects a tampered body, wrong secret, and malformed signature", () => {
    const sig = signWebhookPayload(secret, body);
    expect(verifyWebhookSignature(secret, body + " ", sig)).toBe(false);
    expect(verifyWebhookSignature("whsec_other", body, sig)).toBe(false);
    expect(verifyWebhookSignature(secret, body, "sha256=deadbeef")).toBe(false);
  });
});

describe("nextBackoffMs", () => {
  it("doubles from 30s and caps at 1 hour", () => {
    expect(nextBackoffMs(1)).toBe(30_000);
    expect(nextBackoffMs(2)).toBe(60_000);
    expect(nextBackoffMs(3)).toBe(120_000);
    expect(nextBackoffMs(4)).toBe(240_000);
    expect(nextBackoffMs(8)).toBe(3_600_000); // 30s*2^7 = 64m -> capped at 1h
    expect(nextBackoffMs(20)).toBe(3_600_000);
  });
});

describe("WEBHOOK_MAX_ATTEMPTS", () => {
  it("is 8", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
  });
});
