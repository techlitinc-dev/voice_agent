import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { s3 } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/deep — deep health (observability doc §5.1).
 * Runs the expensive checks: all secrets present, migrations applied, MinIO
 * reachable, Dograh reachable, provider keys configured. Meant for startup
 * verification and periodic cron, NOT the LB healthcheck (it's slow).
 * Values are never echoed — booleans only.
 */

const REQUIRED_SECRETS = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "JWT_SIGNING_KEY_V1",
  "RAZORPAY_KEY_SECRET",
  "REDIS_URL",
  "OPENROUTER_API_KEY",
  "SARVAM_API_KEY",
  "VOBIZ_AUTH_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "SMTP_PASSWORD",
  "DOGRAH_WEBHOOK_SECRET",
] as const;

const OPTIONAL_PROVIDERS = [
  ["STRIPE_SECRET_KEY", "stripe"],
  ["HUBSPOT_CLIENT_SECRET", "hubspot"],
  ["ELEVENLABS_API_KEY", "elevenlabs"],
] as const;

export async function GET() {
  // 1) Secrets present (hardening §3) + optional providers.
  const secrets: Record<string, boolean> = {};
  for (const key of REQUIRED_SECRETS) {
    const v = process.env[key];
    secrets[key] = Boolean(v && v.trim().length > 0 && !/^CHANGE_ME/i.test(v));
  }
  const providers: Record<string, boolean> = {};
  for (const [key, name] of OPTIONAL_PROVIDERS) {
    const v = process.env[key];
    providers[name] = Boolean(v && v.trim().length > 0 && !/^CHANGE_ME/i.test(v));
  }

  // 2) Migrations applied (Prisma _prisma_migrations) — no pending rows.
  const migrationsOk = await (async () => {
    try {
      const res = await db.$queryRaw<{ finished_at: Date | null }[]>`
        SELECT "finished_at" FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL`;
      return res.length > 0 && res.every((r) => r.finished_at !== null);
    } catch {
      return false;
    }
  })();

  // 3) MinIO reachable (list buckets proves creds + network).
  const minioOk = await (async () => {
    try {
      await s3.listBuckets();
      return true;
    } catch {
      return false;
    }
  })();

  // 4) Dograh reachable.
  const dograhBase = process.env.DOGRAH_BASE_URL;
  const dograhOk = dograhBase
    ? await (async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2000);
        try {
          await fetch(dograhBase, { signal: ctrl.signal });
          return true;
        } catch {
          return false;
        } finally {
          clearTimeout(t);
        }
      })()
    : false;

  const checks = {
    secrets: Object.values(secrets).every(Boolean),
    migrations: migrationsOk,
    minio: minioOk,
    dograh: dograhOk,
  };
  const ok = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks,
      secrets: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v ? "present" : "missing"])),
      providers,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
