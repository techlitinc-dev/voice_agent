import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { canViewReport } from "@/lib/reports/access";
import { executeReport } from "@/lib/reports/executor";
import { exportToCsv } from "@/lib/reports/export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/money";
import type { ReportConfig, ReportResult } from "@/lib/reports/types";
import { Download, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Run report — Vaani AI" };

function MoneyCell({ col, value }: { col: string; value: unknown }) {
  const isMoney = typeof value === "number" && /billed|cost|margin|revenue|value|price/i.test(col);
  return isMoney ? formatINR(Number(value)) : String(value ?? "");
}

function ReportTable({ result }: { result: ReportResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="run-report-table">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {result.columns.map((c) => <th key={c} className="p-2">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {result.columns.map((c) => (
                <td key={c} className="p-2"><MoneyCell col={c} value={row[c]} /></td>
              ))}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr><td colSpan={result.columns.length} className="p-8 text-center text-muted-foreground">No rows.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function RunReportPage({ params }: { params: { id: string } }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const report = await db.savedReport.findFirst({ where: { id: params.id, workspaceId: ctx.workspaceId } });
  if (!report) redirect("/reports");
  if (!canViewReport(ctx.membership.role, report.visibility as "shared" | "private", report.createdByUserId, ctx.user.id)) {
    redirect("/reports");
  }

  const config = (report.config ?? {}) as unknown as ReportConfig;
  const result = await executeReport(ctx.workspaceId, config);

  return (
    <div className="space-y-6" data-testid="run-report-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/reports" className="text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="mr-1 inline h-3 w-3" /> Reports</Link>
          <h1 className="text-2xl font-bold">{report.name}</h1>
          <p className="text-sm text-muted-foreground">
            Source: {result.source} · {result.rows.length} rows · generated {new Date(result.generatedAt).toLocaleString("en-IN")}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{report.visibility}</Badge>
          <Link href={`/api/reports/${report.id}/export.csv`}>
            <Button variant="outline" size="sm" data-testid="run-export-csv"><Download className="h-4 w-4" /> CSV</Button>
          </Link>
        </div>
      </div>

      {Object.keys(result.summary).length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.entries(result.summary).map(([k, v]) => (
            <Card key={k}>
              <CardHeader><CardTitle className="text-sm capitalize">{k}</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{typeof v === "number" && /billed|cost|margin|revenue|value/i.test(k) ? formatINR(v) : String(v ?? "—")}</CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Results</CardTitle></CardHeader>
        <CardContent className="p-0"><ReportTable result={result} /></CardContent>
      </Card>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw CSV</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-border bg-muted p-3 text-xs">{exportToCsv(result)}</pre>
      </details>
    </div>
  );
}
