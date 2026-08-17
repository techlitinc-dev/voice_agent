import { NextRequest, NextResponse } from "next/server";
import { metricsText } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — Prometheus text exposition (observability doc §2.1).
 *
 * PROTECTED (doc §2.1): the payload carries workspaceId labels, so this route
 * requires either a bearer token (METRICS_TOKEN) or basic-auth credentials
 * (METRICS_USER / METRICS_PASS). Prometheus is configured with the same secret.
 * Falls back to deny-by-default when unset — only the healthcheck path can
 * confirm the app is alive without it.
 */
export async function GET(req: NextRequest) {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  } else {
    const user = process.env.METRICS_USER ?? "metrics";
    const pass = process.env.METRICS_PASS;
    if (!pass) return new NextResponse("Metrics not configured", { status: 503 });
    const header = req.headers.get("authorization") ?? "";
    const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    if (header !== expected) return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await metricsText();
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
