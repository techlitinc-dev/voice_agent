import { describe, expect, it } from "vitest";
import { canCreateReport, canViewReport } from "../src/lib/reports/access";
import { exportToCsv, renderReportSummary } from "../src/lib/reports/export";
import { REPORT_TEMPLATES, getTemplate } from "../src/lib/reports/templates";
import type { ReportResult } from "../src/lib/reports/types";

function sampleReport(): ReportResult {
  return {
    name: "Daily Call Summary",
    source: "calls",
    columns: ["day", "count", "sumBilled"],
    rows: [
      { day: "2026-08-01", count: 45, sumBilled: 320000 },
      { day: "2026-08-02", count: 52, sumBilled: 380000 },
      { day: null, count: 3, sumBilled: null },
    ],
    summary: { count: 100, sumBilled: 700000 },
    chart: { type: "line", xAxis: "day", yAxis: "count" },
    groupBy: ["day"],
    generatedAt: "2026-08-13T10:00:00Z",
  };
}

// ---------- Export (guide 04 §5.1) ----------

describe("exportToCsv", () => {
  it("emits header + rows with escaping", () => {
    const csv = exportToCsv(sampleReport());
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("day,count,sumBilled");
    expect(lines[1]).toBe("2026-08-01,45,320000");
    expect(lines[2]).toBe("2026-08-02,52,380000");
    expect(lines[3]).toBe(",3,"); // null -> empty
  });
  it("quotes cells containing commas/quotes", () => {
    const report = sampleReport();
    report.rows = [{ day: 'a,"b",c', count: 1, sumBilled: 0 }];
    const csv = exportToCsv(report);
    expect(csv).toContain('"a,""b"",c"');
  });
});

describe("renderReportSummary", () => {
  it("includes the title and row count", () => {
    const text = renderReportSummary(sampleReport());
    expect(text).toContain("Daily Call Summary");
    expect(text).toContain("Rows: 3");
  });
});

// ---------- Access control (guide 04 §6) ----------

describe("canCreateReport", () => {
  it("only OWNER and ADMIN can create", () => {
    expect(canCreateReport("OWNER")).toBe(true);
    expect(canCreateReport("ADMIN")).toBe(true);
    expect(canCreateReport("MANAGER")).toBe(false);
    expect(canCreateReport("AGENT")).toBe(false);
    expect(canCreateReport("VIEWER")).toBe(false);
  });
});

describe("canViewReport", () => {
  it("shared reports are visible to everyone", () => {
    expect(canViewReport("VIEWER", "shared", null, "u1")).toBe(true);
    expect(canViewReport("AGENT", "shared", "someone-else", "u1")).toBe(true);
  });
  it("private reports are only visible to the creator", () => {
    expect(canViewReport("AGENT", "private", "u1", "u1")).toBe(true);
    expect(canViewReport("AGENT", "private", "u2", "u1")).toBe(false);
    expect(canViewReport("OWNER", "private", "u2", "u1")).toBe(false); // creator-scoped, not role-scoped
  });
});

// ---------- Templates (guide 04 §3) ----------

describe("REPORT_TEMPLATES", () => {
  it("includes all 8 spec templates", () => {
    const ids = REPORT_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("daily-call-summary");
    expect(ids).toContain("agent-performance");
    expect(ids).toContain("campaign-progress");
    expect(ids).toContain("cost-breakdown");
    expect(ids).toContain("pipeline-funnel");
    expect(ids).toContain("revenue-trend");
    expect(ids).toContain("sales-rep-leaderboard");
    expect(ids).toContain("hourly-heatmap");
  });
  it("looks up by id", () => {
    expect(getTemplate("cost-breakdown")?.config.source).toBe("cost");
    expect(getTemplate("nope")).toBeUndefined();
  });
});
