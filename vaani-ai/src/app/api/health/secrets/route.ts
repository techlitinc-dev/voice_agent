import { NextResponse } from "next/server";

/**
 * GET /api/health/secrets — verifies all required secrets are present and
 * non-empty at boot (hardening doc §3). Public (middleware allows /api/health).
 * Returns 200 with per-secret present flags, or 500 listing what's missing.
 * Values are NEVER echoed — only a boolean per key.
 */

const REQUIRED_SECRETS = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "JWT_SIGNING_KEY_V1",
  "RAZORPAY_KEY_SECRET",
  "MINIO_ROOT_PASSWORD",
  "REDIS_URL",
  "OPENROUTER_API_KEY",
  "SARVAM_API_KEY",
  "VOBIZ_AUTH_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "SMTP_PASSWORD",
  "DOGRAH_WEBHOOK_SECRET",
] as const;

export const dynamic = "force-dynamic";

export async function GET() {
  const missing: string[] = [];
  const present: Record<string, boolean> = {};

  for (const key of REQUIRED_SECRETS) {
    const value = process.env[key];
    const ok = Boolean(value && value.trim().length > 0 && !/^CHANGE_ME/i.test(value));
    present[key] = ok;
    if (!ok) missing.push(key);
  }

  return NextResponse.json(
    {
      status: missing.length === 0 ? "ok" : "missing",
      missing,
      secrets: present,
      time: new Date().toISOString(),
    },
    { status: missing.length === 0 ? 200 : 500 }
  );
}
