import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exchangeGoogleCode } from "@/lib/calendar";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/settings/integrations?error=${encodeURIComponent(msg)}`, req.url));

  const workspaceId = verifyOAuthState(state);
  if (!workspaceId || !code) return fail("Invalid OAuth state — try connecting again.");

  try {
    const tokens = await exchangeGoogleCode(code);
    await db.calendarConnection.upsert({
      where: { workspaceId_provider: { workspaceId, provider: "GOOGLE" } },
      update: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt, active: true },
      create: {
        workspaceId, provider: "GOOGLE",
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt, primaryCalendarId: "primary", active: true,
      },
    });
    await audit({ workspaceId, action: "calendar.connect", entity: "CalendarConnection", metadata: { provider: "GOOGLE" } });
    return NextResponse.redirect(new URL("/settings/integrations?connected=GOOGLE_CALENDAR", req.url));
  } catch (e) {
    console.error(e);
    return fail("Google OAuth failed — check GOOGLE_CALENDAR_CLIENT_ID/SECRET, then retry.");
  }
}
