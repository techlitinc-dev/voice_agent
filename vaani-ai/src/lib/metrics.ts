import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

/**
 * Application metrics (observability doc §2). Single shared registry so the
 * /api/metrics endpoint and the worker process expose the SAME series.
 *
 * Labels carry workspaceId — the /metrics endpoint MUST be protected (basic
 * auth or Prometheus IP allowlist) as it exposes tenant-level cardinality.
 */

const register = new Registry();

collectDefaultMetrics({ register });

// ---------- Counters ----------

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

export const paymentsInitiated = new Counter({
  name: "vaani_payments_initiated_total",
  help: "Total payment attempts initiated",
  labelNames: ["provider", "workspace_id"],
  registers: [register],
});

export const paymentsFailed = new Counter({
  name: "vaani_payment_failed_total",
  help: "Total failed payment attempts",
  labelNames: ["provider", "reason", "workspace_id"],
  registers: [register],
});

export const webhooksDelivered = new Counter({
  name: "vaani_webhooks_delivered_total",
  help: "Total outbound webhook deliveries",
  labelNames: ["status", "workspace_id"],
  registers: [register],
});

export const webhooksReceived = new Counter({
  name: "vaani_webhooks_received_total",
  help: "Total inbound webhook events",
  labelNames: ["provider", "workspace_id"],
  registers: [register],
});

// ---------- Histograms ----------

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

export const llmLatency = new Histogram({
  name: "vaani_llm_latency_seconds",
  help: "LLM completion latency",
  labelNames: ["model"],
  buckets: [0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const dograhLatency = new Histogram({
  name: "vaani_dograh_request_duration_seconds",
  help: "Dograh API request latency",
  labelNames: ["endpoint"],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// ---------- Gauges ----------

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

export const activeCampaigns = new Gauge({
  name: "vaani_active_campaigns",
  help: "Campaigns currently RUNNING",
  registers: [register],
});

export const workerLagSeconds = new Gauge({
  name: "vaani_worker_lag_seconds",
  help: "Age of the oldest pending job per queue",
  labelNames: ["queue"],
  registers: [register],
});

/** Convenience wrapper — record an HTTP request duration with route+status. */
export function recordHttpDuration(method: string, route: string, status: number, seconds: number) {
  httpRequestDuration.labels(method, route, String(status)).observe(seconds);
}

/** Text exposition for Prometheus scraping. */
export function metricsText(): Promise<string> {
  return register.metrics();
}

export { register };
