import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { searchCallIdsByTranscript } from "@/lib/fts";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PhoneOff } from "lucide-react";
import { exportCallsToSheet } from "@/server/actions/sheets";
import { callColumns, type CallRow } from "./columns";

async function pushToSheets() {
  "use server";
  await exportCallsToSheet();
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

      {calls.length === 0 ? (
        <EmptyState
          icon={PhoneOff}
          title="No calls yet"
          description="Calls appear here the moment your agent answers or dials. Try clearing the filters to see the full list."
        />
      ) : (
        <DataTable columns={callColumns} data={calls as CallRow[]} searchKey="fromNumber" searchPlaceholder="Search calls…" />
      )}
    </div>
  );
}
