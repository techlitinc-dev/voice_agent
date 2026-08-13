# 03 — Scalability & Performance

> **Goal:** Ensure Vaani AI handles growth from 1 to 1000+ tenants, from 10 to
> 10,000+ concurrent calls, with sub-second API response times.

---

## 1. Capacity Planning

### 1.1 Current architecture (single-node)

```
[Browser] → [Caddy TLS] → [Next.js (1 container)] → [Postgres] + [Redis] + [MinIO]
```

**Bottleneck**: Single Next.js container handles web + API + worker triggers.

### 1.2 Target architecture (scaled)

```
                         ┌─────────────────────────────┐
                         │       Load Balancer          │
                         │   (Caddy / Nginx / ALB)      │
                         └──────────┬──────────────────┘
                                    │
                   ┌────────────────┼─────────────────┐
                   │                │                  │
            ┌──────▼─────┐  ┌──────▼─────┐    ┌──────▼─────┐
            │  Web Node 1 │  │  Web Node 2 │ ...│  Web Node N │
            │ (Next.js)   │  │ (Next.js)   │    │ (Next.js)   │
            └──────┬─────┘  └──────┬─────┘    └──────┬─────┘
                   │                │                  │
                   └────────────────┼──────────────────┘
                                    │
                   ┌────────────────┼──────────────────┐
                   │                │                  │
            ┌──────▼─────┐  ┌──────▼─────┐    ┌──────▼─────┐
            │ Worker 1   │  │ Worker 2   │    │ Worker N   │
            │ (BullMQ)   │  │ (BullMQ)   │    │ (BullMQ)   │
            └──────┬─────┘  └──────┬─────┘    └──────┬─────┘
                   │                │                  │
                   └────────────────┼──────────────────┘
                                    │
           ┌────────────┬───────────┼───────────┬────────────┐
           │            │           │           │            │
    ┌──────▼──┐  ┌─────▼───┐ ┌─────▼───┐ ┌─────▼───┐ ┌──────▼──┐
    │Postgres │  │  Redis  │ │  MinIO  │ │ Dograh  │ │ External│
    │ (+replica)│ │(cluster)│ │ (cluster)│ │ (scaled)│ │  APIs   │
    └─────────┘  └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

### 1.3 Scaling tiers

| Tier | Tenants | Calls/day | Infra | Monthly cost (est.) |
|---|---|---|---|---|
| **MVP** | 1–10 | 100 | 1 VPS (4 vCPU/8GB) | ₹3,000 |
| **Small** | 10–50 | 1,000 | 2 VPS (web+worker / db) | ₹10,000 |
| **Medium** | 50–200 | 10,000 | 4 nodes + managed PG + Redis | ₹40,000 |
| **Large** | 200–1,000 | 100,000 | Kubernetes cluster + managed everything | ₹1,50,000 |
| **Enterprise** | 1,000+ | 1M+ | Multi-region, dedicated | Custom |

---

## 2. Database Performance

### 2.1 Indexing strategy

The schema already has `@@index` on most models. Verify these **critical** indexes exist:

```prisma
// Add if missing:
model Call {
  // ...
  @@index([workspaceId, createdAt])           // dashboard queries
  @@index([workspaceId, campaignId])          // campaign progress
  @@index([workspaceId, status, createdAt])   // filtered call lists
  @@index([agentId, createdAt])               // agent analytics
}

model Contact {
  // ...
  @@index([workspaceId, dnc])                 // DNC scrub (high-frequency)
  @@index([workspaceId, listId])              // list membership
}

model CampaignContact {
  // ...
  @@index([campaignId, status, nextAttemptAt]) // worker pickup query
}

model WalletTransaction {
  // ...
  @@index([walletId, createdAt])
}
```

### 2.2 Query optimization

**Pattern: avoid N+1 queries.** Always use Prisma `include` / `select`:

```ts
// ❌ N+1 — fetches calls, then separately fetches agent for each
const calls = await prisma.call.findMany({ where: { workspaceId } });
for (const c of calls) {
  const agent = await prisma.agent.findUnique({ where: { id: c.agentId! } });
}

