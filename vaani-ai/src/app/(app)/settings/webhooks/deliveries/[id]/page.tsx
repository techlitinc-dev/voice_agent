import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildRetryTimeline } from "@/lib/webhook-delivery-log";
import { nextBackoffMs, WEBHOOK_MAX_ATTEMPTS } from "@/lib/webhook-sign";

export const dynamic = "force-dynamic";

export default async function WebhookDeliveryDetailPage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  if (!hasPermission(ctx.membership, "webhooks:read")) redirect("/settings");

  const delivery = await db.webhookDelivery.findFirst({
    where: { id: params.id },
    include: { subscription: true },
  });
  if (!delivery || delivery.subscription.workspaceId !== ctx.workspaceId) notFound();

  const timeline = buildRetryTimeline({
    createdAt: delivery.createdAt.toISOString(),
    attemptLog: delivery.attemptLog,
    status: delivery.status,
    attempts: delivery.attempts,
    maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    nextBackoffMs,
  });

  const statusBadge =
    delivery.status === "SUCCESS" ? "text-green-400" : delivery.status === "FAILED" ? "text-red-400" : "text-orange-400";
  const payload = delivery.payload as Record<string, unknown>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/settings/webhooks/deliveries" className="text-sm text-muted-foreground hover:text-primary">← Deliveries</Link>
        <h1 className="mt-1 text-2xl font-bold">Delivery {delivery.id.slice(0, 8)}</h1>
        <p className={`text-sm ${statusBadge}`}>{delivery.status} · {delivery.event}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="delivery-details">
            <p className="flex justify-between"><span className="text-muted-foreground">URL</span><span className="max-w-56 truncate font-mono text-xs">{delivery.subscription.url}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Attempts</span><span>{delivery.attempts}/{WEBHOOK_MAX_ATTEMPTS}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Response</span><span className="font-mono text-xs">{delivery.responseCode ?? "—"}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{delivery.createdAt.toLocaleString("en-IN")}</span></p>
            {delivery.nextRetryAt && <p className="flex justify-between"><span className="text-muted-foreground">Next retry</span><span>{delivery.nextRetryAt.toLocaleString("en-IN")}</span></p>}
            {delivery.deliveredAt && <p className="flex justify-between"><span className="text-muted-foreground">Delivered</span><span>{delivery.deliveredAt.toLocaleString("en-IN")}</span></p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Retry backoff timeline</CardTitle></CardHeader>
          <CardContent data-testid="retry-timeline">
            <ol className="space-y-3">
              {timeline.map((step) => (
                <li key={step.attempt} className="flex items-start gap-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                    step.error ? "bg-red-400" : step.responseCode ? "bg-green-400" : "bg-muted-foreground"
                  }`} />
                  <div className="min-w-0">
                    <p className="font-medium">
                      Attempt {step.attempt}
                      {step.error && <span className="ml-2 text-xs text-red-400">failed · {step.error}</span>}
                      {step.responseCode && !step.error && (
                        <span className="ml-2 text-xs text-green-400">delivered · HTTP {step.responseCode}</span>
                      )}
                      {!step.error && !step.responseCode && <span className="ml-2 text-xs text-muted-foreground">scheduled</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {step.at ? new Date(step.at).toLocaleString("en-IN") : "—"}
                      {step.nextDelayMs != null && ` · next in ${formatDelay(step.nextDelayMs)}`}
                      {step.nextDelayMs == null && !step.error && step.responseCode && " · terminal"}
                    </p>
                  </div>
                </li>
              ))}
              {timeline.length === 0 && <li className="text-sm text-muted-foreground">No attempts recorded.</li>}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Payload</CardTitle></CardHeader>
        <CardContent>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs" data-testid="delivery-payload">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function formatDelay(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}
