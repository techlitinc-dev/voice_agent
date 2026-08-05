import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import {
  startCampaignAction,
  pauseCampaignAction,
  cancelCampaignAction,
  updateCampaignScriptAction,
} from "@/server/actions/campaigns";
import { CAMPAIGN_PRESETS } from "@/lib/campaign/presets";
import { CsvUploader } from "../../contacts/csv-uploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic"; // always fresh status

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: {
      agent: { select: { name: true } },
      list: { select: { name: true } },
      pool: { select: { name: true } },
    },
  });
  if (!campaign) notFound();

  const stats = await db.campaignContact.groupBy({
    by: ["status"],
    where: { campaignId: campaign.id },
    _count: true,
  });
  const count = (s: string) => stats.find((x) => x.status === s)?._count ?? 0;
  const total = stats.reduce((a, x) => a + x._count, 0);
  const done = count("COMPLETED") + count("FAILED") + count("SKIPPED_DNC");
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  const recent = await db.campaignContact.findMany({
    where: { campaignId: campaign.id },
    include: { contact: { select: { phone: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  const editable = ["DRAFT", "RUNNING", "PAUSED"].includes(campaign.status);

  async function start() { "use server"; await startCampaignAction(campaign!.id); }
  async function pause() { "use server"; await pauseCampaignAction(campaign!.id); }
  async function cancel() { "use server"; await cancelCampaignAction(campaign!.id); }
  async function saveScript(formData: FormData) {
    "use server";
    await updateCampaignScriptAction({
      campaignId: campaign!.id,
      openingHook: String(formData.get("openingHook") ?? ""),
      objectionPlaybook: String(formData.get("objectionPlaybook") ?? ""),
    });
  }

  return (
    <div className="space-y-6" data-testid="campaign-detail">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">{campaign.name}</h1>
        <span className="rounded-full border px-3 py-1 text-sm" data-testid="campaign-status-pill">{campaign.status}</span>
        <span className="text-sm text-muted-foreground">{CAMPAIGN_PRESETS[campaign.type]?.label ?? campaign.type}</span>
        <div className="ml-auto flex gap-2">
          {["DRAFT", "PAUSED"].includes(campaign.status) && (
            <form action={start}><Button data-testid="resume-button">▶ Start</Button></form>
          )}
          {campaign.status === "RUNNING" && (
            <form action={pause}><Button variant="outline" data-testid="pause-button">⏸ Pause</Button></form>
          )}
          {editable && (
            <form action={cancel}><Button variant="destructive" data-testid="cancel-button">Cancel</Button></form>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex justify-between text-sm text-muted-foreground">
            <span>
              Agent: {campaign.agent.name} · List: {campaign.list.name}
              {campaign.pool ? ` · Pool: ${campaign.pool.name}` : ""} · {campaign.callsPerMinute}/min ·{" "}
              {campaign.concurrency} concurrent · window {campaign.callingWindowStart}–{campaign.callingWindowEnd}
              {campaign.predictiveDialing ? " · predictive" : ""}
            </span>
            <span data-testid="progress-percent">{progress}%</span>
          </div>
          <div className="h-2 w-full rounded bg-muted" data-testid="progress-bar">
            <div className="h-2 rounded bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6" data-testid="stats-grid">
            <div><p className="text-lg font-bold">{total}</p><p className="text-muted-foreground">total</p></div>
            <div><p className="text-lg font-bold text-yellow-400">{count("PENDING")}</p><p className="text-muted-foreground">pending</p></div>
            <div><p className="text-lg font-bold text-blue-400">{count("DIALING")}</p><p className="text-muted-foreground">dialing</p></div>
            <div><p className="text-lg font-bold text-green-400">{count("COMPLETED")}</p><p className="text-muted-foreground">completed</p></div>
            <div><p className="text-lg font-bold text-orange-400">{count("RETRY_SCHEDULED")}</p><p className="text-muted-foreground">retry</p></div>
            <div><p className="text-lg font-bold text-red-400">{count("FAILED") + count("SKIPPED_DNC")}</p><p className="text-muted-foreground">failed/dnc</p></div>
          </div>
        </CardContent>
      </Card>

      {editable && (
        <Card data-testid="edit-script-card">
          <CardHeader><CardTitle>Script (editable mid-flight — next dial batch picks it up)</CardTitle></CardHeader>
          <CardContent>
            <form action={saveScript} className="space-y-3" data-testid="edit-script-form">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Opening hook</span>
                <textarea name="openingHook" rows={3} defaultValue={campaign.openingHook ?? ""} className="w-full rounded-md border border-border bg-card p-2 text-sm" data-testid="edit-opening-hook" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Objection playbook</span>
                <textarea name="objectionPlaybook" rows={4} defaultValue={campaign.objectionPlaybook ?? ""} className="w-full rounded-md border border-border bg-card p-2 text-sm" data-testid="edit-objection-playbook" />
              </label>
              <Button type="submit" data-testid="edit-script-submit">Save script</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {editable && (
        <section data-testid="add-contacts-section">
          <h2 className="mb-2 text-lg font-semibold">Add contacts to this campaign</h2>
          <CsvUploader campaignId={campaign.id} />
        </section>
      )}

      <Card>
        <CardHeader><CardTitle>Recent activity (refresh page to update)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="live-status-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Phone</th><th className="p-2">Name</th>
                <th className="p-2">Status</th><th className="p-2">Attempts</th><th className="p-2">Last result</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b last:border-0" data-testid="live-status-row">
                  <td className="p-2 font-mono">{r.contact.phone}</td>
                  <td className="p-2">{r.contact.name ?? "—"}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.attempts}</td>
                  <td className="p-2 text-muted-foreground">{r.lastResult ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
