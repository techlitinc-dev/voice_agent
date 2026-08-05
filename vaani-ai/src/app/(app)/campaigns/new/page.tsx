import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CAMPAIGN_PRESETS } from "@/lib/campaign/presets";
import { NewCampaignForm } from "./new-campaign-form";

export default async function NewCampaignPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const [agents, lists, pools, waTemplates] = await Promise.all([
    db.agent.findMany({ where: { workspaceId: ctx.workspaceId, status: "PUBLISHED" }, select: { id: true, name: true } }),
    db.contactList.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { contacts: true } } } }),
    db.numberPool.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { numbers: true } } } }),
    db.whatsAppTemplate.findMany({ where: { workspaceId: ctx.workspaceId, status: "APPROVED" }, select: { id: true, name: true } }),
  ]);

  // Serialize presets for the client component (plain JSON only).
  const presets = Object.values(CAMPAIGN_PRESETS).map((p) => ({
    type: p.type,
    label: p.label,
    description: p.description,
    retryPolicy: p.retryPolicy,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    days: p.days,
    openingHook: p.openingHook,
    objectionPlaybook: p.objectionPlaybook,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="new-campaign-page">
      <h1 className="text-2xl font-bold">New campaign</h1>
      {agents.length === 0 && (
        <p className="text-yellow-400">You need a PUBLISHED agent first (Agents → Publish).</p>
      )}
      <NewCampaignForm
        agents={agents}
        lists={lists.map((l) => ({ id: l.id, name: l.name, count: l._count.contacts }))}
        pools={pools.map((p) => ({ id: p.id, name: p.name, count: p._count.numbers }))}
        waTemplates={waTemplates}
        presets={presets}
      />
    </div>
  );
}
