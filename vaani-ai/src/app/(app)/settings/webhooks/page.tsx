import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createWebhookSubscription, deleteWebhookSubscription, sendTestWebhook } from "@/server/actions/webhooks";
import { EventBuilder } from "./event-builder";

export const dynamic = "force-dynamic";

async function createSub(formData: FormData) {
  "use server";
  await createWebhookSubscription(formData);
}

async function sendTest(formData: FormData) {
  "use server";
  await sendTestWebhook(String(formData.get("id")));
}

async function deleteSub(formData: FormData) {
  "use server";
  await deleteWebhookSubscription(String(formData.get("id")));
}

export default async function WebhookSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const subs = await db.webhookSubscription.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: {
      deliveries: { orderBy: { createdAt: "desc" }, take: 5, select: { event: true, status: true, responseCode: true, attempts: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Webhook subscriptions</h1>
      <p className="text-sm text-muted-foreground">
        We POST signed JSON to your URL on each event. Verify <code>X-Vaani-Signature</code>{" "}
        (HMAC-SHA256 of the raw body, hex, prefixed <code>sha256=</code>) with your secret.
        Failed deliveries retry 8 times with exponential backoff. See /settings/api-docs.
      </p>

      <Card>
        <CardHeader><CardTitle>New subscription</CardTitle></CardHeader>
        <CardContent>
          <form action={createSub} className="space-y-3" data-testid="webhook-create-form">
            <input name="url" required placeholder="https://yourapp.example/hooks/vaani"
              data-testid="webhook-url-input"
              className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm" />
            <EventBuilder />
            <button data-testid="webhook-create-button"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Create subscription
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Subscriptions ({subs.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="webhook-sub-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">URL</th><th className="p-3">Events</th><th className="p-3">Secret</th>
                <th className="p-3">Recent deliveries</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-b last:border-0 align-top">
                  <td className="max-w-56 truncate p-3 font-mono text-xs">{s.url}</td>
                  <td className="p-3 text-xs">{s.events.join(", ")}</td>
                  <td className="max-w-44 break-all p-3 font-mono text-xs">{s.secret}</td>
                  <td className="p-3 text-xs">
                    {s.deliveries.length === 0 && <span className="text-muted-foreground">none yet</span>}
                    {s.deliveries.map((d, i) => (
                      <p key={i} className={d.status === "SUCCESS" ? "text-green-400" : d.status === "FAILED" ? "text-red-400" : "text-orange-400"}>
                        {d.event} · {d.status} · {d.responseCode ?? "—"} · {d.attempts} tries
                      </p>
                    ))}
                  </td>
                  <td className="space-y-2 p-3">
                    <form action={sendTest}>
                      <input type="hidden" name="id" value={s.id} />
                      <button data-testid={`webhook-test-${s.id}`}
                        className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary/50">
                        Send test event
                      </button>
                    </form>
                    <form action={deleteSub}>
                      <input type="hidden" name="id" value={s.id} />
                      <button data-testid={`webhook-delete-${s.id}`}
                        className="rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No subscriptions. Create one above, then point Zapier/n8n at it (see /settings/integrations).
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
