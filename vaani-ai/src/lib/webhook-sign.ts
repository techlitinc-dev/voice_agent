import crypto from "node:crypto";

/** Max delivery attempts per WebhookDelivery row (spec: retries with backoff). */
export const WEBHOOK_MAX_ATTEMPTS = 8;

/** X-Vaani-Signature value: "sha256=" + HMAC-SHA256 hex of the RAW body. */
export function signWebhookPayload(secret: string, rawBody: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Constant-time verification used by receivers (and our tests). */
export function verifyWebhookSignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = signWebhookPayload(secret, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Exponential backoff in ms after `attemptsMade` failed attempts (1-based):
 * 30s, 1m, 2m, 4m, 8m, 16m, 32m, capped at 1h. Deterministic (no jitter) so tests pin it.
 */
export function nextBackoffMs(attemptsMade: number): number {
  const base = 30_000 * Math.pow(2, Math.max(1, attemptsMade) - 1);
  return Math.min(base, 3_600_000);
}
