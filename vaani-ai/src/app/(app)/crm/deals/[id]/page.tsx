import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getDealDetail } from "@/lib/crm";
import { formatINR } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StageChangeForm } from "./stage-change-form";
import { AddNoteForm } from "./add-note-form";
import { DeleteDealButton } from "./delete-deal-button";
import { TaskToggle } from "./task-toggle";
import { InterestBadge } from "../../interest-badge";
import { QuickActions } from "@/components/crm/quick-actions";
import { ActivityTimeline, type TimelineActivity } from "@/components/crm/activity-timeline";
import { Clock } from "lucide-react";

export const metadata = { title: "Deal — Vaani AI" };

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const deal = await getDealDetail(ctx.workspaceId, params.id);
  if (!deal) notFound();

  const canWrite = hasPermission(ctx.membership, "deals:write");
  const canDelete = hasPermission(ctx.membership, "deals:delete");

  const attributes = (deal.attributes ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-6" data-testid="deal-detail-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/crm/pipeline" className="text-sm text-muted-foreground hover:text-foreground">← Back to pipeline</Link>
          <h2 className="mt-1 text-xl font-bold">{deal.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StageChangeForm deal={deal} stages={deal.pipeline.stages} canWrite={canWrite} />
            <Badge variant={deal.status === "WON" ? "success" : deal.status === "LOST" ? "danger" : "info"}>{deal.status}</Badge>
            <InterestBadge attributes={deal.attributes} />
            <Badge variant="secondary">{deal.priority}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && <Link href={`/crm/deals/${deal.id}/edit`}><Button variant="outline" size="sm">Edit</Button></Link>}
          {canDelete && <DeleteDealButton dealId={deal.id} title={deal.title} />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: details (2/3) */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Deal details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Value</p>
                <p className="font-semibold">{formatINR(deal.valuePaise)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pipeline</p>
                <p>{deal.pipeline.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Owner</p>
                <p className="flex items-center gap-1.5">{deal.owner ? <><Avatar name={deal.owner.fullName} size="xs" /> {deal.owner.fullName}</> : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expected close</p>
                <p className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDate(deal.expectedClose)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Source</p>
                <p>{deal.source ?? "manual"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Closed</p>
                <p>{deal.closedAt ? formatDate(deal.closedAt) : "—"}</p>
              </div>
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Contact</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {deal.contact ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{deal.contact.name ?? deal.contact.phone}</p>
                    <p className="font-mono text-xs text-muted-foreground">{deal.contact.phone}</p>
                    {deal.contact.attributes && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {Object.entries(deal.contact.attributes as Record<string, unknown>)
                          .slice(0, 4)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <QuickActions phone={deal.contact.phone} dealId={deal.id} canWrite={canWrite} />
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-muted-foreground">No contact linked.</p>
                  <QuickActions dealId={deal.id} canWrite={canWrite} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Attributes */}
          {Object.keys(attributes).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Attributes</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(attributes).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b py-1 last:border-0">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Tasks */}
          {deal.tasks.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Tasks ({deal.tasks.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {deal.tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between">
                    <div>
                      <p>{t.title}</p>
                      <p className="text-xs text-muted-foreground">Due {formatDate(t.dueAt)} · {t.status}</p>
                    </div>
                    <TaskToggle taskId={t.id} status={t.status} canWrite={canWrite} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          <Card id="quick-note">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Notes ({deal.notes.length})</CardTitle>
              <AddNoteForm dealId={deal.id} canWrite={canWrite} />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {deal.notes.map((n) => (
                <div key={n.id} className="rounded-md border p-3">
                  <p>{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {n.user?.fullName ?? "AI"} · {formatDate(n.createdAt)}
                  </p>
                </div>
              ))}
              {deal.notes.length === 0 && <p className="text-muted-foreground">No notes yet.</p>}
            </CardContent>
          </Card>
        </div>

        {/* Right: timeline */}
        <div>
          <Card>
            <CardHeader><CardTitle className="text-sm">Activity timeline</CardTitle></CardHeader>
            <CardContent className="pt-6">
              <ActivityTimeline activities={deal.activities.map((a): TimelineActivity => ({
                id: a.id,
                type: a.type,
                title: a.title,
                description: a.description,
                createdAt: a.createdAt.toISOString(),
                userId: a.userId,
                userName: null,
                callId: a.callId,
              }))} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
