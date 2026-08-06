import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitKycDocumentAction } from "@/server/actions/kyc";
import { KycForm } from "./kyc-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "KYC — Vaani AI" };

const STATUS_STYLES: Record<string, string> = {
  NOT_STARTED: "border-border text-muted-foreground",
  PENDING: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  VERIFIED: "border-green-500/40 bg-green-500/10 text-green-400",
  REJECTED: "border-red-500/40 bg-red-500/10 text-red-400",
};

export default async function KycPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [trial, records] = await Promise.all([
    db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.kycRecord.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const kycStatus = trial?.kycStatus ?? "NOT_STARTED";

  async function submit(formData: FormData) {
    "use server";
    return submitKycDocumentAction(formData);
  }

  return (
    <div className="max-w-2xl space-y-6" data-testid="kyc-page">
      <h1 className="text-2xl font-bold">India KYC</h1>

      <div className={`rounded-md border p-3 text-sm ${STATUS_STYLES[kycStatus] ?? STATUS_STYLES.NOT_STARTED}`} data-testid="kyc-status-banner">
        KYC status: <span className="font-semibold">{kycStatus}</span>
        {kycStatus === "VERIFIED" && " — you can purchase regulated 140/1600-series numbers."}
        {kycStatus === "PENDING" && " — under review (usually 1 business day). Local and international numbers work without KYC."}
        {kycStatus === "REJECTED" && " — the last submission was rejected; upload clearer documents below."}
        {kycStatus === "NOT_STARTED" && " — required only for regulated 140/1600-series numbers. Local and international numbers are instant, no KYC needed."}
      </div>

      <Card>
        <CardHeader><CardTitle>Upload a KYC document</CardTitle></CardHeader>
        <CardContent>
          <KycForm action={submit} />
          <p className="mt-3 text-xs text-muted-foreground">
            Accepted: GST certificate, PAN, Aadhaar, or certificate of incorporation (PDF/PNG/JPG, max 5 MB).
            Documents are stored in private object storage and reviewed by the operator
            (review flips TrialState.kycStatus → VERIFIED/REJECTED in the database).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Submissions</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {records.map((r) => (
            <p key={r.id} className="flex justify-between border-b pb-1 last:border-0" data-testid={`kyc-record-${r.id}`}>
              <span>{r.documentType}{r.documentRef ? ` · ${r.documentRef}` : ""}</span>
              <span className="text-muted-foreground">
                {r.status} · {r.createdAt.toLocaleDateString("en-IN")}
              </span>
            </p>
          ))}
          {records.length === 0 && <p className="text-muted-foreground">No submissions yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
