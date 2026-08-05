import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { exchangeOidcCode, fetchOidcDiscovery, fetchOidcUserInfo, getOidcConfig } from "@/lib/oidc";

function baseUrl() {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const cookieState = req.cookies.get("vaani_sso_state")?.value;
  if (!state || !code || !cookieState || state !== cookieState) {
    return NextResponse.json({ ok: false, error: "invalid_state" }, { status: 400 });
  }

  const cfg = getOidcConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "oidc_not_configured" }, { status: 400 });
  }

  try {
    const discovery = await fetchOidcDiscovery(cfg.issuer);
    const accessToken = await exchangeOidcCode(cfg, discovery, code);
    const info = await fetchOidcUserInfo(discovery, accessToken);
    if (!info.email) throw new Error("IdP did not return an email claim");
    const email = info.email.toLowerCase();

    // 1) Existing SSO link?
    const identity = await db.ssoIdentity.findUnique({
      where: { provider_externalSubjectId: { provider: "OIDC", externalSubjectId: info.sub } },
    });
    let userId: string;
    if (identity) {
      userId = identity.userId;
    } else {
      // 2) Enterprise rule: user must already exist (invited). No auto-provisioning.
      const user = await db.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json(
          { ok: false, error: "no_account", message: "Ask your workspace admin to invite this email first." },
          { status: 403 }
        );
      }
      await db.ssoIdentity.create({
        data: { userId: user.id, provider: "OIDC", externalSubjectId: info.sub, email },
      });
      userId = user.id;
    }

    const membership = await db.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    await createSession(userId, membership?.workspaceId);
    if (membership) {
      await logAudit({
        workspaceId: membership.workspaceId, userId,
        action: "sso.login", entity: "User", entityId: userId,
        metadata: { provider: "OIDC", issuer: cfg.issuer },
      });
    }
    return NextResponse.redirect(`${baseUrl()}/dashboard`);
  } catch (e) {
    console.error("oidc sso failed", e);
    return NextResponse.redirect(`${baseUrl()}/login?error=sso`);
  }
}
