import { NextResponse } from "next/server";
import Redis from "ioredis";
import { db } from "@/lib/db";
import { s3 } from "@/lib/storage";

export const dynamic = "force-dynamic";

async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

/**
 * GET /api/health — liveness + dependency reachability (readme §12 observability).
 * Public (middleware allows it): output contains NO secrets or tenant data.
 *   200 "ok"       — db + redis (+ minio + dograh) reachable
 *   200 "degraded" — db + redis ok, minio or dograh unreachable
 *   503 "down"     — db or redis unreachable
 * Compose healthchecks and the /status page consume this; the alert watcher
 * (scripts/health-watch.sh) pages on "down"/degraded.
 */
export async function GET() {
  const dbCheck = await timed(() => db.$queryRaw`SELECT 1`);

  const redisCheck = await timed(async () => {
    const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 0,
    });
    // Without a handler ioredis emits an unhandled 'error' that crashes the
    // process when redis is down (phase 4 perf-degradation expects a 503, not
    // a crash). The connection failure surfaces via the connect()/ping()
    // rejection; this handler just prevents the process-level crash.
    r.on("error", () => {});
    try {
      await r.connect();
      await r.ping();
    } finally {
      r.disconnect();
    }
  });

  const minioCheck = await timed(() => s3.listBuckets());

  const dograhBase = process.env.DOGRAH_BASE_URL;
  const dograhCheck = dograhBase
    ? await timed(async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2000);
        try {
          // Any HTTP response (even 404) proves reachability.
          await fetch(dograhBase, { signal: ctrl.signal });
        } finally {
          clearTimeout(t);
        }
      })
    : { ok: false, ms: 0 };

  const core = dbCheck.ok && redisCheck.ok;
  const status = !core ? "down" : minioCheck.ok && dograhCheck.ok ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      checks: {
        db: dbCheck.ok,
        redis: redisCheck.ok,
        minio: minioCheck.ok,
        dograh: dograhCheck.ok,
      },
      latencyMs: {
        db: dbCheck.ms,
        redis: redisCheck.ms,
        minio: minioCheck.ms,
        dograh: dograhCheck.ms,
      },
      uptimeSec: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? "unknown",
      time: new Date().toISOString(),
    },
    { status: core ? 200 : 503 },
  );
}
