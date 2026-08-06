import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/money";
import { financialYearTag } from "@/lib/invoice";
import { trialMinutesRemaining } from "@/lib/trial";
import { generateInvoiceNowAction, saveLowBalanceThresholdAction } from "@/server/actions/billing";
import { TopupButtons } from "./topup";

export const dynamic = "force-dynamic";

export const metadata = { title: "Billing — Vaani AI" };
export default async function BillingPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [wallet, subscription, transactions, invoices, rentals, trial, addOns] = await Promise.all([
    db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.subscription.findUnique({ where: { workspaceId: ctx.workspaceId }, include: { plan: true } }),
    db.walletTransaction.findMany({
      where: { wallet: { workspaceId: ctx.workspaceId } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.invoice.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.numberRental.findMany({
      where: { workspaceId: ctx.workspaceId, status: "ACTIVE" },
      include: { phoneNumber: { select: { number: true, label: true } } },
    }),
    db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.addOnPurchase.findMany({ where: { workspaceId: ctx.workspaceId, active: true } }),
  ]);

  const balance = wallet?.balancePaise ?? 0;
  const lowThreshold = wallet?.lowBalanceAlertPaise ?? 50000;
  const trialRemaining = trial ? trialMinutesRemaining(trial, new Date()) : 0;

  async function generateInvoice() {
    "use server";
    await generateInvoiceNowAction();
  }

  async function saveThreshold(formData: FormData) {
    "use server";
    const rupees = Number(formData.get("threshold") ?? 0);
    await saveLowBalanceThresholdAction({ lowBalanceAlertPaise: Math.round(rupees * 100) });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>

      {trial && trialRemaining > 0 && (
        <div data-testid="trial-banner" className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          Free trial: <strong>{trialRemaining} minute{trialRemaining === 1 ? "" : "s"}</strong> remaining
          {trial.expiresAt ? ` · expires ${trial.expiresAt.toLocaleDateString("en-IN")}` : ""}.
          Top up below to keep calling after the trial.
        </div>
      )}
      {balance < lowThreshold && (
        <div data-testid="low-balance-banner" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          Your wallet balance is below the alert threshold ({formatINR(lowThreshold)}). Top up now to avoid interruption.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Wallet balance</CardTitle></CardHeader>
          <CardContent>
            <p data-testid="wallet-balance" className="text-4xl font-bold text-primary">{formatINR(balance)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Low-balance alert at {formatINR(lowThreshold)}</p>
            <form data-testid="threshold-form" action={saveThreshold} className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Alert when balance falls below (₹)</label>
                <Input data-testid="threshold-input" name="threshold" type="number" min={0} defaultValue={Math.round(lowThreshold / 100)} />
              </div>
              <Button data-testid="threshold-save" variant="outline" size="sm">Save</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Plan</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{subscription?.plan.name ?? "—"}</p>
            <p className="text-sm text-muted-foreground">
              {subscription ? `${formatINR(subscription.plan.monthlyPricePaise)}/mo · ` : ""}
              {subscription?.plan.includedMinutes ?? 0} included min · {subscription?.plan.concurrentLines ?? 1} lines ·{" "}
              {subscription?.plan.markupPercent ?? 40}% usage rate
            </p>
            <div className="mt-3 flex gap-2">
              <Link href="/billing/plans"><Button data-testid="plans-link" variant="outline" size="sm">View plans</Button></Link>
              <Link href="/billing/addons"><Button data-testid="addons-link" variant="outline" size="sm">Add-ons ({addOns.length})</Button></Link>
              <Link href="/billing/settings"><Button data-testid="billing-settings-link" variant="outline" size="sm">Settings</Button></Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top up wallet</CardTitle></CardHeader>
        <CardContent>
          <TopupButtons />
          <p className="mt-2 text-xs text-muted-foreground">
            TEST mode only — Razorpay card 4111 1111 1111 1111 (any future expiry/CVV); Stripe card 4242 4242 4242 4242.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transactions (latest 50)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="transaction-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">When</th><th className="p-3">Type</th>
                <th className="p-3">Amount</th><th className="p-3">Balance after</th><th className="p-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">
                    {t.createdAt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="p-3">{t.type}</td>
                  <td className={`p-3 font-semibold ${t.amountPaise >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.amountPaise >= 0 ? "+" : ""}{formatINR(t.amountPaise)}
                  </td>
                  <td className="p-3">{formatINR(t.balanceAfterPaise)}</td>
                  <td className="max-w-64 truncate p-3 text-muted-foreground">{t.note ?? t.reference ?? "—"}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No transactions yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Number rentals (monthly)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="rental-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Number</th><th className="p-3">Label</th><th className="p-3">Monthly rent</th><th className="p-3">Since</th>
              </tr>
            </thead>
            <tbody>
              {rentals.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3 font-mono">{r.phoneNumber.number}</td>
                  <td className="p-3 text-muted-foreground">{r.phoneNumber.label ?? "—"}</td>
                  <td className="p-3">{formatINR(r.monthlyPricePaise)}</td>
                  <td className="p-3 text-muted-foreground">{r.startedAt.toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
              {rentals.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No rented numbers.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoices</CardTitle>
            <form action={generateInvoice}>
              <Button data-testid="invoice-generate-button" size="sm" variant="outline">Generate this month&apos;s invoice</Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="invoice-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">When</th><th className="p-3">Taxable</th><th className="p-3">GST</th>
                <th className="p-3">Total</th><th className="p-3">HSN/SAC</th><th className="p-3">Status</th><th className="p-3">View</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="p-3 text-muted-foreground">{i.createdAt.toLocaleDateString("en-IN")}</td>
                  <td className="p-3">{formatINR(i.amountPaise)}</td>
                  <td className="p-3">{formatINR(i.gstPaise)}</td>
                  <td className="p-3 font-semibold">{formatINR(i.amountPaise + i.gstPaise)}</td>
                  <td className="p-3 font-mono text-xs">{i.hsnSac ?? "998314"}</td>
                  <td className={`p-3 ${i.status === "paid" ? "text-green-400" : i.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
                    {i.status}
                  </td>
                  <td className="p-3">
                    <Link data-testid={`invoice-download-${i.id}`} href={`/billing/invoices/${i.id}`} className="text-primary underline">
                      View / PDF
                    </Link>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No invoices yet.</td></tr>
              )}
            </tbody>
          </table>
          <p className="p-3 text-xs text-muted-foreground">
            Invoice numbers run per financial year: VAANI/{financialYearTag(new Date())}/NNNN.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
