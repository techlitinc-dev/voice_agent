import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { canCreateReport } from "@/lib/reports/access";
import { REPORT_TEMPLATES } from "@/lib/reports/templates";
import { ReportBuilder } from "./builder-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "New report — Vaani AI" };

export default async function NewReportPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  if (!canCreateReport(ctx.membership.role)) redirect("/reports");

  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6" data-testid="report-builder-page">
      <div>
        <h1 className="text-2xl font-bold">Report builder</h1>
        <p className="text-sm text-muted-foreground">Pick a template or start from scratch, then preview and save.</p>
      </div>
      <ReportBuilder templates={REPORT_TEMPLATES} agents={agents} defaultConfig={undefined} />
    </div>
  );
}
