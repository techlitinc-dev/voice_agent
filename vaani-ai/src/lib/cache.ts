import IORedis from "ioredis";

/** Shared Redis client for caching (production-readiness §3.2). A Redis outage
 *  must never crash a request: on error, fall back to computing fresh values. */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let client: IORedis | null = null;
let connecting: Promise<void> | null = null;

function redis(): IORedis | null {
  if (client) return client;
  try {
    client = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null, // no reconnect storm; each request retries on its own
    });
    client.on("error", (err) => {
      console.error(`[cache] redis error: ${err.message}`);
    });
    // lazyConnect defers the socket; connect on first use so commands work.
    connecting = client.connect().catch((err) => {
      console.error(`[cache] redis connect failed: ${err.message}`);
      client = null;
      connecting = null;
    });
  } catch (e) {
    console.error("[cache] redis init failed", e);
    return null;
  }
  return client;
}

/** Redis-backed memoization. On any Redis failure, compute fresh and return. */
export async function cache<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const r = redis();
  if (!r) return fn();
  try {
    if (connecting) await connecting;
    const cached = await r.get(key);
    if (cached) return JSON.parse(cached) as T;
  } catch (e) {
    console.error(`[cache] get failed for ${key}`, e);
    return fn();
  }
  const fresh = await fn();
  try {
    await r.setex(key, ttlSec, JSON.stringify(fresh));
  } catch (e) {
    console.error(`[cache] set failed for ${key}`, e);
  }
  return fresh;
}

/** Drop a cached key (call on deal mutations to invalidate CRM analytics). */
export async function invalidateCache(key: string): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    if (connecting) await connecting;
    await r.del(key);
  } catch (e) {
    console.error(`[cache] invalidate failed for ${key}`, e);
  }
}

/** Namespaced key helper for CRM analytics. */
export function crmStatsKey(workspaceId: string, rangeKey: string): string {
  return `crm:stats:${workspaceId}:${rangeKey}`;
}
