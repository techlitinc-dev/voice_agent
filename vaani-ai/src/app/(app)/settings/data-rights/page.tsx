import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { objectUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestDataExport, requestErasure } from "@/server/actions/gdpr";

export const dynamic = "force-dynamic";

async function exportData(formData: FormData) {
  "use server";
  await requestDataExport(formData);
}

async function eraseData(formData: FormData) {
  "use server";
  await requestErasure(formData);
}

export default async function DataRightsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const requests = await db.gdprRequest.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const downloadUrls = new Map<string, string>();
  for (const r of requests) {
    if (r.type === "EXPORT" && r.status === "COMPLETED" && r.resultKey) {
      const url = await objectUrl(r.resultKey).catch(() => null);
      if (url) downloadUrls.set(r.id, url);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Data rights (GDPR)</h1>
      <p className="text-sm text-muted-foreground">
        Export a copy of call/contact data, or erase everything tied to a caller&apos;s
        phone number (recordings, transcripts, summaries, entities, contact record).
        Erasure also adds the number to your DNC list. Requests process within a
        minute; every action is audit-logged.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Export my data</CardTitle></CardHeader>
          <CardContent>
            <form action={exportData} className="space-y-3" data-testid="gdpr-export-form">
              <input name="subjectPhone" placeholder="+919812345678 (optional — empty = whole workspace)"
                className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm" />
              <button data-testid="gdpr-export-button"
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                Request export
              </button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Right to erasure</CardTitle></CardHeader>
          <CardContent>
            <form action={eraseData} className="space-y-3" data-testid="gdpr-erasure-form">
              <input name="subjectPhone" required placeholder="+919812345678"
                data-testid="gdpr-erasure-phone-input"
                className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm" />
              <button data-testid="gdpr-erasure-button"
                className="h-9 rounded-md bg-red-600 px-4 text-sm font-medium text-white">
                Erase this caller&apos;s data
              </button>
              <p className="text-xs text-muted-foreground">Irreversible. Redacted artifacts cannot be recovered.</p>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Requests ({requests.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="gdpr-requests-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Type</th><th className="p-3">Subject</th><th className="p-3">Status</th>
                <th className="p-3">Filed</th><th className="p-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3">{r.type}</td>
                  <td className="p-3 font-mono text-xs">{r.subjectPhone ?? "whole workspace"}</td>
                  <td className={`p-3 ${r.status === "COMPLETED" ? "text-green-400" : "text-orange-400"}`}>{r.status}</td>
                  <td className="p-3 text-muted-foreground">{r.createdAt.toLocaleString("en-IN")}</td>
                  <td className="p-3">
                    {downloadUrls.has(r.id) ? (
                      <a href={downloadUrls.get(r.id)} data-testid={`gdpr-download-${r.id}`}
                        className="text-primary underline">Download JSON</a>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No requests filed yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
