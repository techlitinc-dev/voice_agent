import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { getContactCrmData } from "@/lib/crm";
import { formatINR } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityTimeline, type TimelineActivity } from "@/components/crm/activity-timeline";
import { Tabs } from "@/components/crm/tabs";
import { LeadScoreBreakdown } from "@/components/crm/lead-score-badge";
import { TaskRow } from "@/app/(app)/crm/tasks/task-row";
import { Phone, PhoneCall } from "lucide-react";

export const metadata = { title: "Contact — Vaani AI" };

export default async function ContactDetailPage({ params }: { params: { phone: string } }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const data = await getContactCrmData(ctx.workspaceId, params.phone);
  if (!data) notFound();
  const { contact, calls } = data;

  const activities: TimelineActivity[] = contact.activities.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    createdAt: a.createdAt.toISOString(),
    userId: a.userId,
    userName: a.user?.fullName ?? null,
    callId: a.callId,
  }));

  return (
    <div className="space-y-6" data-testid="contact-detail-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/contacts" className="text-sm text-muted-foreground hover:text-foreground">← Back to contacts</Link>
          <h2 className="mt-1 text-xl font-bold">{contact.name ?? contact.phone}</h2>
          <p className="font-mono text-sm text-muted-foreground">{contact.phone}</p>
          {contact.attributes && (
            <p className="mt-1 text-xs text-muted-foreground">
              {Object.entries(contact.attributes as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </p>
          )}
        </div>
        <a href={`tel:${contact.phone}`}>
          <Badge variant="outline" className="gap-1 py-1.5"><PhoneCall className="h-3 w-3" /> Call</Badge>
        </a>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: contact summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-sm">Deals ({contact.deals.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {contact.deals.map((d) => (
                <Link key={d.id} href={`/crm/deals/${d.id}`} className="block rounded border p-2 hover:border-primary">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">{formatINR(d.valuePaise)} · {d.stage.name} · {d.status}</p>
                </Link>
              ))}
              {contact.deals.length === 0 && <p className="text-sm text-muted-foreground">No deals.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Open tasks ({contact.tasks.length})</CardTitle></CardHeader>
            <CardContent>
              {contact.tasks.length === 0 && <p className="text-sm text-muted-foreground">No open tasks.</p>}
              {contact.tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </CardContent>
          </Card>

          {contact.leadScore && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Lead score</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <LeadScoreBreakdown
                  score={contact.leadScore.score}
                  grade={contact.leadScore.grade}
                  factors={(contact.leadScore.factors as Record<string, { score: number; max: number }> | null)}
                  reasons={contact.leadScore.reasons}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: tabs */}
        <div className="lg:col-span-2">
          <Tabs
            tabs={[
              { key: "activity", label: "Activity" },
              { key: "calls", label: "Calls" },
              { key: "campaigns", label: "Campaigns" },
            ]}
          >
            {(active) => (
              <>
                {active === "activity" && (
                  <Card>
                    <CardContent className="pt-6">
                      <ActivityTimeline activities={activities} showFilters />
                    </CardContent>
                  </Card>
                )}
                {active === "calls" && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-3">
                        {calls.map((c) => (
                          <div key={c.id} className="flex items-center justify-between rounded border p-3 text-sm">
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{c.direction === "INBOUND" ? "Inbound" : "Outbound"}</span>
                              <span className="text-muted-foreground">{c.status}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {c.durationSec}s · {c.startedAt.toLocaleString("en-IN")}
                              {c.outcome ? ` · ${c.outcome}` : ""}
                            </div>
                          </div>
                        ))}
                        {calls.length === 0 && <p className="text-sm text-muted-foreground">No calls.</p>}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {active === "campaigns" && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        {contact.campaignContacts.map((cc) => (
                          <div key={cc.id} className="rounded border p-3 text-sm">
                            <p className="font-medium">{cc.campaign.name}</p>
                            <p className="text-xs text-muted-foreground">Status: {cc.status} · Attempts: {cc.attempts}</p>
                          </div>
                        ))}
                        {contact.campaignContacts.length === 0 && <p className="text-sm text-muted-foreground">No campaign enrollments.</p>}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
