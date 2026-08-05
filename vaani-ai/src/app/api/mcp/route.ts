import { NextRequest, NextResponse } from "next/server";

/**
 * MCP exposure scaffold (readme §9). Customers' AI tools connect to
 *   https://<app-domain>/api/mcp
 * with header  x-mcp-key: <MCP_PROXY_KEY>
 * and we forward to the internal Dograh MCP endpoint (DOGRAH_MCP_URL), which is
 * never exposed publicly. One key per deployment in v1 — see the OPERATOR GATE in
 * guide 04 Step 17 about per-tenant isolation.
 */

function upstreamUrl(req: NextRequest): string | null {
  const base = process.env.DOGRAH_MCP_URL;
  if (!base) return null;
  return base.replace(/\/$/, "") + req.nextUrl.search;
}

async function forward(req: NextRequest): Promise<NextResponse> {
  const proxyKey = process.env.MCP_PROXY_KEY ?? "";
  const presented = req.headers.get("x-mcp-key") ?? "";
  if (!proxyKey || presented !== proxyKey) {
    return NextResponse.json({ ok: false, error: "invalid MCP key" }, { status: 401 });
  }
  const url = upstreamUrl(req);
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "DOGRAH_MCP_URL not configured" },
      { status: 503 }
    );
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(url, {
    method: req.method,
    headers: {
      "content-type": req.headers.get("content-type") ?? "application/json",
      accept: req.headers.get("accept") ?? "application/json, text/event-stream",
    },
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export const dynamic = "force-dynamic";
export { forward as GET, forward as POST };
