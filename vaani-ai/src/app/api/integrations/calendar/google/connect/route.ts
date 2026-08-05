import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { googleCalendarAuthUrl } from "@/lib/calendar";
import { signOAuthState } from "@/lib/integrations/oauth-state";

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.redirect(googleCalendarAuthUrl(signOAuthState(ctx.workspaceId)));
}
