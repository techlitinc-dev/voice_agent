import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a Stripe webhook `Stripe-Signature` header without the SDK (pure,
 * unit-testable): header is "t=<unix>,v1=<hmac256 hex of `${t}.${payload}`>".
 * Rejects timestamps older than toleranceSec (replay protection).
 */
export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSec = 300,
  nowMs = Date.now()
): boolean {
  if (!secret || !header) return false;
  const parts = header.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!tPart || v1Parts.length === 0) return false;
  const t = Number(tPart.slice(2));
  if (!Number.isFinite(t)) return false;
  if (Math.abs(nowMs - t * 1000) > toleranceSec * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return v1Parts.some((v1) => {
    const a = Buffer.from(v1);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