// ✅ Single query with join
const calls = await prisma.call.findMany({
  where: { workspaceId },
  include: { agent: { select: { id: true, name: true } } },
  take: 50,
});
```

**Pattern: paginate, never load all.**

```ts
// Cursor-based pagination (faster for large tables than offset)
const calls = await prisma.call.findMany({
  where: { workspaceId, createdAt: { lt: cursor } },
  orderBy: { createdAt: "desc" },
  take: 50,
});
```

**Pattern: aggregate in DB, not in app.**

```ts
// ❌ Fetch all calls then count in JS
const calls = await prisma.call.findMany({ where: { workspaceId } });
const total = calls.length;

// ✅ Let Postgres count
const { _count } = await prisma.call.aggregate({
  where: { workspaceId },
  _count: { _all: true },
});
```

### 2.3 Connection pooling

Postgres max connections is finite (~100 for small instances). Use **PgBouncer**:

```ini
# /etc/pgbouncer/pgbouncer.ini
[databases]
vaani = host=127.0.0.1 port=5432 dbname=vaani

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
pool_mode = transaction
max_client_conn = 500
default_pool_size = 25
```

Set `DATABASE_URL` to point at PgBouncer (port 6432).

### 2.4 Read replicas

At Medium tier and above, route **read-heavy** queries (analytics, reports) to a
read replica:

```ts
// src/lib/db.ts (extend)
import { PrismaClient } from "@prisma/client";

const writeDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const readDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_REPLICA_URL! } } });

export const prisma = new Proxy(writeDb, {
  get(target, prop) {
    const readMethods = ["findMany", "findUnique", "findFirst", "aggregate", "groupBy", "count"];
    return readMethods.includes(prop as string) ? (readDb as any)[prop] : (target as any)[prop];
  },
}) as PrismaClient;
```

### 2.5 Partitioning (Large tier)

Partition `Call`, `CallEvent`, `TranscriptEntry`, `WalletTransaction` by month
once they exceed ~10M rows:

```sql
CREATE TABLE calls (
  id text,
  workspace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- ...
) PARTITION BY RANGE (created_at);

CREATE TABLE calls_2026_08 PARTITION OF calls
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```

---

## 3. Caching Strategy

### 3.1 Cache layers

| Layer | Store | TTL | Example |
|---|---|---|---|
| Browser | HTTP `Cache-Control` | 1–60 min | Static assets, agent config |
| CDN | Caddy/Cloudflare | 1–60 min | Landing page, public assets |
| App (Redis) | ioredis | 60s–1h | Dashboard stats, plan info, rate card |
| DB query cache | Postgres | — | (handled by shared buffers) |

### 3.2 Redis cache helper

```ts
// src/lib/cache.ts (new)
import { redis } from "./queue";

export async function cache<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as T;
  const fresh = await fn();
  await redis.setex(key, ttlSec, JSON.stringify(fresh));
  return fresh;
}

