# 02 — Observability & Monitoring

> **Goal:** You cannot run what you cannot see. This document defines the
> **three pillars of observability** (metrics, logs, traces) for Vaani AI, plus
> alerting, uptime monitoring, and on-call procedures.

---

## 1. The Observability Stack

```
┌─────────────────────────────────────────────────────────────┐
│                      Vaani AI Services                       │
│  (Next.js web, BullMQ workers, Dograh API, Postgres, Redis) │
└──────────┬──────────────┬──────────────┬────────────────────┘
           │              │              │
      metrics          logs          traces
           │              │              │
           ▼              ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  Prometheus│  │   Loki   │   │  Tempo   │
    │  (scrape) │   │  (push)  │   │  (push)  │
    └────┬─────┘   └────┬─────┘   └────┬─────┘
         │              │              │
         └──────────────┴──────────────┘
                        │
                  ┌─────▼─────┐
                  │  Grafana  │  ← unified dashboards + alerts
                  └─────┬─────┘
                        │
                  ┌─────▼─────┐
                  │ Alertmgr  │  → PagerDuty / Slack / Email
                  └───────────┘
```

### Components

| Component | Role | Port |
|---|---|---|
| **Prometheus** | Scrapes & stores metrics (time-series) | 9090 |
| **Grafana** | Visualization, dashboards, alerting UI | 3001 |
| **Loki** | Log aggregation (label-indexed, cheap) | 3100 |
| **Tempo** | Distributed tracing (OpenTelemetry) | 3200 |
| **Alertmanager** | Routes alerts to on-call | 9093 |
| **Node Exporter** | Host CPU/RAM/disk metrics | 9100 |
| **Postgres Exporter** | DB metrics (connections, slow queries) | 9187 |
| **Redis Exporter** | Redis metrics (memory, queue depth) | 9121 |

---

## 2. Metrics — what to collect

### 2.1 Application metrics (Prometheus format)

Expose a `/metrics` endpoint from the Next.js app:

```ts
// src/app/api/metrics/route.ts (new)
import { Registry, Counter, Histogram, Gauge } from "prom-client";

const register = new Registry();

// Counters (monotonically increasing)
export const callsStarted = new Counter({
  name: "vaani_calls_started_total",
  help: "Total calls started",
  labelNames: ["direction", "workspace_id"],
  registers: [register],
});
export const callsCompleted = new Counter({
  name: "vaani_calls_completed_total",
  help: "Total calls completed",
  labelNames: ["direction", "status", "workspace_id"],
  registers: [register],
});

// Histograms (distributions)
export const callDuration = new Histogram({
  name: "vaani_call_duration_seconds",
  help: "Call duration in seconds",
  labelNames: ["direction"],
  buckets: [10, 30, 60, 120, 300, 600],
  registers: [register],
});
export const httpRequestDuration = new Histogram({
  name: "vaani_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// Gauges (current state)
export const activeCalls = new Gauge({
  name: "vaani_active_calls",
  help: "Currently in-progress calls",
  labelNames: ["workspace_id"],
  registers: [register],
});
export const queueDepth = new Gauge({
  name: "vaani_queue_depth",
  help: "BullMQ jobs waiting per queue",
  labelNames: ["queue"],
  registers: [register],
});
export const walletBalance = new Gauge({
  name: "vaani_wallet_balance_paise",
  help: "Workspace wallet balance (paise)",
  labelNames: ["workspace_id"],
  registers: [register],
});

export async function GET() {
  return new Response(await register.metrics(), {
    headers: { "Content-Type": register.contentType },
  });
}
```

> **Important:** Protect `/metrics` with basic auth or allow only Prometheus IP,
> as it exposes tenant-level labels.

### 2.2 Business KPIs to track

| Metric | Type | Alert threshold |
|---|---|---|
| Calls per hour | Counter | — |
| Call success rate (`COMPLETED` / total) | Ratio | < 70% → warn |
| Avg call duration | Histogram | — |
| Avg queue time (inbound pickup) | Histogram | > 10s → page |
| Active campaigns running | Gauge | — |
| Leads qualified per hour | Counter | — |
| Wallet balance (per workspace) | Gauge | < ₹500 → alert user |
| Payment success rate | Ratio | < 95% → page |
| API error rate (5xx / total) | Ratio | > 5% → page |
| Worker lag (oldest pending job age) | Gauge | > 5 min → page |
| Dograh webhook receive → process latency | Histogram | > 30s → warn |

### 2.3 Infrastructure metrics

| Metric | Source | Alert |
|---|---|---|
| CPU usage % | Node Exporter | > 85% for 5 min → page |
| RAM usage % | Node Exporter | > 90% → page |
| Disk usage % | Node Exporter | > 80% → warn, > 90% → page |
| Postgres connections | PG Exporter | > 80% of max → page |
| Postgres replication lag | PG Exporter | > 60s → page |
| Redis memory | Redis Exporter | > 80% → warn |
| Redis evicted keys | Redis Exporter | > 0 → investigate |

