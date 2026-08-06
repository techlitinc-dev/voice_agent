import { NextRequest, NextResponse } from "next/server";
import { fetchOidcDiscovery, getOidcConfig } from "@/lib/oidc";

export async function GET(req: NextRequest) {
  const cfg = getOidcConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "oidc_not_configured" }, { status: 400 });
  }
  try {
    const discovery = await fetchOidcDiscovery(cfg.issuer);
    const state = crypto.randomUUID();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);

    // Only mark the cookie Secure when the request actually arrived over HTTPS
    // (Caddy sets x-forwarded-proto). NODE_ENV is wrong for installs served over
    // plain HTTP — browsers silently drop Secure cookies on non-HTTPS connections.
    const isSecure =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
      new URL(req.url).protocol === "https:";

    const res = NextResponse.redirect(url.toString());
    res.cookies.set("vaani_sso_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/",
      maxAge: 10 * 60,
    });
    return res;
  } catch (e) {
    console.error("oidc start failed", e);
    return NextResponse.json({ ok: false, error: "oidc_discovery_failed" }, { status: 502 });
  }
}
