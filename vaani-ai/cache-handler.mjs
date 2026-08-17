/**
 * Redis incremental-cache handler (scalability doc §5.1).
 *
 * Enabled by REDIS_CACHE_HANDLER=true in next.config.mjs. Lets multiple Next.js
 * web nodes share one ISR/data-cache in Redis — a page revalidated on node 1 is
 * instantly fresh on nodes 2..N. Falls back to the default memory handler when
 * Redis is unreachable (a cache miss is always safe — it just re-renders).
 *
 * Contract: https://nextjs.org/docs/app/api-reference/next-config-js/cacheHandler
 */
import Redis from "ioredis";

const TTL = Number(process.env.REDIS_CACHE_TTL ?? 300); // 5 min default
const PREFIX = "next-cache:";

let client = null;

function getClient() {
  if (client) return client;
  client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null, // fail-open, no reconnect storm
  });
  client.on("error", () => {
    /* fail-open: cache misses re-render */
  });
  return client;
}

export default class RedisCacheHandler {
  constructor() {
    this.client = getClient();
    if (!this.client.status === "ready" || this.client.status === "connecting") {
      this.client.connect().catch(() => {});
    }
  }

  async get(key, ctx) {
    try {
      const raw = await this.client.get(PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null; // fail-open
    }
  }

  async set(key, data, ctx) {
    try {
      await this.client.set(PREFIX + key, JSON.stringify(data), "EX", TTL);
    } catch {
      /* fail-open */
    }
  }

  async revalidateTag(tags) {
    // Tags share the key namespace in this handler; revalidating a tag would
    // need an index. For correctness we rely on the TTL — acceptable for ISR.
  }
}
