import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { ADDON_CATALOG } from "@/lib/addons";
import { purchaseAddOnAction, cancelAddOnAction } from "@/server/actions/billing";

export const dynamic = "force-dynamic";

export default async function AddOnsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const purchases = await db.addOnPurchase.findMany({
    where: { workspaceId: ctx.workspaceId, active: true },
  });
  const active = new Set(purchases.map((p) => p.code));

  async function buy(formData: FormData) {
    "use server";
    await purchaseAddOnAction({ code: String(formData.get("code")) });
  }
  async function cancel(formData: FormData) {
    "use server";
    await cancelAddOnAction({ code: String(formData.get("code")) });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Add-ons</h1>
      <p className="text-sm text-muted-foreground">
        Charged in full for the current month on purchase, then monthly by the billing cron. Cancel anytime — the add-on stays active until the next monthly charge would have run.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {ADDON_CATALOG.map((a) => (
          <Card key={a.code} data-testid={`addon-card-${a.code}`}>
            <CardHeader><CardTitle className="text-base">{a.name}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{a.description}</p>
              <p className="text-2xl font-bold">{formatINR(a.monthlyPricePaise)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              {active.has(a.code) ? (
                <form action={cancel}>
                  <input type="hidden" name="code" value={a.code} />
                  <Button data-testid={`addon-cancel-${a.code}`} variant="outline" className="w-full">Active — cancel</Button>
                </form>
              ) : (
                <form action={buy}>
                  <input type="hidden" name="code" value={a.code} />
                  <Button data-testid={`addon-buy-${a.code}`} className="w-full">Buy add-on</Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