---

## 3. Structured Logging

### 3.1 Logger setup

Replace ad-hoc `console.log` with a structured logger that ships to Loki:

```ts
// src/lib/logger.ts (new)
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: ["*.password", "*.token", "*.secret", "*.apiKey", "*.accessToken"], // PII/secret scrubbing
  formatters: {
    level(label) { return { level: label }; },
  },
  default: {
    service: "vaani-web",
    env: process.env.NODE_ENV,
  },
  // In prod, ship to Loki via promtail (which tails stdout)
});

export type Logger = typeof logger;
export default logger;

// Per-request context logger
export function requestLogger(req: Request, workspaceId?: string) {
  return logger.child({
    requestId: crypto.randomUUID(),
    workspaceId,
    method: req.method,
    path: new URL(req.url).pathname,
  });
}
```

### 3.2 Log levels

| Level | Use for | Example |
|---|---|---|
| `fatal` | Process will exit | DB connection lost, secret missing |
| `error` | Operation failed, needs attention | Payment failed, webhook delivery exhausted |
| `warn` | Degraded but functional | Rate limit hit, fallback provider used |
| `info` | Normal business events | Call started, campaign completed, user registered |
| `debug` | Diagnostic detail | LLM prompt, tool call payload (PII-redacted) |
| `trace` | Very fine-grained | SQL query text (dev only) |

### 3.3 Log schema

Every log line **must** include:

```json
{
  "timestamp": "2026-08-07T16:45:23.123Z",
  "level": "info",
  "service": "vaani-web",
  "requestId": "req_abc123",
  "workspaceId": "clxyz...",
  "userId": "clxyz...",
  "message": "Call started",
  "callId": "clxyz...",
  "direction": "inbound",
  "duration": "0ms"
}
```

### 3.4 Promtail → Loki config

```yaml
# /etc/promtail/config.yml
server:
  http_listen_port: 9080
positions:
  filename: /var/lib/promtail/positions.yaml
clients:
  - url: http://loki:3100/loki/api/v1/push
scrape_configs:
  - job_name: vaani-docker
    docker_sd_configs:
      - hosts: ["unix:///var/run/docker.sock"]
    relabel_configs:
      - source_labels: ["__meta_docker_container_name"]
        target_label: "container"
      - source_labels: ["__meta_docker_container_log_stream"]
        target_label: "stream"
    pipeline_stages:
      - json:
          expressions:
            level: level
            workspaceId: workspaceId
            requestId: requestId
      - labels:
          level:
          workspaceId:
```

---

## 4. Distributed Tracing

### 4.1 OpenTelemetry instrumentation

```ts
// src/lib/tracing.ts (new)
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis-4";

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + "/v1/traces",
});

export const sdk = new NodeSDK({
  traceExporter,
  instrumentations: [new HttpInstrumentation(), new PgInstrumentation(), new RedisInstrumentation()],
  service: "vaani-web",
});

sdk.start();
```

Import this at the **top** of `instrumentation.ts` (Next.js instrumentation hook):

```ts
// vaani-ai/src/instrumentation.ts (new)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/tracing");
  }
}
```

### 4.2 Key spans to trace

| Operation | Span name | Attributes |
|---|---|---|
| HTTP request | `http.request` | method, route, status |
| DB query | `db.query` | model, operation, duration |
| Dograh API call | `dograh.request` | endpoint, workflowId |
| LLM completion | `llm.complete` | model, tokens, duration |
| STT transcription | `stt.transcribe` | provider, durationSec |
| TTS synthesis | `tts.synthesize` | provider, voiceId, chars |
| Telephony dial | `telephony.dial` | provider, from, to |
| Webhook delivery | `webhook.deliver` | url, status, attempts |

---

## 5. Health Checks

### 5.1 Health endpoints

The codebase has `/api/health`. Expand to three levels:

```ts
// src/app/api/health/route.ts
// Liveness — is the process alive? (load balancer uses this)
export async function GET() {
  return Response.json({ status: "alive" }, { status: 200 });
}
```

```ts
// src/app/api/health/ready/route.ts
// Readiness — are all dependencies reachable?
import { prisma } from "@/lib/db";
import Redis from "ioredis";

export async function GET() {
  const checks = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    new Redis(process.env.REDIS_URL!).ping(),
    fetch(`${process.env.DOGRAH_API_URL}/health`).then((r) => r.ok),
  ]);
  const ok = checks.every((r) => r.status === "fulfilled");
  return Response.json({
    status: ok ? "ready" : "degraded",
    checks: { db: checks[0].status, redis: checks[1].status, dograh: checks[2].status },
  }, { status: ok ? 200 : 503 });
}
```

