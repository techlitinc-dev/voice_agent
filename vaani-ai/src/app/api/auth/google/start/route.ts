import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(_req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, error: "google_sso_not_configured" }, { status: 400 });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `${baseUrl}/api/auth/google/callback`);
  const state = crypto.randomUUID();
  const url = oauth2.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set("vaani_sso_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
