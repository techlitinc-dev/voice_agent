import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  saveGstSettingsAction,
  saveAutoTopUpAction,
  saveLowBalanceThresholdAction,
} from "@/server/actions/billing";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [ws, wallet, autoTopUp] = await Promise.all([
    db.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.autoTopUp.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  async function saveGst(formData: FormData) {
    "use server";
    await saveGstSettingsAction({
      gstin: String(formData.get("gstin") ?? ""),
      placeOfSupply: String(formData.get("placeOfSupply") ?? ""),
      hsnSac: String(formData.get("hsnSac") ?? ""),
    });
  }
  async function saveThreshold(formData: FormData) {
    "use server";
    await saveLowBalanceThresholdAction({ lowBalanceAlertPaise: Number(formData.get("threshold") ?? 0) * 100 });
  }
  async function saveAutoTopUp(formData: FormData) {
    "use server";
    await saveAutoTopUpAction({
      thresholdPaise: Number(formData.get("threshold") ?? 0) * 100,
      amountPaise: Number(formData.get("amount") ?? 0) * 100,
      active: formData.get("active") === "on",
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Billing settings</h1>

      <Card>
        <CardHeader><CardTitle>GST details (printed on invoices)</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="gst-settings-form" action={saveGst} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">GSTIN (B2B customers; leave blank for B2C)</label>
              <Input data-testid="gstin-input" name="gstin" defaultValue={ws?.billingGstin ?? ""} placeholder="29AAAAA0000A1Z5" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Place of supply — &quot;State (code)&quot;</label>
              <Input data-testid="place-of-supply-input" name="placeOfSupply" defaultValue={ws?.billingPlaceOfSupply ?? ""} placeholder="Karnataka (29)" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">HSN/SAC</label>
              <Input data-testid="hsn-sac-input" name="hsnSac" defaultValue={ws?.billingHsnSac ?? "998314"} placeholder="998314" />
            </div>
            <Button data-testid="gst-settings-save">Save GST details</Button>
            <p className="text-xs text-muted-foreground">
              A state code different from the company state ({process.env.BILLING_COMPANY_STATE_CODE ?? "29"}) makes invoices IGST; same state → CGST+SGST.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Low-balance alert</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="threshold-form" action={saveThreshold} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Alert when balance falls below (₹)</label>
              <Input data-testid="threshold-input" name="threshold" type="number" min={0} defaultValue={Math.round((wallet?.lowBalanceAlertPaise ?? 50000) / 100)} />
            </div>
            <Button data-testid="threshold-save" variant="outline">Save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Auto top-up</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="autotopup-form" action={saveAutoTopUp} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Trigger when balance below (₹, min 100)</label>
              <Input data-testid="autotopup-threshold-input" name="threshold" type="number" min={100} defaultValue={Math.round((autoTopUp?.thresholdPaise ?? 50000) / 100)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Top-up amount (₹, min 500)</label>
              <Input data-testid="autotopup-amount-input" name="amount" type="number" min={500} defaultValue={Math.round((autoTopUp?.amountPaise ?? 100000) / 100)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input data-testid="autotopup-toggle" type="checkbox" name="active" defaultChecked={autoTopUp?.active ?? false} className="h-4 w-4" />
              Enable auto top-up
            </label>
            <Button data-testid="autotopup-save">Save auto top-up</Button>
            <p className="text-xs text-muted-foreground">
              Charging a saved card runs in dry-run mode until Razorpay tokenization is enabled on the account (operator task) and AUTOTOPUP_ENABLED=true.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
