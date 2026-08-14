/**
 * Signature verification for POST /api/webhooks/whatsapp and /api/webhooks/sms.
 *
 * Vobiz sends an HMAC-SHA256 hex signature of the raw body in
 * `x-vobiz-signature` (or `x-webhook-signature`), computed with
 * VOBIZ_WEBHOOK_SECRET. Dev fallback: when the secret is unset, everything is
 * allowed (same convention as verifyDograhWebhook).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyVobizWebhook(
  headers: Pick<Headers, "get">,
  rawBody: string,
  secret: string | undefined = process.env.VOBIZ_WEBHOOK_SECRET
): boolean {
  if (!secret) return true; // dev fallback

  const staticHeader = headers.get("x-vobiz-secret");
  if (staticHeader && staticHeader === secret) return true;

  const sig = headers.get("x-vobiz-signature") ?? headers.get("x-webhook-signature");
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
