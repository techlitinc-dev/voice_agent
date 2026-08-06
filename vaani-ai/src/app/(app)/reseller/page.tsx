import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/money";
import { childUsageRollup } from "@/lib/reseller";
import {
  enableResellerAction,
  createChildWorkspaceAction,
  saveRateCardAction,
} from "@/server/actions/reseller";

export const dynamic = "force-dynamic";

export default async function ResellerPage() {
  let ctx;
  try { ctx = await requirePermission("billing:read"); } catch { redirect("/login"); }

  const reseller = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId: ctx.workspaceId },
    include: { children: { select: { id: true, name: true, slug: true, createdAt: true } } },
  });

  async function enable() {
    "use server";
    await enableResellerAction();
  }
  async function createChild(formData: FormData) {
    "use server";
    await createChildWorkspaceAction({ name: String(formData.get("name") ?? "") });
  }
  async function saveRateCard(formData: FormData) {
    "use server";
    await saveRateCardAction({
      telephonyPerMinPaise: Number(formData.get("telephony") || 0),
      sttPerMinPaise: Number(formData.get("stt") || 0),
      llmPerMinPaise: Number(formData.get("llm") || 0),
      ttsPerMinPaise: Number(formData.get("tts") || 0),
    });
  }

  if (!reseller) {
    return (
      <div className="max-w-xl space-y-6">
        <h1 className="text-2xl font-bold">Reseller / Agency panel</h1>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              Resell Vaani AI under your own brand: provision child workspaces, set wholesale
              rates, and track per-customer revenue and margin. Requires the Enterprise plan
              (reseller_panel gate).
            </p>
            <form action={enable}>
              <Button data-testid="reseller-enable-button">Enable reseller panel</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rollup = await childUsageRollup(ctx.workspaceId, since);
  const rc = (reseller.wholesaleRateCard ?? {}) as Record<string, number>;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Reseller / Agency panel</h1>

      <Card>
        <CardHeader><CardTitle>Create child workspace (sub-account)</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="reseller-create-child-form" action={createChild} className="flex gap-2">
            <Input data-testid="reseller-child-name-input" name="name" placeholder="Customer business name" required />
            <Button data-testid="reseller-create-child-submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Wholesale rate card (paise/min — what you pay us)</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="ratecard-editor" action={saveRateCard} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div>
              <label className="text-xs text-muted-foreground">Telephony</label>
              <Input data-testid="ratecard-telephony" name="telephony" type="number" min={0} defaultValue={rc.telephonyPerMinPaise ?? 30} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">STT</label>
              <Input data-testid="ratecard-stt" name="stt" type="number" min={0} defaultValue={rc.sttPerMinPaise ?? 18} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">LLM</label>
              <Input data-testid="ratecard-llm" name="llm" type="number" min={0} defaultValue={rc.llmPerMinPaise ?? 12} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">TTS</label>
              <Input data-testid="ratecard-tts" name="tts" type="number" min={0} defaultValue={rc.ttsPerMinPaise ?? 24} />
            </div>
            <div className="flex items-end">
              <Button data-testid="ratecard-save" className="w-full">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Child workspaces</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="reseller-child-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Name</th><th className="p-3">Slug</th><th className="p-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {reseller.children.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-3">{c.name}</td>
                  <td className="p-3 font-mono text-xs">{c.slug}</td>
                  <td className="p-3 text-muted-foreground">{c.createdAt.toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
              {reseller.children.length === 0 && (
                <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">No child workspaces yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Revenue report (last 30 days, wholesale vs retail)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="reseller-revenue-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Child</th><th className="p-3">Calls</th><th className="p-3">Minutes</th>
                <th className="p-3">Revenue (retail)</th><th className="p-3">Cost (wholesale)</th><th className="p-3">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rollup.map((r) => (
                <tr key={r.workspaceId} className="border-b last:border-0">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.totalCalls}</td>
                  <td className="p-3">{r.totalMinutes}</td>
                  <td className="p-3">{formatINR(r.revenuePaise)}</td>
                  <td className="p-3">{formatINR(r.costPaise)}</td>
                  <td className={`p-3 font-semibold ${r.marginPaise >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatINR(r.marginPaise)}
                  </td>
                </tr>
              ))}
              {rollup.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No child usage yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
