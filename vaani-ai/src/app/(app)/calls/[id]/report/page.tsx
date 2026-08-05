import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Print-friendly call report — browser Print / Save-as-PDF produces the PDF export
 * (spec §8). OPERATOR GATE (optional): true server-side PDF generation would add a
 * heavy dependency (puppeteer/pdfkit) and is deliberately deferred; this page is the
 * v1 PDF path.
 */
export default async function CallReportPage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const call = await db.call.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: {
      agent: { select: { name: true } },
      campaign: { select: { name: true } },
      qaScores: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!call) notFound();
  const qa = call.qaScores[0] ?? null;
  const wholesale =
    call.costTelephonyPaise + call.costSttPaise + call.costLlmPaise + call.costTtsPaise;

  return (
    <div className="mx-auto max-w-3xl space-y-4 bg-white p-8 text-black print:p-0">
      <style>{`@media print { body { background: white; } .no-print { display: none; } }`}</style>
      <div className="no-print mb-4 rounded border border-gray-300 p-3 text-sm text-gray-500"
        data-testid="call-report-print-hint">
        PDF export: use your browser&apos;s Print → “Save as PDF” (Ctrl+P / Cmd+P). This banner and
        the app navigation are hidden in the printout.
      </div>
      <h1 className="text-2xl font-bold">Call report — {call.fromNumber} → {call.toNumber}</h1>
      <p className="text-sm text-gray-600">
        {call.createdAt.toLocaleString("en-IN")} · {call.direction} · {call.status} · {call.durationSec}s
      </p>
      <table className="w-full text-sm">
        <tbody>
          <tr><td className="py-1 text-gray-600">Agent</td><td>{call.agent?.name ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Campaign</td><td>{call.campaign?.name ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Outcome / disposition</td><td>{call.outcome ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Sentiment</td><td>{call.sentiment ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Dead air</td><td>{call.deadAirSeconds}s</td></tr>
          <tr><td className="py-1 text-gray-600">Script adherence</td><td>{call.scriptAdherenceScore ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">QA score</td><td>{qa ? `${qa.totalScore}/${qa.maxScore} (${qa.rubricName})` : "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Wholesale cost</td><td>{formatINR(wholesale)}</td></tr>
          <tr><td className="py-1 text-gray-600">Billed</td><td>{formatINR(call.billedPaise)}</td></tr>
        </tbody>
      </table>
      {call.summary && (
        <>
          <h2 className="text-lg font-semibold">Summary</h2>
          <p className="text-sm">{call.summary}</p>
        </>
      )}
      <h2 className="text-lg font-semibold">Transcript{call.piiRedacted ? " (PII redacted)" : ""}</h2>
      <pre className="whitespace-pre-wrap text-sm">{call.transcript ?? "No transcript."}</pre>
    </div>
  );
}