// Usage
const stats = await cache(`stats:${workspaceId}`, 60, () =>
  prisma.call.aggregate({ where: { workspaceId }, _count: true })
);
```

### 3.3 What to cache

- Dashboard KPIs (60s TTL — invalidated on new call).
- Plan definitions (1h TTL — rarely change).
- Rate card (1h TTL).
- Marketplace templates list (10min TTL).
- Agent published config (60s TTL — short, to pick up version rollbacks fast).
- **Never** cache: wallet balance (must be real-time), user-specific data without workspaceId in key.

---

## 4. Background Job Performance

### 4.1 BullMQ tuning

```ts
// src/lib/queue.ts (extend)
new Queue("dial", {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,   // keep last 1000 completed for debugging
    removeOnFail: 5000,       // keep failed jobs 5000
  },
});
```

Worker concurrency:

```ts
new Worker("dial", processor, {
  concurrency: parseInt(process.env.DIAL_CONCURRENCY || "10"),
  limiter: { max: 50, duration: 1000 }, // max 50 jobs/sec
});
```

### 4.2 Job priorities

| Queue | Priority | Concurrency |
|---|---|---|
| `call-events` (real-time webhook ingestion) | High | 20 |
| `dial` (outbound placement) | High | 10 |
| `postcall` (summary, scoring, transcription) | Medium | 5 |
| `billing` (wallet debit, invoice) | High | 5 |
| `webhook-delivery` | Medium | 10 |
| `kb-reindex` | Low | 2 |
| `digest` | Low | 1 |
| `retention` | Low | 1 |

### 4.3 Idempotency

All workers **must** be idempotent — a job retried 3x must not double-charge or
double-send. Use the `reference` field (call id, payment id) as a unique key:

```ts
// Debit wallet only if not already debited for this call
const existing = await prisma.walletTransaction.findFirst({ where: { reference: callId, type: "CALL_DEBIT" } });
if (!existing) {
  await prisma.walletTransaction.create({ data: { walletId, type: "CALL_DEBIT", amountPaise: -cost, reference: callId, balanceAfterPaise } });
}
```

---

## 5. Frontend Performance

### 5.1 Next.js optimizations

- [ ] Use `dynamic(() => import(...), { ssr: false })` for heavy client components (charts, dial pad).
- [ ] Enable `experimental.optimizePackageImports` for `lucide-react`, `recharts`.
- [ ] Use `next/image` for all images (avatars, logos).
- [ ] Set `cacheHandler` to Redis for ISR in multi-node setups.
- [ ] Preload critical routes (`/dashboard`, `/calls`) in `<Link prefetch>`.

### 5.2 Bundle size

```ts
// vaani-ai/next.config.mjs
export default {
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "@radix-ui/react-dialog"],
  },
  // Analyze bundle
  webpack: (config) => {
    if (process.env.ANALYZE === "true") {
      const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");
      config.plugins.push(new BundleAnalyzerPlugin());
    }
    return config;
  },
};
```

### 5.3 Data fetching patterns

- Server Components fetch data on the server (no client-side waterfall).
- Use `unstable_cache` (Next.js) or React `cache()` for request-level memoization.
- Stream heavy pages with `<Suspense>`:

```tsx
// app/(app)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div>
      <KpiCards /> {/* fast, renders immediately */}
      <Suspense fallback={<ChartsSkeleton />}>
        <Charts /> {/* slow, streams in */}
      </Suspense>
    </div>
  );
}
```

---

## 6. Load Testing

### 6.1 What to load test

| Scenario | Tool | Target |
|---|---|---|
| API throughput (GET /calls) | k6 / Artillery | 500 RPS, p95 < 200ms |
| Concurrent WebSocket (live dashboard) | Artillery | 2,000 connections |
| Worker throughput (dial jobs) | Custom script | 100 dials/sec |
| Postgres TPS | pgbench | 1,000 TPS |
| End-to-end call flow | Playwright + SIP client | 50 concurrent calls |

### 6.2 k6 example

```js
// tests/load/calls-api.k6.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 100 },  // ramp up
    { duration: "2m", target: 100 },    // hold
    { duration: "30s", target: 500 },   // spike
    { duration: "1m", target: 500 },
    { duration: "30s", target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<200"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/v1/calls`, {
    headers: { Authorization: `Bearer ${__ENV.API_KEY}` },
  });
  check(res, { "status 200": (r) => r.status === 200 });
}
```

Run: `k6 run -e BASE_URL=https://app.vaani.ai -e API_KEY=vaani_x tests/load/calls-api.k6.js`

---

## 7. Cost Performance (per-call optimization)

Each AI call incurs 4 costs. Optimize each:

| Component | Current | Optimization | Saving |
|---|---|---|---|
| Telephony (Vobiz) | ₹0.75/min | Negotiate volume tier at 10k min/day | 10–20% |
| STT (Sarvam) | ₹0.50/min | Cache common phrases; use faster model for greeting | 5% |
| LLM (OpenRouter) | ₹0.30/min | Use Llama 3.1 8B for simple agents, 70B for complex | 40% on simple |
| TTS (Sarvam) | ₹0.60/min | Cache greetings & common responses; stream early | 15% |

**Prompt caching**: Cache the system prompt + knowledge context so only the
conversation turns are re-processed:

```ts
// src/lib/openrouter.ts (extend)
const cachedPrompt = await cache(`prompt:${agentId}:${promptHash}`, 3600, async () => {
  return buildFullPrompt(agent, knowledge);
});
```

---

## Next

→ [04 — Disaster Recovery](04-disaster-recovery.md)