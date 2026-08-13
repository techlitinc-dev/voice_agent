# 04 — Custom Reports Builder

> **Goal:** Let users build, save, schedule, and share custom reports without
> engineering involvement. The existing `SavedReport` model provides the
> foundation.

---

## 1. Report Builder UI

### 1.1 Visual builder

```
┌──────────────────────────────────────────────────────────────────┐
│  REPORT BUILDER                                                  │
│  Name: [Weekly Sales Summary                      ]              │
│  Type: (•) Calls  ( ) Campaigns  ( ) Deals  ( ) Cost             │
├──────────────────────────────────────────────────────────────────┤
│  DATA SOURCE                                                      │
│  Source: [Calls ▾]                                               │
│  Date range: [Last 7 days ▾]                                     │
│  Filters:                                                         │
│    Direction = Outbound  [✕]                                     │
│    Status = Completed  [✕]                                       │
│    Agent = Loan Telecaller  [✕]                                  │
│    [+ Add filter]                                                │
│                                                                  │
│  GROUP BY: [Day ▾]  [Agent ▾]                                   │
│  METRICS: ☑ Call count  ☑ Avg duration  ☑ Total billed          │
│           ☐ Connect rate  ☐ HOT count                            │
│                                                                  │
│  CHART: (•) Table  ( ) Bar  ( ) Line  ( ) Pie                    │
├──────────────────────────────────────────────────────────────────┤
│  PREVIEW                                                         │
│  ┌────────────┬──────────┬──────────────┬───────────┐           │
│  │ Date       │ Agent    │ Calls        │ Billed    │           │
│  ├────────────┼──────────┼──────────────┼───────────┤           │
│  │ 2026-08-01 │ Loan     │ 45           │ ₹3,200    │           │
│  │ 2026-08-02 │ Loan     │ 52           │ ₹3,800    │           │
│  │ ...        │          │              │           │           │
│  └────────────┴──────────┴──────────────┴───────────┘           │
├──────────────────────────────────────────────────────────────────┤
│  [Cancel]  [Save]  [Save & Schedule]  [Export CSV] [Export PDF]  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Report config schema

The `SavedReport.config` Json field stores the entire report definition:

```ts
// src/lib/reports/types.ts (new)
interface ReportConfig {
  // Data source
  source: "calls" | "campaigns" | "deals" | "cost" | "contacts" | "tasks" | "activities";

  // Scope
  dateRange: { preset: string; start?: string; end?: string };

  // Filters — array of {field, op, value}
  filters: FilterCondition[];

  // Grouping
  groupBy: string[];   // e.g. ["day", "agentId"]
  sortBy?: { field: string; direction: "asc" | "desc" };

  // Metrics — which aggregates to compute
  metrics: MetricKey[]; // ["count", "avgDuration", "sumBilled", "connectRate"]

  // Visualization
  chart: { type: "table" | "bar" | "line" | "pie" | "area"; xAxis?: string; yAxis?: string };

  // Limits
  limit?: number; // max rows
}

interface FilterCondition {
  field: string;   // "direction", "status", "agentId", "campaignId", "interestScore"
  op: "eq" | "neq" | "in" | "gt" | "lt" | "between" | "isnull";
  value: any;
}

type MetricKey =
  | "count" | "avgDuration" | "sumDuration" | "sumBilled" | "avgBilled"
  | "connectRate" | "hotCount" | "warmCount" | "coldCount"
  | "sumCost" | "margin" | "marginPercent"
  | "dealsCreated" | "dealsWon" | "revenue";
```

---

## 2. Report Execution Engine

### 2.1 Query builder

Translate the `ReportConfig` into a Prisma query or raw SQL:

```ts
// src/lib/reports/executor.ts (new)
import { prisma } from "@/lib/db";

export async function executeReport(workspaceId: string, config: ReportConfig): Promise<ReportResult> {
  const range = getDateRange(config.dateRange.preset);
  const filters = translateFilters(config.filters);
  const groupBy = config.groupBy;

  // Build base where clause
  const where = { workspaceId, startedAt: { gte: range.start, lte: range.end }, ...filters };

  if (groupBy.length === 0) {
    // Simple aggregate (no grouping)
    return executeFlatReport(workspaceId, config, where);
  } else {
    // Grouped report
    return executeGroupedReport(workspaceId, config, where);
  }
}

