import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register"];
const PUBLIC_PREFIXES = [
  "/api/webhooks/",   // Dograh/Razorpay webhooks have their own signature checks
  "/api/auth/",       // SSO start + callback routes set the cookie themselves
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
  "/api/domain-ask",  // Caddy on-demand TLS ask endpoint — public by design (guide 10/12)
  "/api/tools/",      // Dograh mid-call tool executor — guarded by x-tool-secret, not cookies
  "/api/mcp",         // MCP proxy route does its own x-mcp-key check (guide 04 Step 17)
  "/api/exports/",    // CSV export routes do their own cookie auth → 401 when logged out
  "/invite/",         // invite acceptance page handles its own auth logic
  "/status",          // public status page (guide 12) — public by design
  "/api/health",      // public health endpoint (guide 12) — public by design
  "/_next/",
  "/favicon.ico",
];

// Top-level app (auth-guarded) routes. Anything NOT in this set and not public is
// left to Next.js to 404 — the middleware must not hijack unknown paths to /login.
const APP_ROUTE_PREFIXES = [
  "/dashboard", "/agents", "/marketplace", "/knowledge", "/campaigns", "/contacts",
  "/calls", "/live", "/transfers", "/dialer", "/numbers", "/analytics", "/billing",
  "/settings", "/onboarding",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!APP_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next(); // unknown route → Next.js 404
  }

  const session = req.cookies.get("vaani_session")?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
