import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis-4";

/**
 * Distributed tracing (observability doc §4). Exports OTLP/HTTP traces to Tempo
 * (or any OTLP collector). Loaded ONLY when OTEL_EXPORTER_OTLP_ENDPOINT is set
 * — otherwise this module is a no-op so dev/test processes stay clean.
 *
 * Imported by src/instrumentation.ts (Next.js register hook) and lazily by the
 * worker for its own process.
 */

let sdk: NodeSDK | null = null;
let started = false;

export function startTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || started) return;
  started = true;

  sdk = new NodeSDK({
    serviceName: process.env.LOG_SERVICE ?? "vaani-web",
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new PgInstrumentation(),
      new RedisInstrumentation(),
    ],
  });
  sdk.start();
}

/** Best-effort shutdown for graceful worker exits. */
export async function stopTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
    } catch {
      /* noop */
    }
  }
}
