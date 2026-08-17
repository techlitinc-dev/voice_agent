import { createHash } from "node:crypto";

/**
 * Device binding (hardening doc §1.5): sha256 of "userAgent|ipPrefix". The
 * session token is bound to this fingerprint; a request presenting the token
 * from a materially different device/IP prefix is rejected.
 *
 * The raw fingerprint is never stored — only this hash. IP prefix = first 3
 * octets (a /24), so roaming within the same subnet doesn't log you out.
 */

export function deviceFingerprint(userAgent: string | null, ip: string | null): string | null {
  const ua = (userAgent ?? "").trim();
  const ipPrefix = ip ? ip.split(".").slice(0, 3).join(".") : "";
  if (!ua && !ipPrefix) return null;
  return createHash("sha256").update(`${ua}|${ipPrefix}`).digest("hex");
}
