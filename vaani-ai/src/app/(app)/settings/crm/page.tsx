import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalSettingsForm } from "./approval-settings-form";

export const dynamic = "force-dynamic";

export default async function CrmSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [workspace, stages] = await Promise.all([
    db.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    db.stage.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { name: true },
      orderBy: { order: "asc" },
      distinct: ["name"],
    }),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">CRM settings</h1>
      <p className="text-sm text-muted-foreground">
        Approval workflows (docs/new-features/05 §3.7): deals at or above the
        threshold that move into one of the listed stages require manager approval
        before the transition completes. Stage names are matched against your
        pipeline stages below.
      </p>

      <Card>
        <CardHeader><CardTitle>Deal approval workflow</CardTitle></CardHeader>
        <CardContent>
          <ApprovalSettingsForm
            thresholdPaise={workspace?.approvalThresholdPaise ?? null}
            approvalRequiredStages={workspace?.approvalRequiredStages ?? []}
            stageNames={stages.map((s) => s.name)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
