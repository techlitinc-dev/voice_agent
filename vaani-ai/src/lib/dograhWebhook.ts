/**
 * Signature verification for POST /api/webhooks/dograh.
 * Accepts EITHER:
 *   1. the static shared secret Dograh's webhook node sends as `x-webhook-secret`, OR
 *   2. an HMAC-SHA256 hex signature of the raw body in `x-dograh-signature`
 *      (or `x-webhook-signature`), computed with DOGRAH_WEBHOOK_SECRET.
 * Dev fallback: if DOGRAH_WEBHOOK_SECRET is unset, everything is allowed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyDograhWebhook(
  headers: Pick<Headers, "get">,
  rawBody: string,
  secret: string | undefined = process.env.DOGRAH_WEBHOOK_SECRET
): boolean {
  if (!secret) return true; // dev fallback

  const staticHeader = headers.get("x-webhook-secret");
  if (staticHeader && staticHeader === secret) return true;

  const sig = headers.get("x-dograh-signature") ?? headers.get("x-webhook-signature");
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
