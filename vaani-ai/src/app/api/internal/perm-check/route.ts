import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { isPermissionKey } from "@/lib/permissions";

/**
 * Test-only endpoint used by guide 03's scripted negative tests (and later by guide
 * 11's E2E suite) to prove permission enforcement with a real session cookie.
 *   GET /api/internal/perm-check?perm=users:write
 *   200 { ok: true, role } | 401 UNAUTHENTICATED/NO_WORKSPACE | 403 FORBIDDEN
 */
export async function GET(req: NextRequest) {
  const perm = req.nextUrl.searchParams.get("perm") ?? "users:write";
  if (!isPermissionKey(perm)) {
    return NextResponse.json({ ok: false, error: "unknown_permission" }, { status: 400 });
  }
  try {
    const ctx = await requirePermission(perm);
    return NextResponse.json({ ok: true, workspaceId: ctx.workspaceId, role: ctx.membership.role });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHENTICATED" || msg === "NO_WORKSPACE") {
      return NextResponse.json({ ok: false, error: msg }, { status: 401 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    throw e;
  }
}
