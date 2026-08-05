import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register"];
const PUBLIC_PREFIXES = [
  "/api/webhooks/",   // Dograh/Razorpay webhooks have their own signature checks
  "/api/auth/",       // SSO start + callback routes set the cookie themselves
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
  "/api/tools/",      // Dograh mid-call tool executor — guarded by x-tool-secret, not cookies
  "/api/mcp",         // MCP proxy route does its own x-mcp-key check (guide 04 Step 17)
  "/invite/",         // invite acceptance page handles its own auth logic
  "/_next/",
  "/favicon.ico",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

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