async function executeGroupedReport(workspaceId: string, config: ReportConfig, where: any) {
  // Use raw SQL for complex groupBy (multiple dimensions + custom metrics)
  const selectClauses = buildSelectClauses(config);
  const groupByClauses = buildGroupByClauses(config);

  const rows = await prisma.$queryRaw`
    SELECT ${Prisma.raw(selectClauses)}
    FROM "Call"
    WHERE "workspaceId" = ${workspaceId}
      AND "startedAt" BETWEEN ${range.start} AND ${range.end}
    GROUP BY ${Prisma.raw(groupByClauses)}
    ORDER BY ${Prisma.raw(config.sortBy?.field || "date")} ${Prisma.raw(config.sortBy?.direction || "desc")}
    LIMIT ${config.limit || 1000}
  `;
  return { rows, summary: computeSummary(rows) };
}
```

### 2.2 Filter translation

```ts
function translateFilters(filters: FilterCondition[]): Prisma.Sql {
  return filters.map(f => {
    switch (f.op) {
      case "eq": return `${f.field} = ${f.value}`;
      case "neq": return `${f.field} != ${f.value}`;
      case "in": return `${f.field} IN (${f.value.map((v: string) => `'${v}'`).join(",")})`;
      case "gt": return `${f.field} > ${f.value}`;
      case "lt": return `${f.field} < ${f.value}`;
      case "between": return `${f.field} BETWEEN ${f.value[0]} AND ${f.value[1]}`;
      case "isnull": return `${f.field} IS NULL`;
      default: return "TRUE";
    }
  }).join(" AND ");
}
```

### 2.3 Metric computation

```ts
function buildSelectClauses(config: ReportConfig): string {
  const dims = config.groupBy.map(g => `${groupByExpr(g)} AS ${g}`).join(", ");
  const metrics = config.metrics.map(m => metricExpr(m)).join(", ");
  return `${dims}, ${metrics}`;
}

