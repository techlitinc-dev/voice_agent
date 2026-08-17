/**
 * Next.js instrumentation hook (observability doc §4.1). Node runtime only —
 * edge middleware never loads OpenTelemetry.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTracing } = await import("./lib/tracing");
    startTracing();
  }
}
