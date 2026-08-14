import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { evaluateSegment, parseSegmentRules } from "@/lib/crm";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Users } from "lucide-react";
import { DeleteSegmentButton } from "./delete-segment-button";
import { CreateCampaignButton } from "./create-campaign-button";

export const metadata = { title: "Segment — Vaani AI" };

export default async function SegmentDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { createCampaign?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const segment = await db.segment.findFirst({ where: { id: params.id, workspaceId: ctx.workspaceId } });
  if (!segment) notFound();

  const members = await evaluateSegment(ctx.workspaceId, segment);
  const rules = parseSegmentRules(segment.rules);

  return (
    <div className="space-y-6" data-testid="segment-detail-page">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{segment.name}</h2>
          {segment.description && <p className="text-sm text-muted-foreground">{segment.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {segment.matchMode === "all" ? "Match ALL" : "Match ANY"} · {members.length} matching contacts
            {segment.lastEvalAt ? ` · last evaluated ${segment.lastEvalAt.toLocaleString("en-IN")}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {searchParams.createCampaign === "1" && <CreateCampaignButton segmentId={segment.id} memberCount={members.length} />}
          <DeleteSegmentButton segmentId={segment.id} />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <p className="mb-2 text-sm font-medium">Conditions</p>
        <div className="flex flex-wrap gap-2">
          {rules.conditions.map((r, i) => (
            <Badge key={i} variant="secondary">
              {r.field} {r.op} {String(r.value)}
            </Badge>
          ))}
          {rules.conditions.length === 0 && <span className="text-sm text-muted-foreground">No conditions.</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">Name</th>
              <th className="p-3">Phone</th>
              <th className="p-3">City</th>
              <th className="p-3">Lead score</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const attrs = (m.attributes ?? {}) as Record<string, unknown>;
              return (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{m.name ?? "—"}</td>
                  <td className="p-3 font-mono">{m.phone}</td>
                  <td className="p-3">{String(attrs.city ?? "—")}</td>
                  <td className="p-3">{m.leadScore ? <Badge variant="info">{m.leadScore.grade} ({m.leadScore.score})</Badge> : "—"}</td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="p-0">
                  <EmptyState
                    icon={Users}
                    title="No contacts match this segment yet"
                    description="Adjust the segment rules, or add contacts with matching attributes."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
