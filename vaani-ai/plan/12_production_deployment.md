# 12 — Production Deployment, Observability, Status Page, Scaling & Security Ops

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/12_production_deployment.md` exactly. This phase touches the
> LIVE system: follow steps in order, never skip a Verify, never run destructive
> commands (rm -rf, DROP, prune) — if a step seems to require one, STOP and report.
> Create files EXACTLY as shown. Secrets go only in `.env`. End with the FINAL REPORT.
> ---

---

## Goal

Vaani AI in production on the VPS:

1. **Dockerized prod stack** — app + worker (+ optional scaled dialer workers) +
   KB re-index worker + Postgres + Redis + MinIO behind Caddy with automatic HTTPS,
   including **on-demand TLS for white-label workspace custom domains** (guide 10).
2. **Health + observability** (readme §12) — `/api/health` (DB/Redis/MinIO/Dograh),
   compose healthchecks, Slack alerting on failure, per-call tracing conventions,
   latency histograms, error budgets.
3. **Public status page + uptime SLA** (readme §11) — unauthenticated `/status`
   with live checks, external 30-day uptime (operator-gated), incident log
   convention.
4. **Ops discipline** — daily Postgres + MinIO backups with a restore drill, log
   rotation, uptime monitor, secrets/encryption audit.
5. **Scaling knobs** (readme §12) — horizontal worker scaling without cron overlap,
   DB connection limits, provider capacity notes.
6. Ends with an expanded **go-live checklist** (operator decisions) and
   `CAMPAIGN_DRY_RUN=false` readiness.

**Time estimate:** 4–5 hours. **Prerequisites:** guides 01–11 green. Operator: domain
DNS A-record pointing at the VPS IP (verify: `dig +short <domain>` returns the VPS IP).

**Cron/service inventory (the worker process must run ALL of these in prod — guides
07/08/09 registered them in `src/worker/index.ts` `main()`; Step 5 verifies):**

| Owner | Job | Schedule |
|---|---|---|
| guide 07 | callback sweep + post-call sweep | every minute |
| guide 07 | nightly per-number daily-cap reset | `0 3 * * *` |
| guide 07 | BullMQ campaign scheduler + dialer + whatsapp workers | continuous |
| guide 08 | recording-ingestion sweeper (pulls recordings into MinIO) | 60 s interval |
| guide 08 | post-call intelligence sweep | 45 s interval |
| guide 08 | webhook-delivery retries | 15 s interval |
| guide 08 | GDPR request processor | 60 s interval |
| guide 08 | scheduled email digests | hourly at :05 |
| guide 08 | retention enforcement | nightly 03:30 |
| guide 09 | number rentals + add-ons + plan fees | `15 3 1 * *` (monthly) |
| guide 09 | monthly GST invoices | `30 4 1 * *` (monthly) |
| guide 09 | wallet auto-top-up sweep | `*/15 * * * *` |
| guide 05 | KB re-index (separate `worker:kb` process, node-cron) | per schedule |
| guide 04 | `scripts/check-trunk.sh` SIP trunk health | system cron |

**THE cron-overlap rule:** every cron/interval above must run on EXACTLY ONE worker
container. Step 1 guards all registrations behind `RUN_CRON`; the primary worker
runs with `RUN_CRON=true`, scaled dialer workers (Step 13) with `RUN_CRON=false`.

---

## Step 1: App additions BEFORE the image build — health endpoint, status page, cron guard

The Docker image built in Step 3 must already contain these. Do this step FIRST.

### 1a. Health endpoint

**File `src/app/api/health/route.ts`** (full content):

```ts
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
```

### 1b. Public status page + incident log convention

**File `src/content/incidents.md`** (full content — the incident log convention:
newest entry FIRST; edit + redeploy to publish, or rely on the external status
page linked below it):

```markdown
# Incident log

No incidents recorded yet. Format for new entries (newest first):

## YYYY-MM-DD — <short title>
- **Impact:** <what users saw>
- **Duration:** <start → end, IST>
- **Cause:** <root cause>
- **Resolution:** <what fixed it>
- **Follow-up:** <preventive action>
```

**File `src/app/status/page.tsx`** (full content — PUBLIC, no auth):

```tsx
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status — Vaani AI" };

type Health = {
  status: "ok" | "degraded" | "down";
  checks: Record<string, boolean>;
  latencyMs: Record<string, number>;
  uptimeSec: number;
  version: string;
  time: string;
};

async function getHealth(): Promise<Health | null> {
  try {
    // Server-side self-call: loopback inside the same container/host.
    const res = await fetch("http://127.0.0.1:3000/api/health", { cache: "no-store" });
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

async function getIncidents(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "src/content/incidents.md"), "utf8");
  } catch {
    return "No incident log found.";
  }
}

const CHECK_LABELS: Record<string, string> = {
  db: "PostgreSQL",
  redis: "Redis (queues)",
  minio: "Object storage (recordings)",
  dograh: "Voice engine (Dograh)",
};

