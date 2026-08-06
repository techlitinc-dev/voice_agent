import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { searchCallIdsByTranscript } from "@/lib/fts";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { exportCallsToSheet } from "@/server/actions/sheets";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "text-green-400",
  FAILED: "text-red-400",
  NO_ANSWER: "text-orange-400",
  BUSY: "text-orange-400",
  IN_PROGRESS: "text-blue-400",
  RINGING: "text-blue-400",
  VOICEMAIL: "text-muted-foreground",
};

async function pushToSheets() {
  "use server";
  await exportCallsToSheet();
}

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export const metadata = { title: "Calls — Vaani AI" };
export default async function CallsPage({
  searchParams,
}: {
  searchParams: { direction?: string; status?: string; q?: string; transcript?: string };
}) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  // Full-text transcript search (Postgres FTS, Step 5). Falls back to empty when
  // the migration has not been applied yet, so the page never crashes.
  let transcriptIds: string[] | null = null;
  const tsQuery = (searchParams.transcript ?? "").trim();
  if (tsQuery.length > 0) {
    transcriptIds = await searchCallIdsByTranscript(ctx.workspaceId, tsQuery);
  }

  const where = {
    workspaceId: ctx.workspaceId,
    ...(searchParams.direction ? { direction: searchParams.direction as "INBOUND" | "OUTBOUND" } : {}),
    ...(searchParams.status ? { status: searchParams.status as never } : {}),
    ...(searchParams.q
      ? {
          OR: [
            { fromNumber: { contains: searchParams.q } },
            { toNumber: { contains: searchParams.q } },
            { summary: { contains: searchParams.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(transcriptIds ? { id: { in: transcriptIds } } : {}),
  };

  const calls = await db.call.findMany({
    where,
    include: { agent: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calls</h1>
        <div className="flex gap-2">
          <form action={pushToSheets}>
            <button data-testid="export-calls-sheets"
              className="h-9 rounded-md border border-border px-4 text-sm hover:border-primary/50">
              Push to Google Sheets
            </button>
          </form>
          <a data-testid="export-calls-csv" href="/api/exports/calls.csv"
            className="h-9 rounded-md border border-border px-4 py-2 text-sm hover:border-primary/50">
            Export CSV
          </a>
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={searchParams.q} placeholder="Number or summary…"
          data-testid="calls-search-input"
          className="h-9 w-56 rounded-md border border-border bg-transparent px-3 text-sm" />
        <input name="transcript" defaultValue={searchParams.transcript}
          placeholder="Full-text transcript search…"
          data-testid="calls-transcript-search"
          className="h-9 w-64 rounded-md border border-border bg-transparent px-3 text-sm" />
        <select name="direction" defaultValue={searchParams.direction ?? ""}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="">All directions</option>
          <option value="INBOUND">Inbound</option>
          <option value="OUTBOUND">Outbound</option>
        </select>
        <select name="status" defaultValue={searchParams.status ?? ""}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="">All statuses</option>
          {["COMPLETED", "FAILED", "NO_ANSWER", "BUSY", "IN_PROGRESS", "VOICEMAIL"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button data-testid="calls-filter-button"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Filter</button>
      </form>

      {transcriptIds !== null && (
        <p className="text-sm text-muted-foreground" data-testid="calls-fts-count">
          {transcriptIds.length} call(s) match transcript search “{tsQuery}”.
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="calls-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">When</th><th className="p-3">Dir</th><th className="p-3">From → To</th>
                <th className="p-3">Agent</th><th className="p-3">Status</th><th className="p-3">Duration</th>
                <th className="p-3">Outcome</th><th className="p-3">Billed</th><th className="p-3">QA</th>
                <th className="p-3">Summary</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {c.createdAt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="p-3">{c.direction === "INBOUND" ? "↙" : "↗"}</td>
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/calls/${c.id}`} className="hover:text-primary hover:underline">
                      {c.fromNumber} → {c.toNumber}
                    </Link>
                  </td>
                  <td className="p-3">{c.agent?.name ?? "—"}</td>
                  <td className={`p-3 ${STATUS_COLOR[c.status] ?? ""}`}>{c.status}</td>
                  <td className="p-3">{fmtDur(c.durationSec)}</td>
                  <td className="p-3">{c.outcome ?? "—"}</td>
                  <td className="p-3">{c.billedPaise > 0 ? formatINR(c.billedPaise) : "—"}</td>
                  <td className="p-3">
                    {c.scriptAdherenceScore !== null ? (
                      <span data-testid={`call-qa-score-${c.id}`}
                        className={`rounded-full border px-2 py-0.5 text-xs ${c.scriptAdherenceScore >= 70 ? "text-green-400" : "text-orange-400"}`}>
                        {c.scriptAdherenceScore}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="max-w-64 truncate p-3 text-muted-foreground">{c.summary ?? "—"}</td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">
                  No calls match. They appear here the moment your agent answers or dials.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
