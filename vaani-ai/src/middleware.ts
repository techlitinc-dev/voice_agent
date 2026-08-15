import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password", "/reset-password", "/status"];
const PUBLIC_PREFIXES = [
  "/api/webhooks/",   // Dograh/Razorpay webhooks have their own signature checks
  "/api/auth/",       // SSO start + callback routes set the cookie themselves
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
  "/api/domain-ask",  // Caddy on-demand TLS ask endpoint — public by design (guide 10/12)
  "/api/health",      // health endpoint for compose checks, status page, alert watcher
  "/api/tools/",      // Dograh mid-call tool executor — guarded by x-tool-secret, not cookies
  "/api/mcp",         // MCP proxy route does its own x-mcp-key check (guide 04 Step 17)
  "/api/exports/",    // CSV export routes do their own cookie auth → 401 when logged out
  "/invite/",         // invite acceptance page handles its own auth logic
  "/widget/",         // public web-chat embed (docs/new-features/04 §3.3) — no session auth
  "/status",          // public status page (guide 12) — public by design
  "/api/health",      // public health endpoint (guide 12) — public by design
  "/_next/",
  "/favicon.ico",
];

// Top-level app (auth-guarded) routes. Anything NOT in this set and not public is
// left to Next.js to 404 — the middleware must not hijack unknown paths to /login.
// The (app) layout ALSO guards every route under it via requireWorkspace(), so a
// route missing here still redirects to login — but without the middleware's
// ?next= it would lose the intended destination. Keep this list in sync with the
// app directory: missing entries only lose the ?next= param, never the guard.
const APP_ROUTE_PREFIXES = [
  "/dashboard", "/agents", "/marketplace", "/knowledge", "/campaigns", "/contacts",
  "/calls", "/live", "/transfers", "/dialer", "/numbers", "/analytics", "/billing",
  "/settings", "/onboarding", "/crm", "/inbox", "/reports", "/reseller",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (APP_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const session = req.cookies.get("vaani_session")?.value;
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    // Forward the attempted path so the app layout can preserve ?next= when a
    // session is present but expired/revoked (AUTH-09/10).
    const res = NextResponse.next();
    res.headers.set("x-vaani-pathname", pathname);
    return res;
  }

  return NextResponse.next(); // unknown route → Next.js 404
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
