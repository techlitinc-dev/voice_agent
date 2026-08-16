import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { canCreateReport, canViewReport } from "@/lib/reports/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteReport } from "@/server/actions/reports";
import { Plus, FileBarChart } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports — Vaani AI" };

async function deleteReportAction(formData: FormData) {
  "use server";
  await deleteReport(String(formData.get("id")));
}

export default async function ReportsPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const canCreate = canCreateReport(ctx.membership.role);
  const reports = await db.savedReport.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { createdBy: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
  });
  const visible = reports.filter((r) => canViewReport(ctx.membership.role, r.visibility as "shared" | "private", r.createdByUserId, ctx.user.id));

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Custom reports</h1>
          <p className="text-sm text-muted-foreground">
            Build, save, schedule, and share reports. {canCreate ? "You can create and schedule reports." : "MANAGER/AGENT can view shared reports."}
          </p>
        </div>
        {canCreate && (
          <Link href="/reports/new">
            <Button data-testid="new-report-button"><Plus className="h-4 w-4" /> New report</Button>
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <FileBarChart className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No reports yet. {canCreate ? "Create one from a template or from scratch." : "Reports shared with your workspace will appear here."}
              </p>
              {canCreate && (
                <Link href="/reports/new">
                  <Button size="sm" data-testid="empty-new-report">Create your first report</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          visible.map((r) => {
            const raw = (r.config ?? {}) as { source?: string; metrics?: string[]; groupBy?: string | string[]; chart?: { type?: string } };
            const config = { ...raw, groupBy: Array.isArray(raw.groupBy) ? raw.groupBy : raw.groupBy ? [raw.groupBy] : undefined };
            return (
              <Card key={r.id} data-testid={`report-card-${r.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{r.name}</CardTitle>
                    <Badge variant={r.visibility === "private" ? "secondary" : "info"}>{r.visibility}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {config.source ?? r.reportType} · {config.groupBy?.length ? `by ${config.groupBy.join(", ")}` : "flat"} · {config.chart?.type ?? "table"} chart
                  </p>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    by {r.createdBy?.fullName ?? "—"} · {r.createdAt.toLocaleDateString("en-IN")}
                  </p>
                  <div className="flex gap-2">
                    <Link href={`/reports/${r.id}/run`}>
                      <Button variant="outline" size="sm" data-testid={`run-report-${r.id}`}>Run</Button>
                    </Link>
                    <Link href={`/api/reports/${r.id}/export.csv`}>
                      <Button variant="outline" size="sm" data-testid={`export-report-${r.id}`}>CSV</Button>
                    </Link>
                    {(canCreate || r.createdByUserId === ctx.user.id) && (
                      <form action={deleteReportAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-500/10" data-testid={`delete-report-${r.id}`}>
                          Delete
                        </Button>
                      </form>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
