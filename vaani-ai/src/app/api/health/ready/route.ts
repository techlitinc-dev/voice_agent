import { NextResponse } from "next/server";
import Redis from "ioredis";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/ready — readiness (observability doc §5.1).
 * Are all hard dependencies reachable? The load balancer / compose healthcheck
 * routes traffic here. 200 = ready, 503 = not ready (drain).
 */
export async function GET() {
  const dbCheck = await db
    .$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);

  const redisCheck = await (async () => {
    const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 0,
    });
    r.on("error", () => {});
    try {
      await r.connect();
      await r.ping();
      return true;
    } catch {
      return false;
    } finally {
      r.disconnect();
    }
  })();

  const dograhBase = process.env.DOGRAH_BASE_URL;
  const dograhCheck = dograhBase
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
    db: dbCheck,
    redis: redisCheck,
    dograh: dograhCheck,
  };
  const ok = Object.values(checks).every(Boolean);
  return NextResponse.json(
    {
      status: ok ? "ready" : "not_ready",
      checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v ? "up" : "down"])),
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
