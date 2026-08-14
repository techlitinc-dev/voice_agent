import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function WebhookDeliveriesPage({
  searchParams,
}: {
  searchParams: { subscriptionId?: string; status?: string; event?: string };
}) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  if (!hasPermission(ctx.membership, "webhooks:read")) redirect("/settings");

  const status = searchParams.status ?? "";
  const statusFilter =
    status === "SUCCESS" || status === "FAILED" || status === "PENDING" ? status : undefined;
  const where = {
    workspaceId: ctx.workspaceId,
    ...(searchParams.subscriptionId ? { subscriptionId: searchParams.subscriptionId } : {}),
    ...(statusFilter ? { status: statusFilter as "SUCCESS" | "FAILED" | "PENDING" } : {}),
    ...(searchParams.event ? { event: searchParams.event } : {}),
  };

  const deliveries = await db.webhookDelivery.findMany({
    where,
    include: { subscription: { select: { url: true, events: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const statusBadge = (s: string) =>
    s === "SUCCESS" ? "text-green-400" : s === "FAILED" ? "text-red-400" : "text-orange-400";

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhook deliveries</h1>
          <p className="text-sm text-muted-foreground">
            Every event delivery with its retry state. Click a row for the backoff timeline.
          </p>
        </div>
        <Link href="/settings/webhooks" className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary/50">
          ← Subscriptions
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/settings/webhooks/deliveries" className={!status ? "rounded-md bg-primary px-3 py-1 text-primary-foreground" : "rounded-md border border-border px-3 py-1"}>
          All
        </Link>
        {["PENDING", "SUCCESS", "FAILED"].map((s) => (
          <Link
            key={s}
            href={`/settings/webhooks/deliveries?status=${s}`}
            className={status === s ? "rounded-md bg-primary px-3 py-1 text-primary-foreground" : "rounded-md border border-border px-3 py-1"}
          >
            {s}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Deliveries ({deliveries.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="webhook-deliveries-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Event</th>
                <th className="p-3">Subscription</th>
                <th className="p-3">Status</th>
                <th className="p-3">Attempts</th>
                <th className="p-3">Response</th>
                <th className="p-3">Created</th>
                <th className="p-3">Next retry</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-b last:border-0 align-top hover:bg-muted/40">
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/settings/webhooks/deliveries/${d.id}`} className="hover:underline">
                      {d.event}
                    </Link>
                  </td>
                  <td className="max-w-48 truncate p-3 font-mono text-xs text-muted-foreground" title={d.subscription.url}>
                    {d.subscription.url}
                  </td>
                  <td className={`p-3 ${statusBadge(d.status)}`}>{d.status}</td>
                  <td className="p-3">{d.attempts}</td>
                  <td className="p-3 font-mono text-xs">{d.responseCode ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{d.createdAt.toLocaleString("en-IN")}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {d.nextRetryAt ? d.nextRetryAt.toLocaleString("en-IN") : "—"}
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No deliveries match the current filter.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
