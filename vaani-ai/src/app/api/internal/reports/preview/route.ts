import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { executeReport } from "@/lib/reports/executor";

/** POST /api/internal/reports/preview — run a ReportConfig and return rows (cookie-authed). */
export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let config: unknown;
  try {
    config = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  try {
    const result = await executeReport(ctx.workspaceId, config as Parameters<typeof executeReport>[1]);
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    console.error("[reports/preview] execute failed", e);
    return NextResponse.json({ ok: false, error: "execution failed" }, { status: 500 });
  }
}
