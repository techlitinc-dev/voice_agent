import { db } from "./db";
import { splitGst } from "./money";
import { putInvoiceHtml } from "./invoice-store";

/**
 * Indian financial year runs April→March. Tag = "<startYY><endYY>", e.g. FY
 * 2025-26 → "2526" (pure, unit-tested).
 */
export function financialYearTag(date: Date): string {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** First day (local) of the financial year containing `date`. */
export function fyStartDate(date: Date): Date {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return new Date(start, 3, 1);
}

/** Sequential per-workspace invoice number: VAANI/<fyTag>/<seq 4dp> (unit-tested). */
export function formatInvoiceNumber(sequence: number, date: Date): string {
  return `VAANI/${financialYearTag(date)}/${String(sequence).padStart(4, "0")}`;
}

/** Next sequence = count of this workspace's invoices this FY + 1 (no schema field
 *  needed — the number is derived, never stored). */
export async function nextInvoiceSequence(workspaceId: string, date: Date): Promise<number> {
  const count = await db.invoice.count({
    where: { workspaceId, createdAt: { gte: fyStartDate(date) } },
  });
  return count + 1;
}

/** Derive an existing invoice's number: its ordinal within its FY (by createdAt). */
export async function invoiceNumberFor(workspaceId: string, invoiceId: string, date: Date): Promise<string> {
  const seq = await db.invoice.count({
    where: {
      workspaceId,
      createdAt: { gte: fyStartDate(date), lte: date },
    },
  });
  return formatInvoiceNumber(seq, date);
}

/**
 * GST on GST-inclusive retail totals (pure, unit-tested): back out the taxable
 * base (total × 100/118 at 18%), then splitGst — IGST for inter-state supply,
 * CGST+SGST otherwise. base + totalGst always equals `totalPaise` up to ±1 paise.
 */
export function gstInclusiveSplit(
  totalPaise: number,
  interState: boolean,
  ratePercent = 18
): { basePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalGstPaise: number } {
  const basePaise = Math.round((totalPaise * 100) / (100 + ratePercent));
  return { basePaise, ...splitGst(basePaise, interState, ratePercent) };
}

/**
 * Place-of-supply → inter-state decision (pure, unit-tested).
 * placeOfSupply format: "Karnataka (29)". B2C with no place recorded → intra-state
 * (documented simplification).
 */
export function isInterState(
  placeOfSupply: string | null | undefined,
  companyStateCode: string
): boolean {
  if (!placeOfSupply) return false;
  const m = placeOfSupply.match(/\((\d{2})\)/);
  return m ? m[1] !== companyStateCode : false;
}

const BILLABLE_TYPES = ["CALL_DEBIT", "NUMBER_RENT", "ADDON_DEBIT", "PLAN_FEE"] as const;

export function renderInvoiceHtml(args: {
  invoiceNumber: string;
  date: Date;
  companyName: string;
  companyGstin: string;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string | null;
  hsnSac: string;
  lines: { label: string; amountPaise: number }[];
  basePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}): string {
  const inr = (p: number) => `₹${(p / 100).toFixed(2)}`;
  const rows = args.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 12px;border:1px solid #ccc">${l.label}</td>` +
        `<td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(l.amountPaise)}</td></tr>`
    )
    .join("");
  const gstRow =
    args.igstPaise > 0
      ? `<tr><td style="padding:6px 12px;border:1px solid #ccc">IGST @18%</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.igstPaise)}</td></tr>`
      : `<tr><td style="padding:6px 12px;border:1px solid #ccc">CGST @9%</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.cgstPaise)}</td></tr>` +
        `<tr><td style="padding:6px 12px;border:1px solid #ccc">SGST @9%</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.sgstPaise)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tax Invoice ${args.invoiceNumber}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;color:#111">
<h1 style="margin-bottom:0">Tax Invoice</h1>
<p style="color:#555">${args.invoiceNumber} · ${args.date.toLocaleDateString("en-IN")}</p>
<table style="width:100%;margin:16px 0"><tr>
<td><strong>From</strong><br>${args.companyName}<br>GSTIN: ${args.companyGstin}</td>
<td><strong>Billed to</strong><br>${args.customerName}<br>${args.customerGstin ? `GSTIN: ${args.customerGstin}<br>` : ""}Place of supply: ${args.placeOfSupply ?? "—"}</td>
</tr></table>
<p>HSN/SAC: ${args.hsnSac}</p>
<table style="width:100%;border-collapse:collapse">
<tr><th style="padding:6px 12px;border:1px solid #ccc;text-align:left">Description</th><th style="padding:6px 12px;border:1px solid #ccc;text-align:right">Amount</th></tr>
${rows}
<tr><td style="padding:6px 12px;border:1px solid #ccc"><strong>Taxable value</strong></td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.basePaise)}</td></tr>
${gstRow}
<tr><td style="padding:6px 12px;border:1px solid #ccc"><strong>Total (GST-inclusive)</strong></td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right"><strong>${inr(args.totalPaise)}</strong></td></tr>
</table>
<p style="color:#555;font-size:12px;margin-top:24px">Generated by Vaani AI. This is a computer-generated invoice.</p>
</body></html>`;
}

