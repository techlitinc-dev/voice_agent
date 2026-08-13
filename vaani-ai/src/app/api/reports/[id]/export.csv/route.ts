import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { canViewReport } from "@/lib/reports/access";
import { executeReport } from "@/lib/reports/executor";
import { exportToCsv } from "@/lib/reports/export";
import type { ReportConfig } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

/** GET /api/reports/[id]/export.csv — run a saved report and stream CSV. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const report = await db.savedReport.findFirst({ where: { id: params.id, workspaceId: ctx.workspaceId } });
  if (!report) return new Response("not found", { status: 404 });
  if (!canViewReport(ctx.membership.role, report.visibility as "shared" | "private", report.createdByUserId, ctx.user.id)) {
    return new Response("forbidden", { status: 403 });
  }

  const result = await executeReport(ctx.workspaceId, (report.config ?? {}) as unknown as ReportConfig);
  const csv = exportToCsv(result);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(report.name)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "report";
}