export default async function StatusPage() {
  const [health, incidents] = await Promise.all([getHealth(), getIncidents()]);
  const externalStatus = process.env.STATUS_UPTIME_URL ?? "";

  const banner =
    health === null || health.status === "down"
      ? { text: "Major outage — we are investigating", cls: "border-red-500/40 bg-red-500/10 text-red-400" }
      : health.status === "degraded"
        ? { text: "Partial degradation — some components are unreachable", cls: "border-amber-500/40 bg-amber-500/10 text-amber-400" }
        : { text: "All systems operational", cls: "border-green-500/40 bg-green-500/10 text-green-400" };

  return (
    <main className="mx-auto max-w-2xl px-4 py-16" data-testid="status-page">
      <h1 className="text-3xl font-bold">Vaani AI status</h1>

      <p className={`mt-6 rounded-md border p-4 text-sm font-medium ${banner.cls}`} data-testid="status-banner">
        {banner.text}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Live component checks</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {Object.entries(CHECK_LABELS).map(([key, label]) => {
            const ok = health?.checks?.[key] ?? false;
            const ms = health?.latencyMs?.[key];
            return (
              <li key={key} className="flex items-center justify-between rounded-md border border-border p-3" data-testid={`status-check-${key}`}>
                <span>{label}</span>
                <span className={ok ? "text-green-400" : "text-red-400"}>
                  {ok ? "operational" : "unreachable"}
                  {typeof ms === "number" && <span className="ml-2 text-muted-foreground">{ms} ms</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Checked live at {health?.time ?? "unknown"} · version {health?.version ?? "unknown"}
        </p>
      </section>

      <section className="mt-8" data-testid="status-uptime">
        <h2 className="text-lg font-semibold">30-day uptime</h2>
        {externalStatus ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Independently monitored 30-day uptime and incident history:{" "}
            <a href={externalStatus} className="text-primary hover:underline" data-testid="status-uptime-link">
              {externalStatus}
            </a>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            External uptime monitoring is being configured. (Operator: see guide 12 Step 11 —
            Better Uptime/UptimeRobot public page, then set STATUS_UPTIME_URL.)
          </p>
        )}
      </section>

      <section className="mt-8" data-testid="status-incidents">
        <h2 className="text-lg font-semibold">Incident log</h2>
        <pre className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
          {incidents}
        </pre>
      </section>
    </main>
  );
}
```

### 1c. Middleware patch — make `/status` and `/api/health` public

Edit `src/middleware.ts`.

**Edit 1 of 2.** Find this exact line:

```ts
const PUBLIC_PATHS = ["/", "/login", "/register"];
```

Replace with:

```ts
const PUBLIC_PATHS = ["/", "/login", "/register", "/status"];
```

**Edit 2 of 2.** Find this exact line (guide 10 added it after the `"/api/v1/"` line):

```ts
  "/api/domain-ask",  // Caddy on-demand TLS ask endpoint — public by design (guide 10/12)
```

Directly AFTER it insert:

```ts
  "/api/health",      // health endpoint for compose checks, status page, alert watcher
```

(If the domain-ask line is absent because guide 10 is not done, insert after the
`"/api/v1/"` line instead — same effect. STOP and report if neither anchor exists.)

### 1d. Cron-overlap guard in the worker (`RUN_CRON`)

All node-cron schedules and maintenance intervals registered in
`src/worker/index.ts` `main()` must run on ONE container only.

**Edit 1 of 4.** Inside `main()`, directly AFTER the line that starts with
`const connection = createRedisConnection()`, insert these two lines:

```ts
  // Cron/interval registrations run ONLY on the primary worker (guide 12 scaling).
  const RUN_CRON = process.env.RUN_CRON !== "false";
```

**Edit 2 of 4.** Find this EXACT block (from guide 07 — indentation matters):

```ts
  cron.schedule("* * * * *", () => {
    sweepDueCallbacks().catch((e) => console.error("[cron] sweepDueCallbacks", e));
    sweepPostCalls().catch((e) => console.error("[cron] sweepPostCalls", e));
  });
  cron.schedule("0 3 * * *", () => {
    resetDailyCaps().catch((e) => console.error("[cron] resetDailyCaps", e));
  });
```

Replace it with:

```ts
  if (RUN_CRON) {
    cron.schedule("* * * * *", () => {
      sweepDueCallbacks().catch((e) => console.error("[cron] sweepDueCallbacks", e));
      sweepPostCalls().catch((e) => console.error("[cron] sweepPostCalls", e));
    });
    cron.schedule("0 3 * * *", () => {
      resetDailyCaps().catch((e) => console.error("[cron] resetDailyCaps", e));
    });
  }
```

**Edit 3 of 4.** Find the guide-08 registration line (exactly `  startCronJobs();`)
and replace it with:

```ts
  if (RUN_CRON) startCronJobs();
```

**Edit 4 of 4.** For EVERY remaining bare `cron.schedule(` or `setInterval(` call
inside `main()` that is not already guarded (guides 08/09 additions: webhook-delivery,
gdpr, auto-top-up sweep, etc.), wrap it the same way: `if (RUN_CRON) { ... }`.
List what you wrapped in the report. If a call is registered OUTSIDE `main()`,
STOP and report the file/line — do not improvise.

**Verify:**
```bash
cd /root/vaani-ai
npm run typecheck && npm run build
grep -n "RUN_CRON" src/worker/index.ts
grep -c "cron.schedule(\|setInterval(" src/worker/index.ts
grep -n "api/health\|/status" src/middleware.ts
```
**Expected:** typecheck + build exit 0; RUN_CRON grep shows ≥4 lines (declaration +
guards); every `cron.schedule(`/`setInterval(` line sits inside an `if (RUN_CRON)`
block (eyeball the grep output against the file); middleware grep shows both new lines.

---

## Step 2: Alerting — alert.sh + health watcher + mock receiver test

**File `scripts/alert.sh`** (full content):

```bash
#!/usr/bin/env bash
# Post an alert to ALERT_SLACK_WEBHOOK_URL (Slack-compatible incoming webhook;
# Discord webhooks with /slack suffix also accept this payload shape).
set -euo pipefail
MSG="${1:-Vaani AI alert (no message)}"
WEBHOOK="${ALERT_SLACK_WEBHOOK_URL:-}"
if [ -z "$WEBHOOK" ]; then
  echo "ALERT_SLACK_WEBHOOK_URL not set — alert NOT sent: $MSG" >&2
  exit 1
fi
PAYLOAD=$(printf '{"text":"[vaani-ai %s] %s"}' "$(hostname)" "${MSG//\"/'}")
curl -sS -m 10 -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK"
echo
echo "alert sent"
```

**File `scripts/health-watch.sh`** (full content):

```bash
#!/usr/bin/env bash
# Cron every 2 min: page when the public health endpoint is not "ok".
set -uo pipefail
DOMAIN=$(grep '^DOMAIN=' /root/vaani-ai/.env | cut -d= -f2-)
URL="https://${DOMAIN}/api/health"
OUT=$(curl -s -m 10 "$URL" 2>/dev/null || echo '{"status":"down","checks":{}}')
if echo "$OUT" | grep -q '"status":"ok"'; then
  exit 0
fi
/root/vaani-ai/scripts/alert.sh "health check FAILED ($URL): $OUT" || true
```

**File `scripts/mock-webhook-server.js`** (full content — test-only webhook sink):

```js
// Test-only HTTP sink for alert.sh verification. NOT used in production.
require("http")
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      console.log(`${req.method} ${req.url} ${body}`);
      res.end("ok");
    });
  })
  .listen(9876, () => console.log("mock webhook receiver on :9876"));
```

**Do:**
```bash
cd /root/vaani-ai
chmod +x scripts/alert.sh scripts/health-watch.sh
grep -q '^ALERT_SLACK_WEBHOOK_URL=' .env || echo "ALERT_SLACK_WEBHOOK_URL=" >> .env
grep -q '^STATUS_UPTIME_URL=' .env || echo "STATUS_UPTIME_URL=" >> .env
# keep .env.example in sync (placeholders only, never real values)
grep -q '^ALERT_SLACK_WEBHOOK_URL=' .env.example || cat >> .env.example <<'EOF'
# Slack-compatible incoming webhook for ops alerts (scripts/alert.sh, guide 12)
ALERT_SLACK_WEBHOOK_URL=
# Public status-page URL from the external uptime monitor (Better Uptime/UptimeRobot)
STATUS_UPTIME_URL=
EOF
grep -c "STATUS_UPTIME_URL" .env.example
```
**Expected:** the last command prints `1` (both vars now documented in `.env.example`).

```bash
# T1: alert.sh against the mock receiver
(node scripts/mock-webhook-server.js > /tmp/mock-webhook.log 2>&1 &)
sleep 1
ALERT_SLACK_WEBHOOK_URL=http://127.0.0.1:9876/alert ./scripts/alert.sh "test alert from guide 12"
sleep 1
grep -c "test alert from guide 12" /tmp/mock-webhook.log

# T2: missing webhook URL must fail loudly (negative test)
unset ALERT_SLACK_WEBHOOK_URL; ./scripts/alert.sh "should not send" ; echo "exit=$?"

pkill -f mock-webhook-server.js || true
```
**Expected (T1):** `alert sent` printed, grep prints `1`, and the mock log line is
`POST /alert {"text":"[vaani-ai <host>] test alert from guide 12"}`.
**Expected (T2):** `ALERT_SLACK_WEBHOOK_URL not set — alert NOT sent: ...` on stderr
and `exit=1`.
**If it fails:** curl error → the mock is not listening (check `/tmp/mock-webhook.log`
for the startup line). Any JSON error → compare `PAYLOAD` quoting with the listing.

---

## Step 3: Dockerfile for the app

**File `Dockerfile`** (full content):

```dockerfile
# ---- deps ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build needs a DATABASE_URL-shaped var present; it is not used at build time.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate && npm run build

# ---- runner ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/tsconfig.json ./tsconfig.json
EXPOSE 3000
# default command runs the web app; the worker overrides it in compose
CMD ["npm", "run", "start"]
```

**File `.dockerignore`** (full content):

```
node_modules
.next
.git
plan
.env
*.log
/tmp
```

**Verify (build the image — takes a few minutes):**
```bash
cd /root/vaani-ai
docker build -t vaani-app:latest .
```
**Expected:** ends with `naming to docker.io/library/vaani-app:latest` (or
`DONE`/`writing image`). No red error layers.
**If it fails:** read the failing layer's log. Common: `npm ci` peer conflicts → the
`--legacy-peer-deps` flag handles it (already in the file); a missing file in COPY →
confirm the file exists in the repo (`src/content/incidents.md` from Step 1 is
inside `src/`, so it ships automatically).

---

## Step 4: Production compose + Caddy (with on-demand TLS for workspace domains)

**File `docker-compose.prod.yml`** (full content):

```yaml
services:
  app:
    image: vaani-app:latest
    container_name: vaani-app
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      RUN_CRON: "false"   # the app process never runs worker crons
      DATABASE_URL: postgresql://vaani:${DB_PASSWORD}@db:5432/vaani?connection_limit=10
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      APP_URL: https://${DOMAIN}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:3000/api/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks: [internal, web]

  worker:
    image: vaani-app:latest
    container_name: vaani-worker
    restart: unless-stopped
    command: ["npx", "tsx", "src/worker/index.ts"]
    env_file: .env
    environment:
      NODE_ENV: production
      RUN_CRON: "true"    # THE only container allowed to run node-cron/intervals
      DATABASE_URL: postgresql://vaani:${DB_PASSWORD}@db:5432/vaani?connection_limit=10
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    networks: [internal]

  kb-reindex:
    image: vaani-app:latest
    container_name: vaani-kb-reindex
    restart: unless-stopped
    command: ["npm", "run", "worker:kb"]
    env_file: .env
    environment:
      NODE_ENV: production
      RUN_CRON: "true"
      DATABASE_URL: postgresql://vaani:${DB_PASSWORD}@db:5432/vaani?connection_limit=5
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    networks: [internal]

  db:
    image: postgres:16
    container_name: vaani-db-prod
    restart: unless-stopped
    environment:
      POSTGRES_USER: vaani
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: vaani
    volumes:
      - pgdata_prod:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vaani -d vaani"]
      interval: 5s
      timeout: 3s
      retries: 30
    networks: [internal]

  redis:
    image: redis:7
    container_name: vaani-redis-prod
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 30
    networks: [internal]

  minio:
    image: minio/minio:latest
    container_name: vaani-minio-prod
    restart: unless-stopped
    command: server /data
    environment:
      MINIO_ROOT_USER: vaani
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - miniodata_prod:/data
    networks: [internal]

  caddy:
    image: caddy:2
    container_name: vaani-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    networks: [web, internal]
    depends_on: [app]

networks:
  internal: {}   # no inbound from outside
  web: {}

volumes:
  pgdata_prod:
  miniodata_prod:
  caddy_data:
```

**File `Caddyfile`** (full content):

```
{
	# On-demand TLS (guide 10 white-label custom domains): Caddy asks the app
	# before issuing a cert for an unknown host. The ask endpoint ONLY approves
	# workspace domains whose DNS was verified (Workspace.customDomainVerifiedAt).
	# interval/burst cap issuance so a flood of fake SNI hosts cannot burn our
	# Let's Encrypt rate limit (50 certs/week/domain).
	on_demand_tls {
		ask http://app:3000/api/domain-ask
		interval 2m
		burst 5
	}
}

{$DOMAIN} {
	reverse_proxy app:3000
	encode gzip
	log {
		output file /data/access.log {
			roll_size 50mb
			roll_keep 5
		}
	}
}

# White-label workspace custom domains: any SNI host not matching {$DOMAIN} lands
# here; a certificate is issued on-demand only when the ask endpoint approves it.
https:// {
	tls {
		on_demand
	}
	reverse_proxy app:3000
	encode gzip
	log {
		output file /data/custom-domains.log {
			roll_size 50mb
			roll_keep 5
		}
	}
}
```

**Update `.env`** for production (Hermes edits; operator provides DOMAIN):
```bash
cd /root/vaani-ai
DB_PW=$(openssl rand -hex 24)
MINIO_PW=$(openssl rand -hex 24)
sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PW/" .env 2>/dev/null || echo "DB_PASSWORD=$DB_PW" >> .env
grep -q '^MINIO_PASSWORD=' .env && sed -i "s/^MINIO_PASSWORD=.*/MINIO_PASSWORD=$MINIO_PW/" .env || echo "MINIO_PASSWORD=$MINIO_PW" >> .env
grep -q '^DOMAIN=' .env || echo "DOMAIN=your-domain-here.com" >> .env
sed -i "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=$MINIO_PW/" .env
sed -i "s/^NODE_ENV=.*/NODE_ENV=production/" .env
grep -q '^RUN_CRON=' .env || echo "RUN_CRON=true" >> .env
```
**Operator now:** set `DOMAIN` in `.env` to the real domain (e.g. `app.vaani.ai`),
confirm DNS A-record → VPS IP.

**Verify:**
```bash
cd /root/vaani-ai
grep -E "^(DOMAIN|DB_PASSWORD|MINIO_PASSWORD|S3_SECRET_KEY|NODE_ENV|RUN_CRON)=" .env | sed 's/=.*/=<set>/'
docker compose -f docker-compose.prod.yml config -q && echo "compose valid"
docker network ls | grep -c internal || true
dig +short $(grep '^DOMAIN=' .env | cut -d= -f2)
```
**Expected:** all six vars `<set>`; `compose valid`; dig returns the VPS public IP.
**If dig returns nothing:** operator fixes DNS before continuing — Caddy cannot issue
TLS without it.
**If compose config errors:** the error names the line — fix against the listing
(most common: a lost indent from copy truncation).

---

## Step 5: Cron & service inventory verification (before launch)

Confirm EVERY scheduled job from the goal's inventory table is registered inside
the worker (they all run in the single `RUN_CRON=true` worker container):

```bash
cd /root/vaani-ai
echo "--- node-cron registrations in worker ---"
grep -n "cron.schedule(" src/worker/index.ts src/worker/cron.ts 2>/dev/null
echo "--- interval registrations in worker ---"
grep -n "setInterval(" src/worker/index.ts
echo "--- kb re-index process ---"
grep -n '"worker:kb"' package.json
echo "--- trunk health script ---"
ls scripts/check-trunk.sh
```
**Expected:**
- `cron.schedule` lines covering: every-minute sweeps (`* * * * *`), nightly cap
  reset (`0 3 * * *`), digests (`5 * * * *`), retention (`30 3 * * *`), rentals/
  add-ons/plan fees (`15 3 1 * *`), monthly invoices (`30 4 1 * *`), auto-top-up
  sweep (`*/15 * * * *`) — the exact set depends on guides 07/08/09; every line
  must sit inside an `if (RUN_CRON)` guard (Step 1d).
- `setInterval` lines for recording-ingestion (60s), webhook-delivery (15s),
  post-call (45s), gdpr (60s), each guarded by RUN_CRON.
- `"worker:kb"` script present; `scripts/check-trunk.sh` exists.
**If a registration is missing:** the owning guide (07/08/09) is incomplete — STOP
and report which job; do NOT add cron jobs here.

---

## Step 6: Migrate + launch

```bash
cd /root/vaani-ai
# stop dev stack to free resources (dev data preserved in its own volumes)
docker compose down || true

docker compose -f docker-compose.prod.yml up -d
sleep 25
docker compose -f docker-compose.prod.yml ps
```
**Expected:** 7 containers `Up` — `vaani-app`, `vaani-worker`, `vaani-kb-reindex`,
`vaani-db-prod`, `vaani-redis-prod`, `vaani-minio-prod`, `vaani-caddy` (db/redis
healthy; app becomes healthy within ~40s).

**Run migrations + seed against the PROD database:**
```bash
docker exec vaani-app npx prisma migrate deploy
docker exec vaani-app npx tsx prisma/seed.ts
```
**Expected:** `Applying migration ... init` / "All migrations have been successfully
applied"; seed prints the demo credentials block.
(Seed creates the demo workspace — acceptable for day 1; the operator may delete it
from the DB later. Do NOT skip the Plans it seeds — billing needs them.)

**Verify the full public path:**
```bash
DOMAIN=$(grep '^DOMAIN=' /root/vaani-ai/.env | cut -d= -f2)
curl -s -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/"
curl -s "https://$DOMAIN/" | grep -o "language" | head -1
curl -s -o /dev/null -w "%{http_code}\n" "http://$DOMAIN/"   # http must redirect
```
**Expected:** `200`, `language`, `308` (or 301/302 — a redirect to https).
**If it fails:**
- 502 → app container not up: `docker logs vaani-app --tail 40`.
- TLS error / timeout → DNS not propagated yet (`dig` again) or ports 80/443 blocked:
  `ufw status` (must allow 80,443 — guide 01 did this).
- Caddy cert errors: `docker logs vaani-caddy --tail 40` and report.

**Worker checks:**
```bash
docker logs vaani-worker --tail 5
docker logs vaani-kb-reindex --tail 5
docker inspect --format "{{.State.Health.Status}}" vaani-app
```
**Expected:** worker ready line (with `CAMPAIGN_DRY_RUN` shown); kb-reindex startup
line; app health `healthy`.

---

## Step 7: Production smoke test + health/status verification

```bash
cd /root/vaani-ai
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
BASE_URL="https://$DOMAIN" ./scripts/smoke-test.sh
```
**Expected:** all PASS (guide 11's suite), exit 0.

**H1 — health endpoint (prod, public):**
```bash
DOMAIN=$(grep '^DOMAIN=' /root/vaani-ai/.env | cut -d= -f2)
curl -s "https://$DOMAIN/api/health"
```
**Expected:** JSON with `"status":"ok"` (or `"degraded"` only while Dograh is not yet
wired in Step 9), `"checks":{"db":true,"redis":true,"minio":true,...}`, HTTP 200.
Verify the HTTP code explicitly:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/api/health"
```
→ `200`.

**H2 — status page is public (no login redirect):**
```bash
DOMAIN=$(grep '^DOMAIN=' /root/vaani-ai/.env | cut -d= -f2)
curl -s -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/status"
curl -s "https://$DOMAIN/status" | grep -o "Vaani AI status" | head -1
```
**Expected:** `200`, `Vaani AI status`. NOT a 307 redirect.

**H3 — forced-failure negative test (alerting + health):**
```bash
cd /root/vaani-ai
docker stop vaani-redis-prod
sleep 3
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
curl -s -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/api/health"
docker start vaani-redis-prod
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/api/health"
```
**Expected:** `503` while redis is stopped, then `200` after restart. (The
health-watch cron installed in Step 8 would page on this — that is the design.)

Then register a REAL account via the public URL (operator) and log in — the golden
path rows 1–3 should work in prod, and the onboarding wizard (guide 10) should
appear automatically for the fresh workspace.

---

## Step 8: Backups (Postgres + MinIO) + restore drill + log rotation + uptime + alert cron

**File `scripts/backup.sh`** (full content — replaces the old one; now includes
MinIO):

```bash
#!/usr/bin/env bash
# Daily backup: Postgres dump + MinIO bucket mirror. Keeps 14 days. Run via cron.
set -euo pipefail
DIR=/root/backups
mkdir -p "$DIR/minio"
STAMP=$(date +%Y%m%d-%H%M%S)

# 1. Postgres
docker exec vaani-db-prod pg_dump -U vaani -d vaani --format=custom -f "/tmp/vaani-$STAMP.dump"
docker cp "vaani-db-prod:/tmp/vaani-$STAMP.dump" "$DIR/vaani-$STAMP.dump"
docker exec vaani-db-prod rm "/tmp/vaani-$STAMP.dump"
find "$DIR" -name "vaani-*.dump" -mtime +14 -delete
echo "backup ok: $DIR/vaani-$STAMP.dump ($(du -h "$DIR/vaani-$STAMP.dump" | cut -f1))"

# 2. MinIO (recordings, knowledge docs, KYC, branding) → mirror to /root/backups/minio
MINIO_PW=$(grep '^MINIO_PASSWORD=' /root/vaani-ai/.env | cut -d= -f2-)
NETWORK=$(docker inspect vaani-minio-prod --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker run --rm --network "$NETWORK" \
  -v "$DIR/minio:/backup" \
  -e "MC_HOST_vaani=http://vaani:${MINIO_PW}@minio:9000" \
  minio/mc:latest mirror --overwrite vaani /backup
echo "minio backup ok: $(du -sh "$DIR/minio" | cut -f1) across $(find "$DIR/minio" -type f | wc -l) objects"
```

**Do:**
```bash
cd /root/vaani-ai
chmod +x scripts/backup.sh
./scripts/backup.sh
```
**Expected:** `backup ok: /root/backups/vaani-<stamp>.dump (<size>)` AND
`minio backup ok: <size> across <n> objects`.
**If the MinIO mirror fails:** `docker run --rm --network <network> minio/mc:latest ls`
errors name the cause — most often the network lookup; verify
`docker inspect vaani-minio-prod --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'`
prints `vaani-ai_internal` (or the project-prefixed equivalent).

**Restore drill (quarterly habit — run once now):**
```bash
# 1. Postgres: the dump must list 30+ tables (proves it is restorable)
LATEST=$(ls -t /root/backups/vaani-*.dump | head -1)
pg_restore --list "$LATEST" 2>/dev/null | grep -c "TABLE DATA" || \
  docker exec vaani-db-prod pg_restore --list "/tmp/$(basename "$LATEST")" 2>/dev/null | grep -c "TABLE DATA" || \
  docker run --rm -v /root/backups:/b postgres:16 pg_restore --list "/b/$(basename "$LATEST")" | grep -c "TABLE DATA"

# 2. MinIO: pick any backed-up object and prove it reads back
find /root/backups/minio -type f | head -3
```
**Expected:** a number ≥ 30 (the schema has ~50 tables); three file paths print.
If pg_restore prints `0` or errors → the dump is corrupt: re-run `scripts/backup.sh`
and re-check; if still failing, STOP and report.

**Install the cron jobs (backup daily 03:17; health watch every 2 min; trunk check hourly):**
```bash
( crontab -l 2>/dev/null | grep -v "backup.sh\|health-watch.sh\|check-trunk.sh" ; \
  echo "17 3 * * * /root/vaani-ai/scripts/backup.sh >> /var/log/vaani-backup.log 2>&1" ; \
  echo "*/2 * * * * /root/vaani-ai/scripts/health-watch.sh >> /var/log/vaani-healthwatch.log 2>&1" ; \
  echo "7 * * * * /root/vaani-ai/scripts/check-trunk.sh >> /var/log/vaani-trunk.log 2>&1 || /root/vaani-ai/scripts/alert.sh 'SIP trunk health check failed'" \
) | crontab -
crontab -l | grep -c "backup.sh\|health-watch.sh\|check-trunk.sh"
```
**Expected:** `3`.
**Operator note:** the alert path only pages once `ALERT_SLACK_WEBHOOK_URL` is set
(Step 11 / go-live checklist). Until then `health-watch.sh` logs failures to
`/var/log/vaani-healthwatch.log`.

**Docker log rotation (system-wide):**
```bash
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
systemctl restart docker
docker compose -f /root/vaani-ai/docker-compose.prod.yml up -d
```
**Expected:** compose recreates containers and all 7 return to `Up`. Verify with
`docker compose -f /root/vaani-ai/docker-compose.prod.yml ps`.

**Uptime (operator):** see Step 11 — external monitor + public status URL.

---

## Step 9: Point the voice stack at production

1. **Razorpay webhook:** operator sets webhook URL `https://<domain>/api/webhooks/razorpay`
   in the Razorpay dashboard (secret = `RAZORPAY_WEBHOOK_SECRET` from `.env`).
2. **Vobiz/Dograh:** update the inbound webhook/stream destination for the DID to the
   production URL of Dograh. Dograh itself runs on this VPS (guide 04) — ensure its
   compose is up (`docker ps | grep -i dograh`) and its public endpoint is reachable.
   If Dograh must also be behind HTTPS, add a second block to the Caddyfile ABOVE the
   catch-all `https://` block, e.g.:
   ```
   voice.{$DOMAIN} {
   	reverse_proxy localhost:8000
   }
   ```
   then `docker restart vaani-caddy`. (Use the actual Dograh port from guide 04 Step 2.
   A named block always wins over the on-demand catch-all, so `voice.<domain>` gets a
   normal certificate immediately.)
3. **`DOGRAH_BASE_URL`** in `.env` must be the value the APP containers can reach:
   Dograh runs on the host → use `http://host.docker.internal:<port>`. The
   `extra_hosts: host.docker.internal:host-gateway` entries are already in the prod
   compose (Step 4) for app and worker. Recreate after editing `.env`:
   `docker compose -f docker-compose.prod.yml up -d`.

**Verify voice path (prod):**
```bash
docker exec vaani-app node -e "fetch(process.env.DOGRAH_BASE_URL + '/').then(r=>console.log('dograh reachable:', r.status)).catch(e=>{console.error('UNREACHABLE');process.exit(1)})" 2>/dev/null || \
docker exec vaani-app sh -c 'curl -s -o /dev/null -w "dograh reachable: %{http_code}\n" $DOGRAH_BASE_URL/ || echo UNREACHABLE'
```
**Expected:** a reachable HTTP status (200/404 both prove connectivity; connection
refused = fix the extra_hosts/port). After this, `curl https://<domain>/api/health`
must show `"dograh":true` and `"status":"ok"`.

---

## Step 10: Observability — per-call tracing, latency histograms, error budgets

No new code here — this is the operating manual for what guides 04–09 already emit.
Read it once; the checklist items get verified in the go-live list.

**Per-call tracing (readme §12).** One call = one `Call` row, correlated to the voice
engine by `Call.dograhCallId` (unique). Every Dograh webhook payload lands as an
append-only `CallEvent` row (`type` = status/transcript/tool/summary). When Dograh
reports stage timings, they are stored in the payload using the structured shape:

```json
{ "callId": "<dograhCallId>", "sttMs": 210, "llmMs": 480, "ttsMs": 160 }
```

- Confirm guide 08's webhook handler persists these latency fields into
  `CallEvent.payload` (grep: `grep -n "sttMs\|llmMs\|ttsMs" src/app/api/webhooks/dograh/route.ts src/lib/*.ts`).
- To trace a slow call: find the `Call` by phone/time, read `dograhCallId`, then
  `SELECT type, payload, "createdAt" FROM "CallEvent" WHERE "callId"='<id>' ORDER BY "createdAt";`
  and compare `sttMs/llmMs/ttsMs` against the <800ms end-to-end budget (Vobiz adds ~80ms).

**Latency histograms (data source = existing Call rows, reused by analytics):**

```bash
docker exec vaani-db-prod psql -U vaani -d vaani -c \
  "SELECT width_bucket(\"durationSec\", 0, 600, 12) AS bucket_50s, count(*)
   FROM \"Call\" WHERE \"createdAt\" > now() - interval '7 days'
   GROUP BY 1 ORDER BY 1;"
```
Run weekly; a right-shift over time means the voice stack is degrading (check
Dograh logs, OpenRouter provider latency, Sarvam status).

**Error budget (documented targets):**

| SLI | Target | Budget (30d) | Page when |
|---|---|---|---|
| Call setup success (answered+completed / attempted) | 99.0% | 1% failed | burn rate >2× for 1h |
| `/api/health` = ok | 99.5% | ~3.6h down/degraded | any `"down"` (immediate), degraded >15 min |
| Webhook delivery success | 99.5% | 0.5% | `WebhookDelivery.status=FAILED` count >20/day |
| Backup success | 100% | 0 missed | no new file in `/root/backups` by 04:00 |

When budget is exhausted: freeze feature work, fix reliability first. That is the
whole error-budget policy — one paragraph, enforced by the operator.

---

## Step 11: Status page + uptime SLA (operator-gated external monitor)

The in-app part (`/status`, Step 1b) is live already. The 30-day uptime number and
the public incident page come from an external ping service — Hermes cannot create
accounts, so the OPERATOR does this (10 minutes):

1. Create a free account at **Better Uptime** (betteruptime.com) — or UptimeRobot.
2. Add a monitor: URL `https://<domain>/api/health`, check every 30 seconds,
   keyword check: response contains `"status":"ok"`.
3. Add the operator email (+ Slack channel if used) as escalation.
4. Create a **public status page** in the same tool; copy its public URL.
5. Tell Hermes the URL — Hermes then runs:
   ```bash
   cd /root/vaani-ai
   sed -i "s|^STATUS_UPTIME_URL=.*|STATUS_UPTIME_URL=<the-public-url>|" .env
   grep -q '^ALERT_SLACK_WEBHOOK_URL=' .env && \
   sed -i "s|^ALERT_SLACK_WEBHOOK_URL=.*|ALERT_SLACK_WEBHOOK_URL=<slack-webhook-url>|" .env
   docker compose -f docker-compose.prod.yml up -d app
   ```
   (The Slack incoming webhook URL comes from api.slack.com → your workspace →
   Incoming Webhooks → add to channel. This is what `scripts/alert.sh` posts to.)
6. Verify: `curl -s https://<domain>/status | grep -c "status-uptime-link"` → `1`.

**OPERATOR GATE:** if no external monitor is created, `/status` still works (live
checks + incident log) but shows the "being configured" note for 30-day uptime.
Acceptable for week 1; required before selling SLA-backed plans.

---

## Step 12: Security & encryption ops audit (readme §11)

Run every check; tick or fix:

**S1 — TLS in transit:** `curl -sI "https://$(grep '^DOMAIN=' .env | cut -d= -f2)/" | head -1`
→ `HTTP/2 200` (Caddy auto-HTTPS — exists). White-label domains: on-demand TLS
(Step 4) issues on first verified visit.

**S2 — SRTP/TLS on Vobiz trunks (OPERATOR):** in the Vobiz dashboard trunk settings,
confirm transport = TLS and SRTP media encryption enabled for the production trunk
(guide 04 configured the trunk; this is the encryption audit of it). Record yes/no
in the report. If the Vobiz plan does not expose TLS/SRTP toggles, note it as an
accepted provider limitation and confirm account-level encryption with Vobiz support.

**S3 — At-rest encryption (OPERATOR):** Postgres/MinIO volumes: either provision the
VPS disk with LUKS (Hetzner/DigitalOcean: provider-managed volume encryption) or
document that the provider encrypts disks at the hypervisor level. One line in the
report — this is a procurement decision, not a code change. MinIO SSE (per-object
encryption) is OPTIONAL on top: not enabled in v1 (LUKS/provider encryption covers
the disk); enabling SSE-KMS later is a MinIO config change, no app change.

**S4 — Secrets audit:**
```bash
cd /root/vaani-ai
# .env must be git-ignored and 600
git check-ignore .env && echo ".env is git-ignored"
chmod 600 .env && stat -c "%a %n" .env
# no live-looking secrets committed anywhere tracked
git grep -n -E "rzp_live|sk_live|sk-or-v1-[a-z0-9]{20}|AKIA[0-9A-Z]{16}" -- . ':!plan' || echo "no live secrets in git"
# .env.example must contain placeholders only, no real values
grep -E "=(sk|rzp|whsec|pay)_[A-Za-z0-9]" .env.example || echo ".env.example clean"
```
**Expected:** `.env is git-ignored`; `600 .env`; `no live secrets in git`;
`.env.example clean`.
**If a secret is found in git:** STOP and report the file/line to the operator —
rotating the key is a human decision.

**S5 — Dry-run prod-noop trap (the classic):** every DRY_RUN flag defaults to `true`
in dev (safe, no-ops the money/compliance paths). In prod they must be set
DELIBERATELY — a forgotten `=true` silently no-ops QA scoring, retention, auto
top-ups, WhatsApp sends or all dialing:
```bash
grep -E "^(QA_DRY_RUN|RETENTION_DRY_RUN|AUTOTOPUP_ENABLED|CAMPAIGN_DRY_RUN|WHATSAPP_DRY_RUN)=" .env
```
**Expected:** all five lines present. Values are the operator's go-live decision
(Step 14): dialing starts with `CAMPAIGN_DRY_RUN=true` and flips only on the
checklist; QA/RETENTION/WHATSAPP should go `false` when those subsystems are
verified (checklist items 10/11/13); `AUTOTOPUP_ENABLED=false` until Razorpay
tokenization is operator-approved (guide 09 gate).

---

## Step 13: Scaling — horizontal workers, DB limits, provider capacity, load smoke

**Horizontal worker scaling (readme §12).** BullMQ distributes jobs across every
consumer; crons stay on the primary worker only (`RUN_CRON=false` below).

**File `docker-compose.scale.yml`** (full content — OPTIONAL, apply when needed):

```yaml
# Extra dialer-only workers. Usage:
#   docker compose -f docker-compose.prod.yml -f docker-compose.scale.yml up -d
# BullMQ spreads dial jobs across vaani-worker + these replicas. Crons do NOT run
# here (RUN_CRON=false) — no overlap with the primary worker.
services:
  worker-scale:
    image: vaani-app:latest
    restart: unless-stopped
    command: ["npx", "tsx", "src/worker/index.ts"]
    env_file: .env
    environment:
      NODE_ENV: production
      RUN_CRON: "false"
      DATABASE_URL: postgresql://vaani:${DB_PASSWORD}@db:5432/vaani?connection_limit=5
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    deploy:
      replicas: 2
    networks: [internal]
```

**Verify (apply + confirm no cron duplication):**
```bash
cd /root/vaani-ai
docker compose -f docker-compose.prod.yml -f docker-compose.scale.yml up -d
docker ps --format "{{.Names}}" | grep -c "worker"
docker compose -f docker-compose.prod.yml -f docker-compose.scale.yml logs worker-scale 2>&1 | grep -c "cron" || echo "0 cron registrations on scaled workers"
```
**Expected:** ≥3 worker containers (primary + 2 replicas); scaled workers log the
worker-ready line WITHOUT the cron registration lines.
To scale down later: `docker compose -f docker-compose.prod.yml up -d` (the base
file only) removes the extra service.

**DB connection limits:** each container's `DATABASE_URL` carries
`connection_limit` (app 10, worker 10, kb-reindex 5, scaled 5). Postgres default
`max_connections` = 100 — keep total ≤ 80: at 8 containers the budget is
10+10+5+2×5+Caddy(0)=35, leaving headroom. If you add replicas beyond 8, raise
`max_connections` in the db service command or lower the limits.

**Provider capacity:** Vobiz handles 3M+ calls/day with 99.99% uptime and supports
bulk dialing up to 1,000 destinations per API request — the app hits those limits
long after the single VPS does. Scale order when busy: (1) worker replicas (above),
(2) bigger VPS, (3) Dograh's own compose gets its own VPS (config change, guide 04
patterns), (4) Postgres to managed. OpenRouter fails over across providers
mid-traffic automatically — a rate-limited provider never kills a live call.

**Load-test smoke (operator, after go-live):** run guide 11's webhook burst script
against PROD:
```bash
BASE_URL="https://$(grep '^DOMAIN=' .env | cut -d= -f2)" ./scripts/webhook-burst.sh
```
(if guide 11 named the script differently, use its exact name — see guide 11's
load/burst step.) **Expected:** the suite's own pass criteria; `/api/health`
stays `ok` during the burst; worker logs show idempotent dedupe, not duplicates.

---

## Step 14: Go-live checklist with the OPERATOR (human decisions)

Hermes presents these; the OPERATOR answers yes/no. Every "no" stays a no-op-safe
default.

1. [ ] **Flip live dialing:** set `CAMPAIGN_DRY_RUN=false` in `.env` and
      `docker compose -f docker-compose.prod.yml up -d worker`. Until this, campaigns
      simulate. — operator decision: ___
2. [ ] **Real DID live:** live-call scripts from guide 11 executed and scores recorded. — done: ___
3. [ ] **Razorpay live keys:** swap test keys for live keys in `.env` + webhook. Until
      then, top-ups stay in test mode. — deferred: ___
4. [ ] **Uptime monitor + public status page** created; `STATUS_UPTIME_URL` set. — done: ___
5. [ ] **Alerting verified:** `ALERT_SLACK_WEBHOOK_URL` set; forced-failure test
      (Step 7 H3) produced a Slack message within 2 minutes. — done: ___
6. [ ] **Backups verified:** today's Postgres dump + MinIO mirror exist; restore
      drill (Step 8) passed. — done: ___
7. [ ] **2FA (TOTP) enabled for the owner account** (guide 03: settings → security). — done: ___
8. [ ] **API key created** with least-privilege scopes (guide 03/09 UI); tested with
      one authenticated `curl` against `/api/v1/`. — done: ___
9. [ ] **Outbound webhook tested:** one subscription (guide 06/08) received a signed
      `call.completed` test delivery with HTTP 200. — done: ___
10. [ ] **QA scoring verified on 1 real call** (QaScore row exists), then
      `QA_DRY_RUN=false`. — done: ___
11. [ ] **Retention dry-run reviewed** (log shows what WOULD delete), then
      `RETENTION_DRY_RUN=false`. — done: ___
12. [ ] **Digest email received** at a real mailbox (guide 08 digest settings). — done: ___
13. [ ] **WhatsApp sends verified** (one template), then `WHATSAPP_DRY_RUN=false`. — done: ___
14. [ ] **Status page public:** `curl https://<domain>/status` → 200 logged out. — done: ___
15. [ ] **Onboarding walkthrough:** a fresh account completed the guide-10 wizard
      end-to-end in prod (<30 min). — done: ___
16. [ ] **Cron inventory confirmed:** `docker logs vaani-worker` shows every job from
      the Step-5 table registered exactly once. — done: ___
17. [ ] **SRTP/TLS on the Vobiz trunk** confirmed (S2). — done: ___

---

## Step 15: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 12: production — prod stack, on-demand TLS, health+status+alerting, backups, scaling, security ops"
git log --oneline | head -n 13
```
**Expected:** 13 phase commits visible — the full build history.

---

## Acceptance Checklist

- [ ] `docker compose -f docker-compose.prod.yml ps` → 7 containers Up (app healthy)
- [ ] `https://<domain>` → 200 landing with valid TLS; http redirects to https
- [ ] `/api/health` → 200 JSON `"status":"ok"`; `503` on forced redis stop; `/status` → 200 logged out
- [ ] Caddyfile has `on_demand_tls` + ask endpoint; `/api/domain-ask` 403 for unverified domains
- [ ] All Step-5 cron jobs visible in worker logs, each registered exactly once (RUN_CRON guard)
- [ ] `prisma migrate deploy` applied; Plans seeded
- [ ] Public smoke test: all PASS
- [ ] New account registration works over the public URL; wizard appears
- [ ] Worker + kb-reindex running; app can reach Dograh (`"dograh":true`)
- [ ] Daily backup cron (pg + minio) installed; one backup of each exists; restore drill passed; docker logs capped 50m×5
- [ ] health-watch cron installed; alert.sh mock test passed; mock-negative test exit 1
- [ ] Secrets audit clean (S4); .env = 600; all 5 DRY_RUN flags present in .env (S5)
- [ ] Git commit `phase 12: ...` exists

## FINAL REPORT format

```
STEP 1..15: PASS/FAIL — <evidence>
RUN_CRON guards wrapped: <list of registrations wrapped in Step 1d>
DOMAIN: <domain>   TLS: OK/FAILED
HEALTH: /api/health=<json status> /status=<code> forced-fail=<code>→<code>
SMOKE (prod): <n passed, n failed>
CRON INVENTORY: <n/n jobs confirmed in worker logs>
VOICE PATH: reachable=<status> / UNREACHABLE
BACKUP: pg=<file,size> minio=<objects> restore-drill=<table count>
ALERTING: mock=PASS/FAIL missing-url-exit=<code> slack-set=YES/NO
SECURITY: S1=<code> S2=<y/n> S3=<note> S4=clean/<files> S5=<flags>
GO-LIVE ANSWERS: <operator's 17 answers>
ACCEPTANCE: n/13 checked
NOTES: <deviations>
```