function metricExpr(metric: MetricKey): string {
  switch (metric) {
    case "count": return `COUNT(*) AS count`;
    case "avgDuration": return `AVG("durationSec") AS avg_duration`;
    case "sumDuration": return `SUM("durationSec") AS sum_duration`;
    case "sumBilled": return `SUM("billedPaise") AS sum_billed`;
    case "avgBilled": return `AVG("billedPaise") AS avg_billed`;
    case "connectRate": return `ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'COMPLETED') / NULLIF(COUNT(*), 0), 1) AS connect_rate`;
    case "hotCount": return `COUNT(*) FILTER (WHERE "interestScore" = 'HOT') AS hot_count`;
    case "sumCost": return `SUM("costTelephonyPaise" + "costSttPaise" + "costLlmPaise" + "costTtsPaise") AS sum_cost`;
    case "margin": return `SUM("billedPaise") - SUM("costTelephonyPaise" + "costSttPaise" + "costLlmPaise" + "costTtsPaise") AS margin`;
    default: return `0 AS ${metric}`;
  }
}
```

---

## 3. Report Templates

Pre-built reports to get users started:

| Template | Source | Group by | Metrics | Chart |
|---|---|---|---|---|
| Daily call summary | calls | day | count, connectRate, avgDuration | Line |
| Agent performance | calls | agent | count, avgDuration, hotCount, sumBilled | Bar |
| Campaign progress | campaigns | campaign | calls, connectRate, dealsCreated | Table |
| Cost breakdown | cost | component | sumCost | Pie |
| Pipeline funnel | deals | stage | dealCount, sumValue | Funnel |
| Revenue trend | calls | week | sumBilled, sumCost, margin | Area |
| Sales rep leaderboard | deals | owner | wonCount, revenue, winRate | Table |
| Hourly heatmap | calls | hour-of-day, day-of-week | count | Heatmap |

```ts
// src/lib/reports/templates.ts (new)
export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "daily-call-summary",
    name: "Daily Call Summary",
    description: "Calls, connect rate, and avg duration by day",
    icon: "Phone",
    config: {
      source: "calls",
      dateRange: { preset: "7d" },
      filters: [],
      groupBy: ["day"],
      metrics: ["count", "connectRate", "avgDuration"],
      chart: { type: "line", xAxis: "day", yAxis: "count" },
    },
  },
  // ... more templates
];
```

---

## 4. Scheduling & Delivery

The `ScheduledDigest` model exists. Extend it for custom reports:

### 4.1 Schedule options

| Frequency | When it runs |
|---|---|
| Daily | 8:00 AM IST |
| Weekly | Monday 8:00 AM IST |
| Monthly | 1st of month 8:00 AM IST |

### 4.2 Delivery channels

- **Email**: PDF attachment + inline summary.
- **Slack**: via webhook (post chart image + summary text).
- **WhatsApp**: to admin phone (summary text only, for on-the-go owners).
- **Dashboard**: in-app notification.

### 4.3 Digest worker

```ts
// src/worker/digest.ts (extend)
async function processDigest(digest: ScheduledDigest) {
  const report = digest.reportId
    ? await executeSavedReport(digest.reportId)
    : await executeDefaultDigest(digest);

  const pdf = await renderReportPdf(report);
  const summary = renderReportSummary(report);

  for (const email of digest.recipients) {
    await sendEmail({
      to: email,
      subject: `Vaani Report: ${report.name} — ${formatDate(new Date())}`,
      html: summary,
      attachments: [{ filename: `${report.name}.pdf`, content: pdf }],
    });
  }

  await prisma.scheduledDigest.update({
    where: { id: digest.id },
    data: { lastSentAt: new Date() },
  });
}
```

---

## 5. Export Formats

### 5.1 CSV export

```ts
// src/lib/reports/export.ts (new)
export function exportToCsv(report: ReportResult): string {
  const headers = Object.keys(report.rows[0]);
  const lines = [headers.join(",")];
  for (const row of report.rows) {
    lines.push(headers.map(h => JSON.stringify(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}
```

### 5.2 PDF export

Use `@react-pdf/renderer` or `puppeteer` to render the report as PDF:

```ts
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportPdfDocument } from "./report-pdf";

export async function exportToPdf(report: ReportResult): Promise<Buffer> {
  return renderToBuffer(<ReportPdfDocument report={report} />);
}
```

```tsx
// src/lib/reports/report-pdf.tsx
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

export function ReportPdfDocument({ report }: { report: ReportResult }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{report.name}</Text>
        <Text style={styles.meta}>Generated: {new Date().toLocaleString("en-IN")}</Text>
        <View style={styles.table}>
          {/* render table rows */}
        </View>
      </Page>
    </Document>
  );
}
```

---

## 6. Access Control

- Reports are workspace-scoped.
- Only ADMIN and OWNER can create/schedule reports.
- MANAGER and AGENT can view shared reports.
- Reports can be marked **private** (creator only) or **shared** (workspace).

---

## 7. Performance

Custom reports can be expensive. Mitigations:

1. **Cache results** in Redis for 5 minutes (see [production-readiness/03 §3](../production-readiness/03-scalability-and-performance.md#3-caching-strategy)).
2. **Limit rows** to 10,000 max per report.
3. **Timeout**: abort queries > 30 seconds.
4. **Pre-aggregate**: nightly materialized views for common groupings.

### Materialized views (Large tier)

```sql
-- Refresh nightly
CREATE MATERIALIZED VIEW call_daily_stats AS
SELECT
  "workspaceId", "agentId", "campaignId",
  date_trunc('day', "startedAt") AS day,
  COUNT(*) AS calls,
  AVG("durationSec") AS avg_duration,
  SUM("billedPaise") AS revenue
FROM "Call"
GROUP BY "workspaceId", "agentId", "campaignId", day;

CREATE UNIQUE INDEX ON call_daily_stats ("workspaceId", "agentId", "campaignId", day);
```

Reports reading from the materialized view are 10–100× faster.

---

← Back to [Detailed Analytics](../README.md#detailed-analytics) | [UI Expansion →](../ui-expansion/01-component-catalog.md)