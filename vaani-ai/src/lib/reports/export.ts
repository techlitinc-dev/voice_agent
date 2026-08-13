/**
 * Report export formats (docs/analytics/04 §5). CSV is synchronous and pure;
 * PDF rendering is stubbed (no @react-pdf/renderer dependency installed).
 */
import { csvEscape } from "../csv";
import type { ReportResult } from "./types";

/** Render a report as RFC-4180-ish CSV. */
export function exportToCsv(report: ReportResult): string {
  const headers = report.columns;
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of report.rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Plain-text summary of a report (used in digest emails / in-app). */
export function renderReportSummary(report: ReportResult): string {
  const lines = [
    report.name,
    `Generated: ${new Date(report.generatedAt).toLocaleString("en-IN")}`,
    `Rows: ${report.rows.length}`,
    "",
  ];
  if (report.rows.length > 0) {
    lines.push(headersLine(report));
    for (const row of report.rows.slice(0, 20)) {
      lines.push(rowLine(report, row));
    }
  }
  if (report.rows.length > 20) lines.push(`… and ${report.rows.length - 20} more rows`);
  return lines.join("\n");
}

function headersLine(report: ReportResult): string {
  return report.columns.join(" | ");
}

function rowLine(report: ReportResult, row: Record<string, unknown>): string {
  return report.columns.map((c) => String(row[c] ?? "")).join(" | ");
}
