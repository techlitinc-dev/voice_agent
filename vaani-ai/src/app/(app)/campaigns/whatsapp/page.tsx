import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import {
  setTemplateStatusAction,
  createWhatsAppCampaignAction,
  startWhatsAppCampaignAction,
} from "@/server/actions/whatsapp";
import { TemplateCreateForm } from "./template-create-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TPL_STATUS: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  PENDING: "bg-blue-500/10 text-blue-400",
  APPROVED: "bg-green-500/10 text-green-400",
  REJECTED: "bg-red-500/10 text-red-400",
};

export default async function WhatsAppPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const [templates, lists, campaigns] = await Promise.all([
    db.whatsAppTemplate.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" } }),
    db.contactList.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { contacts: true } } } }),
    db.whatsAppCampaign.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { template: { select: { name: true } }, list: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  async function setStatus(formData: FormData) {
    "use server";
    await setTemplateStatusAction(
      String(formData.get("id")),
      String(formData.get("status")) as "PENDING" | "APPROVED" | "REJECTED"
    );
  }
  async function createCampaign(formData: FormData) {
    "use server";
    await createWhatsAppCampaignAction({
      name: String(formData.get("name")),
      templateId: String(formData.get("templateId")),
      listId: String(formData.get("listId")),
    });
  }
  async function startCampaign(formData: FormData) {
    "use server";
    await startWhatsAppCampaignAction(String(formData.get("id")));
  }

  return (
    <div className="space-y-6" data-testid="whatsapp-page">
      <h1 className="text-2xl font-bold">WhatsApp campaigns</h1>
      <p className="text-sm text-muted-foreground">
        Template messages via Vobiz WhatsApp Business (readme §9). Templates need
        Meta/DLT approval — submit in the Vobiz dashboard, then record the status
        here. Only APPROVED templates send. Sends are throttled (5/sec) and honor DNC.
      </p>

      <Card>
        <CardHeader><CardTitle>New template</CardTitle></CardHeader>
        <CardContent>
          <TemplateCreateForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Templates</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="whatsapp-template-list">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Name</th><th className="p-2">Body</th>
                <th className="p-2">DLT id</th><th className="p-2">Status</th><th className="p-2">Record decision</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b last:border-0" data-testid="template-row">
                  <td className="p-2 font-mono">{t.name}</td>
                  <td className="max-w-xs truncate p-2 text-muted-foreground">{t.body}</td>
                  <td className="p-2">{t.dltTemplateId ?? "—"}</td>
                  <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs ${TPL_STATUS[t.status]}`}>{t.status}</span></td>
                  <td className="p-2">
                    <form action={setStatus} className="flex gap-1">
                      <input type="hidden" name="id" value={t.id} />
                      <select name="status" className="h-8 rounded-md border border-border bg-card px-2 text-xs" data-testid="template-status-select">
                        {["PENDING", "APPROVED", "REJECTED"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <Button size="sm" variant="outline" type="submit">Save</Button>
                    </form>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr><td colSpan={5} className="p-2 text-muted-foreground">No templates yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>New WhatsApp campaign</CardTitle></CardHeader>
        <CardContent>
          <form action={createCampaign} className="flex flex-wrap items-center gap-2" data-testid="whatsapp-campaign-form">
            <Input name="name" placeholder="Campaign name" required className="w-56" data-testid="wa-campaign-name-input" />
            <select name="templateId" required className="h-9 rounded-md border border-border bg-card px-3 text-sm" data-testid="wa-template-select">
              {templates.filter((t) => t.status === "APPROVED").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select name="listId" required className="h-9 rounded-md border border-border bg-card px-3 text-sm" data-testid="wa-list-select">
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l._count.contacts})</option>)}
            </select>
            <Button type="submit" data-testid="wa-campaign-create-submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>WhatsApp campaigns</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-md border p-3 text-sm" data-testid="wa-campaign-row">
              <span className="font-semibold">{c.name}</span>
              <span className="text-muted-foreground">{c.template.name} → {c.list?.name ?? "—"}</span>
              <span className="rounded-full border px-2 py-0.5 text-xs">{c.status}</span>
              {c.status === "DRAFT" && (
                <form action={startCampaign} className="ml-auto">
                  <input type="hidden" name="id" value={c.id} />
                  <Button size="sm" data-testid="whatsapp-campaign-start">▶ Start sending</Button>
                </form>
              )}
            </div>
          ))}
          {campaigns.length === 0 && <p className="text-sm text-muted-foreground">No WhatsApp campaigns yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
