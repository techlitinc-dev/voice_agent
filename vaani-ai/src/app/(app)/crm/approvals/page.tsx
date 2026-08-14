import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { ApprovalRowActions } from "./approval-row-actions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const canApprove = hasPermission(ctx.membership, "deals:approve");

  const [pending, decided, stages] = await Promise.all([
    db.approvalRequest.findMany({
      where: { workspaceId: ctx.workspaceId, status: "PENDING" },
      include: {
        deal: { select: { id: true, title: true, valuePaise: true, stageId: true } },
        requestedBy: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.approvalRequest.findMany({
      where: { workspaceId: ctx.workspaceId, status: { in: ["APPROVED", "REJECTED"] } },
      include: {
        deal: { select: { id: true, title: true, valuePaise: true } },
        requestedBy: { select: { fullName: true, email: true } },
        approvedBy: { select: { fullName: true, email: true } },
      },
      orderBy: { decidedAt: "desc" },
      take: 20,
    }),
    db.stage.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true } }),
  ]);
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Approval requests</h1>
        <p className="text-sm text-muted-foreground">
          High-value deal stage moves that need manager sign-off. Configure the
          threshold and stages in <Link href="/settings/crm" className="underline">CRM settings</Link>.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Pending ({pending.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="approvals-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Deal</th>
                <th className="p-3">Value</th>
                <th className="p-3">Move to</th>
                <th className="p-3">Requested by</th>
                <th className="p-3">When</th>
                {canApprove && <th className="p-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top" data-testid={`approval-row-${r.id}`}>
                  <td className="p-3">
                    <Link href={`/crm/deals/${r.deal.id}`} className="font-medium hover:underline">
                      {r.deal.title}
                    </Link>
                  </td>
                  <td className="p-3">{formatINR(r.valuePaise)}</td>
                  <td className="p-3 text-primary">→ {stageName(r.requestedStageId)}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {r.requestedBy.fullName || r.requestedBy.email}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {r.createdAt.toLocaleString("en-IN")}
                  </td>
                  {canApprove && (
                    <td className="p-3">
                      <ApprovalRowActions requestId={r.id} />
                    </td>
                  )}
                </tr>
              ))}
              {pending.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No pending approvals. 
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Decided (recent)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="approvals-decided-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Deal</th>
                <th className="p-3">Value</th>
                <th className="p-3">Decision</th>
                <th className="p-3">Decided by</th>
                <th className="p-3">When</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="p-3 font-medium">{r.deal.title}</td>
                  <td className="p-3">{formatINR(r.valuePaise)}</td>
                  <td className="p-3">
                    <span className={r.status === "APPROVED" ? "text-green-400" : "text-red-400"}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {r.approvedBy ? (r.approvedBy.fullName || r.approvedBy.email) : "—"}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {r.decidedAt ? r.decidedAt.toLocaleString("en-IN") : "—"}
                  </td>
                </tr>
              ))}
              {decided.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No decisions yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