```ts
// src/app/api/health/deep/route.ts
// Deep — checks applied on startup and periodically
// - all secrets present
// - migrations applied (Prisma _prisma_migrations count)
// - MinIO bucket exists
// - Dograh reachable
// - Vobiz/Sarvam/OpenRouter API keys valid (lightweight ping)
```

### 5.2 Status page

The codebase has `/status`. Wire it to read from the health endpoints and the
incident log (`content/incidents.md`). Use **Uptime Kuma** (self-hosted) or
**BetterStack** (managed) for external uptime monitoring:

| Check | Interval | Locations |
|---|---|---|
| `https://app.vaani.ai/api/health` | 30s | Mumbai, Singapore |
| `https://app.vaani.ai/` (login page) | 60s | Mumbai |
| Synthetic inbound call (test DID) | 5 min | Internal |

---

## 6. Alerting Rules

### 6.1 Prometheus alert rules

```yaml
# /etc/prometheus/rules/vaani.yml
groups:
  - name: vaani-critical
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(vaani_http_request_duration_seconds_count{status=~"5.."}[5m]))
          / sum(rate(vaani_http_request_duration_seconds_count[5m])) > 0.05
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "5xx error rate > 5% for 5 minutes"

      - alert: WorkerLag
        expr: max(vaani_queue_depth) by (queue) > 100
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "Queue {{ $labels.queue }} has > 100 pending jobs"

      - alert: PostgresDown
        expr: pg_up == 0
        for: 1m
        labels: { severity: page }

      - alert: HighDiskUsage
        expr: (1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100 > 90
        for: 5m
        labels: { severity: page }

      - alert: CallSuccessRateLow
        expr: |
          sum(rate(vaani_calls_completed_total{status="COMPLETED"}[15m]))
          / sum(rate(vaani_calls_started_total[15m])) < 0.70
        for: 15m
        labels: { severity: warn }
        annotations:
          summary: "Call completion rate < 70%"

      - alert: PaymentFailureSpike
        expr: rate(vaani_payment_failed_total[10m]) > 0.1
        for: 5m
        labels: { severity: page }
```

### 6.2 Alert routing

| Severity | Channel | Response time |
|---|---|---|
| `page` | PagerDuty → phone call to on-call | < 5 min |
| `warn` | Slack `#alerts` channel | < 1 hour |
| `info` | Slack `#alerts` (no notification) | Best effort |

### 6.3 On-call rotation

- Use **PagerDuty** (or **Opsgenie**) with a weekly rotation.
- Primary on-call + secondary on-call (escalation after 5 min).
- Follow-the-sun if team spans timezones.
- Post-incident: blameless **postmortem** within 48 hours, added to `content/incidents.md`.

---

## 7. Dashboards (Grafana)

### 7.1 Executive overview dashboard

Panels (single screen, refresh 30s):

1. **Calls today** (stat) — inbound + outbound, today vs yesterday
2. **Active calls** (gauge) — current `vaani_active_calls`
3. **Call success rate** (stat) — last 1h
4. **Avg duration** (stat) — last 1h
5. **Revenue today** (stat) — sum of `billedPaise` for today
6. **Error rate** (stat) — last 5m
7. **Worker health** (table) — queue, depth, oldest job, throughput
8. **System health** (table) — CPU, RAM, disk, DB conns, Redis mem

### 7.2 Operations dashboard

- HTTP p50/p95/p99 latency by route
- Postgres: connections, slow queries, replication lag
- Redis: ops/sec, memory, evictions
- Docker: container CPU/RAM/restart count
- Dograh: webhook receive rate, process latency

### 7.3 Business dashboard

- Calls over time (stacked by direction/status)
- Leads qualified funnel (calls → HOT → converted)
- Campaign progress (per campaign: dialed / completed / pending)
- Cost breakdown (telephony/STT/LLM/TTS) over time
- Wallet balances at risk (list of workspaces < ₹500)

---

## 8. Error Tracking (Sentry)

Add **Sentry** for application error capture (errors that reach the user):

```ts
// vaani-ai/sentry.client.config.ts (new)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1, // 10% performance sampling
  environment: process.env.NODE_ENV,
  beforeSend(event) {
    // Scrub PII before sending
    return scrubPii(event);
  },
});
```

- **Frontend errors**: capture via `sentry.client.config.ts`.
- **Server errors**: capture via `sentry.server.config.ts` + `instrumentation.ts`.
- **Release tracking**: tag events with git commit SHA.
- **Source maps**: upload to Sentry in CI for readable stack traces.

---

## 9. Audit & Compliance Logging

Beyond security audit (see [01-hardening §7](01-hardening-and-security.md#7-security-audit-log-expand-existing)):

- **Immutable audit log**: ship `AuditLog` entries to a write-only S3 bucket (with object lock) for compliance.
- **Access logs**: Caddy/Nginx access logs → Loki, retained 90 days.
- **DB audit**: enable Postgres `pgaudit` extension for DML on PII tables.

---

## Next

→ [03 — Scalability & Performance](03-scalability-and-performance.md)