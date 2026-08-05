import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { google } from "googleapis";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { provisionUserWithWorkspace } from "@/lib/provision";

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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, error: "google_sso_not_configured" }, { status: 400 });
  }

  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `${baseUrl()}/api/auth/google/callback`);
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
    const { data: profile } = await oauth2api.userinfo.get();
    if (!profile.id || !profile.email) throw new Error("no profile");

    const email = profile.email.toLowerCase();

    // 1) Existing SSO link?
    let identity = await db.ssoIdentity.findUnique({
      where: { provider_externalSubjectId: { provider: "GOOGLE", externalSubjectId: profile.id } },
    });
    let userId: string;
    if (identity) {
      userId = identity.userId;
    } else {
      // 2) Existing user with same email → link the identity.
      let user = await db.user.findUnique({ where: { email } });
      if (!user) {
        // 3) First login via Google → auto-provision a workspace (like register).
        const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
        const provisioned = await provisionUserWithWorkspace({
          fullName: profile.name ?? email.split("@")[0],
          email,
          passwordHash,
          businessName: `${profile.name ?? "My"}'s Workspace`,
        });
        user = provisioned.user;
      }
      identity = await db.ssoIdentity.create({
        data: { userId: user.id, provider: "GOOGLE", externalSubjectId: profile.id, email },
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
        metadata: { provider: "GOOGLE" },
      });
    }
    return NextResponse.redirect(`${baseUrl()}/dashboard`);
  } catch (e) {
    console.error("google sso failed", e);
    return NextResponse.redirect(`${baseUrl()}/login?error=sso`);
  }
}
