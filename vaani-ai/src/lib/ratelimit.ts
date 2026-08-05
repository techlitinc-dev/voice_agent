/**
 * In-memory fixed-window rate limiter for the public API.
 * One process => one bucket map; resets on restart (documented ops behavior).
 * PUBLIC_API_RATE_LIMIT = requests per minute per API key (default 120).
 */

const buckets = new Map<string, { count: number; windowStart: number }>();

export function rateLimitAllow(
  key: string,
  limitPerMin: number = Number(process.env.PUBLIC_API_RATE_LIMIT ?? 120),
  now: number = Date.now(),
): boolean {
  if (limitPerMin <= 0) return true; // 0/negative disables limiting (documented)
  const windowMs = 60_000;
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= limitPerMin) return false;
  b.count += 1;
  return true;
}

/** Test hook: wipe all buckets. */
export function rateLimitReset(): void {
  buckets.clear();
}