/**
 * Generate the monthly GST invoice for a workspace from its wallet debits
 * (calls + rentals + add-ons + plan fee) in the given month. Stores the HTML in
 * MinIO and the key in Invoice.pdfKey. Returns null when there is nothing to bill.
 */
export async function generateMonthlyInvoice(
  workspaceId: string,
  month: Date
): Promise<{ invoiceId: string; invoiceNumber: string; totalPaise: number } | null> {
  const periodStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const periodEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const wallet = await db.wallet.findUnique({ where: { workspaceId } });
  if (!wallet) return null;

  const txns = await db.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      createdAt: { gte: periodStart, lt: periodEnd },
      type: { in: [...BILLABLE_TYPES] },
    },
  });
  const byType = new Map<string, number>();
  for (const t of txns) {
    byType.set(t.type, (byType.get(t.type) ?? 0) + Math.abs(t.amountPaise));
  }
  const total = [...byType.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  const interState = isInterState(
    ws?.billingPlaceOfSupply,
    process.env.BILLING_COMPANY_STATE_CODE ?? "29"
  );
  const gst = gstInclusiveSplit(total, interState);
  const seq = await nextInvoiceSequence(workspaceId, periodStart);
  const invoiceNumber = formatInvoiceNumber(seq, periodStart);

  const labels: Record<string, string> = {
    CALL_DEBIT: "AI call usage",
    NUMBER_RENT: "Phone number rental",
    ADDON_DEBIT: "Add-ons",
    PLAN_FEE: "Subscription plan fee",
  };
  const lines = [...byType.entries()].map(([type, amountPaise]) => ({
    label: labels[type] ?? type,
    amountPaise,
  }));

  const invoice = await db.invoice.create({
    data: {
      workspaceId,
      amountPaise: gst.basePaise,
      gstPaise: gst.totalGstPaise,
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      gstin: ws?.billingGstin,
      placeOfSupply: ws?.billingPlaceOfSupply,
      hsnSac: ws?.billingHsnSac ?? "998314",
      status: "paid", // already collected via wallet debits
    },
  });

  const html = renderInvoiceHtml({
    invoiceNumber,
    date: periodEnd,
    companyName: process.env.BILLING_COMPANY_NAME ?? "Vaani AI",
    companyGstin: process.env.BILLING_COMPANY_GSTIN ?? "—",
    customerName: ws?.name ?? "Customer",
    customerGstin: ws?.billingGstin ?? null,
    placeOfSupply: ws?.billingPlaceOfSupply ?? null,
    hsnSac: ws?.billingHsnSac ?? "998314",
    lines,
    basePaise: gst.basePaise,
    cgstPaise: gst.cgstPaise,
    sgstPaise: gst.sgstPaise,
    igstPaise: gst.igstPaise,
    totalPaise: total,
  });
  const key = `invoices/${workspaceId}/${invoice.id}.html`;
  await putInvoiceHtml(key, html);
  await db.invoice.update({ where: { id: invoice.id }, data: { pdfKey: key } });

  return { invoiceId: invoice.id, invoiceNumber, totalPaise: total };
}
