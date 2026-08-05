import { NextRequest, NextResponse } from "next/server";
import { fetchOidcDiscovery, getOidcConfig } from "@/lib/oidc";

export async function GET(_req: NextRequest) {
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

    const res = NextResponse.redirect(url.toString());
    res.cookies.set("vaani_sso_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return res;
  } catch (e) {
    console.error("oidc start failed", e);
    return NextResponse.json({ ok: false, error: "oidc_discovery_failed" }, { status: 502 });
  }
}
