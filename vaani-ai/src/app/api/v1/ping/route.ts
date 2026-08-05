import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiKey } from "@/lib/apikeys";

/**
 * Demo route for the public API (guide 08 builds the real surface).
 * Auth pattern EVERY /api/v1 route uses:
 *   try { const ctx = await requireApiKey(req, "<perm>"); ...use ctx.workspaceId... }
 *   catch (e) { if (e instanceof ApiAuthError) return 401/403; throw e; }
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireApiKey(req, "calls:read");
    return NextResponse.json({
      ok: true,
      workspaceId: ctx.workspaceId,
      keyPrefix: ctx.apiKey.keyPrefix,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
