import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { changePlanAction } from "@/server/actions/billing";
import { getPlansCached } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [plans, sub, addOns] = await Promise.all([
    getPlansCached(), // 1h cache (scalability doc §3.3)
    db.subscription.findUnique({ where: { workspaceId: ctx.workspaceId }, include: { plan: true } }),
    db.addOnPurchase.findMany({ where: { workspaceId: ctx.workspaceId, active: true } }),
  ]);

  async function change(formData: FormData) {
    "use server";
    await changePlanAction({ planCode: String(formData.get("planCode")) });
  }

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Plans</h1>
      <p className="text-sm text-muted-foreground">
        Switching is immediate. Upgrades charge the new plan&apos;s full month from your wallet now;
        downgrades apply the lower price from the next monthly charge. No proration, no refunds.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const current = sub?.planId === p.id;
          const gates = (
            p.featureGates && typeof p.featureGates === "object" && !Array.isArray(p.featureGates)
              ? p.featureGates
              : {}
          ) as Record<string, unknown>;
          return (
            <Card key={p.id} data-testid={`plan-card-${p.code}`} className={current ? "border-primary" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {p.name}
                  {current && <span data-testid="plan-current-badge" className="text-xs text-primary">CURRENT</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-3xl font-bold">{formatINR(p.monthlyPricePaise)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>{p.includedMinutes} included minutes</li>
                  <li>{p.maxAgents} agents · {p.maxSeats} seats</li>
                  <li>{p.concurrentLines} concurrent lines</li>
                  <li>{p.markupPercent}% usage rate</li>
                  <li>{p.premiumVoices ? "✓" : "✗"} premium voices · {p.whiteLabel ? "✓" : "✗"} white-label · {p.dedicatedInfra ? "✓" : "✗"} dedicated infra</li>
                  {Object.keys(gates).length > 0 && (
                    <li>Gates: {Object.entries(gates).map(([k, v]) => `${k}:${v ? "✓" : "✗"}`).join(" ")}</li>
                  )}
                </ul>
                {!current && (
                  <form action={change}>
                    <input type="hidden" name="planCode" value={p.code} />
                    <Button data-testid={`plan-upgrade-${p.code}`} className="w-full">
                      {sub && p.monthlyPricePaise < sub.plan.monthlyPricePaise ? "Downgrade" : "Upgrade"} to {p.name}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Active add-ons: {addOns.length === 0 ? "none" : addOns.map((a) => a.code).join(", ")} — manage them under Billing → Add-ons.
      </p>
    </div>
  );
}
