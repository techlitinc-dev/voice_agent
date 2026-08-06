import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CAMPAIGN_PRESETS } from "@/lib/campaign/presets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  SCHEDULED: "bg-blue-500/10 text-blue-400",
  RUNNING: "bg-green-500/10 text-green-400 animate-pulse",
  PAUSED: "bg-orange-500/10 text-orange-400",
  COMPLETED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-red-500/10 text-red-400",
};

export const metadata = { title: "Campaigns — Vaani AI" };
export default async function CampaignsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const campaigns = await db.campaign.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: {
      agent: { select: { name: true } },
      list: { select: { name: true } },
      pool: { select: { name: true } },
      _count: { select: { contacts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6" data-testid="campaign-list">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild data-testid="pools-link"><Link href="/campaigns/pools">Number pools</Link></Button>
          <Button variant="outline" asChild data-testid="whatsapp-link"><Link href="/campaigns/whatsapp">WhatsApp</Link></Button>
          <Button asChild data-testid="new-campaign-button"><Link href="/campaigns/new">New campaign</Link></Button>
        </div>
      </div>
      {campaigns.length === 0 && (
        <p className="text-muted-foreground">No campaigns yet. Upload contacts, publish an agent, then launch.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {campaigns.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} data-testid="campaign-card">
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`} data-testid="campaign-status-pill">{c.status}</span>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>{CAMPAIGN_PRESETS[c.type]?.label ?? c.type}{c.predictiveDialing ? " · predictive" : ""}</p>
                <p>Agent: {c.agent.name} · List: {c.list.name}{c.pool ? ` · Pool: ${c.pool.name}` : ""}</p>
                <p>{c._count.contacts} contacts · {c.callsPerMinute}/min · {c.concurrency} concurrent</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
