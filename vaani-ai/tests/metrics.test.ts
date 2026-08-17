import { describe, expect, it } from "vitest";
import { register, callsStarted, queueDepth, recordHttpDuration } from "../src/lib/metrics";

describe("metrics registry (observability doc §2)", () => {
  it("exposes prometheus text format", async () => {
    const text = await register.metrics();
    expect(text).toContain("# HELP vaani_calls_started_total");
    expect(text).toContain("vaani_calls_started_total");
  });

  it("counters increment with labels", async () => {
    callsStarted.labels("OUTBOUND", "ws_1").inc(2);
    const text = await register.metrics();
    expect(text).toContain('vaani_calls_started_total{direction="OUTBOUND",workspace_id="ws_1"} 2');
  });

  it("gauges set values", async () => {
    queueDepth.labels("campaign-dialer").set(7);
    const text = await register.metrics();
    expect(text).toContain('vaani_queue_depth{queue="campaign-dialer"} 7');
  });

  it("recordHttpDuration observes into the histogram", async () => {
    recordHttpDuration("GET", "/api/health", 200, 0.05);
    const text = await register.metrics();
    expect(text).toContain('vaani_http_request_duration_seconds_count{method="GET",route="/api/health",status="200"} 1');
    // histogram buckets are le-labelled
    expect(text).toContain("vaani_http_request_duration_seconds_bucket");
  });
});
