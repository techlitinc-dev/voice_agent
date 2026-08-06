import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { PrintButton } from "./print";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  // Tenant scoping: an invoice id from another workspace must 404, never leak.
  const invoice = await db.invoice.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
  });
  if (!invoice) notFound();
  const ws = await db.workspace.findUnique({ where: { id: ctx.workspaceId } });

  const total = invoice.amountPaise + invoice.gstPaise;
  const igst = invoice.igstPaise > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-lg bg-white p-8 text-black print:p-0">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tax Invoice</h1>
          <p className="text-sm text-gray-600">
            {invoice.createdAt.toLocaleDateString("en-IN")} · HSN/SAC {invoice.hsnSac ?? "998314"}
          </p>
        </div>
        <PrintButton />
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-semibold">From</p>
          <p>{process.env.BILLING_COMPANY_NAME ?? "Vaani AI"}</p>
          <p>GSTIN: {process.env.BILLING_COMPANY_GSTIN ?? "—"}</p>
        </div>
        <div>
          <p className="font-semibold">Billed to</p>
          <p>{ws?.name}</p>
          {invoice.gstin && <p>GSTIN: {invoice.gstin}</p>}
          <p>Place of supply: {invoice.placeOfSupply ?? "—"}</p>
        </div>
      </div>
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr className="border"><td className="p-2">Taxable value</td><td className="p-2 text-right">{formatINR(invoice.amountPaise)}</td></tr>
          {igst ? (
            <tr className="border"><td className="p-2">IGST @18%</td><td className="p-2 text-right">{formatINR(invoice.igstPaise)}</td></tr>
          ) : (
            <>
              <tr className="border"><td className="p-2">CGST @9%</td><td className="p-2 text-right">{formatINR(invoice.cgstPaise)}</td></tr>
              <tr className="border"><td className="p-2">SGST @9%</td><td className="p-2 text-right">{formatINR(invoice.sgstPaise)}</td></tr>
            </>
          )}
          <tr className="border font-bold"><td className="p-2">Total (GST-inclusive)</td><td className="p-2 text-right">{formatINR(total)}</td></tr>
        </tbody>
      </table>
      <p className="text-xs text-gray-500">
        Computer-generated invoice. Status: {invoice.status}.
        {invoice.pdfKey ? " Archived copy stored." : ""}
      </p>
    </div>
  );
}
