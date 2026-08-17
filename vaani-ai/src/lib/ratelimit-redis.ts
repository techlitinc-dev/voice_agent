import Redis from "ioredis";

/**
 * Sliding-window rate limiter on Redis (hardening doc §4.1).
 *
 * Each key is a sorted set of request timestamps. Old entries are pruned, the
 * new request is added, and the count is compared against the limit. The set
 * expires `windowSec` after the last request so abandoned keys don't leak.
 *
 * Fail-open by design: if Redis is unreachable the request is allowed (the
 * in-memory limiter in ratelimit.ts still guards the public API; auth actions
 * additionally rely on the DB-backed lockout). Never throws.
 */

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) {
    redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      enableOfflineQueue: false,
    });
    redis.on("error", () => {}); // swallow — fail-open below
  }
  return redis;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now()
): Promise<boolean> {
  if (limit <= 0) return true; // 0/negative disables limiting
  const r = getRedis();
  if (!r) return true; // fail-open without Redis
  const bucket = `rl:${key}`;
  try {
    await r.connect();
    const pipe = r.pipeline();
    pipe.zremrangebyscore(bucket, 0, now - windowSec * 1000);
    pipe.zadd(bucket, now, `${now}:${Math.random()}`);
    pipe.zcard(bucket);
    pipe.expire(bucket, windowSec);
    const results = await pipe.exec();
    const count = results?.[2]?.[1] as number | undefined;
    return (count ?? 0) <= limit;
  } catch {
    return true; // fail-open
  } finally {
    try {
      r.disconnect();
    } catch {
      /* noop */
    }
  }
}
