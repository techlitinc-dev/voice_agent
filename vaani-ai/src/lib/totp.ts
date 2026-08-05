import crypto from "node:crypto";
import QRCode from "qrcode";
import { authenticator } from "otplib";

// Accept the previous/next 30s window to tolerate phone clock drift.
authenticator.options = { window: 1 };

export const TOTP_ISSUER = "Vaani AI";

export function generateTotpSecret(): string {
  return authenticator.generateSecret(); // base32
}

export function totpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, TOTP_ISSUER, secret);
}

/** Data URL (image/png;base64) for the enrollment QR code. */
export async function totpQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(totpKeyUri(email, secret));
}

/** True iff the 6-digit code is valid for this secret right now (±1 window). */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}

// ---------- Backup codes (hashed, single-use) ----------

/** Generate `count` human-readable codes like "k7f2-9qx4". Plaintext is shown ONCE. */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = crypto.randomBytes(8);
    let raw = "";
    for (let i = 0; i < bytes.length; i++) raw += alphabet[bytes[i] % alphabet.length];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return Array.from(codes);
}

export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

/**
 * Pure consume-once matcher (unit-tested). Returns the id of the matching UNUSED
 * code, or null. The caller then sets `usedAt` on that row.
 */
export function findMatchingBackupCode(
  code: string,
  stored: { id: string; codeHash: string; usedAt: Date | null }[]
): string | null {
  const hash = hashBackupCode(code);
  const match = stored.find((row) => row.usedAt === null && row.codeHash === hash);
  return match ? match.id : null;
}
