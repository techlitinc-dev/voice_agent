/**
 * Custom reports builder types (docs/analytics/04 §1.2).
 * The SavedReport.config Json field stores a ReportConfig.
 */

export type ReportSource =
  | "calls"
  | "campaigns"
  | "deals"
  | "cost"
  | "contacts"
  | "tasks"
  | "activities";

export type FilterOp = "eq" | "neq" | "in" | "gt" | "lt" | "between" | "isnull";

export interface FilterCondition {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export type MetricKey =
  | "count"
  | "avgDuration"
  | "sumDuration"
  | "sumBilled"
  | "avgBilled"
  | "connectRate"
  | "hotCount"
  | "warmCount"
  | "coldCount"
  | "sumCost"
  | "margin"
  | "marginPercent"
  | "dealsCreated"
  | "dealsWon"
  | "sumValue"
  | "revenue";

export type ChartType = "table" | "bar" | "line" | "pie" | "area" | "funnel" | "heatmap";

export interface ReportConfig {
  source: ReportSource;
  dateRange: { preset: string; start?: string; end?: string };
  filters: FilterCondition[];
  groupBy: string[]; // e.g. ["day", "agentId"]
  sortBy?: { field: string; direction: "asc" | "desc" };
  metrics: MetricKey[];
  chart: { type: ChartType; xAxis?: string; yAxis?: string };
  limit?: number; // max rows
  title?: string;
}

/** One row of an executed report. Values are JSON-serializable. */
export type ReportRow = Record<string, string | number | null>;

export interface ReportResult {
  name: string;
  source: ReportSource;
  columns: string[]; // display order
  rows: ReportRow[];
  summary: Record<string, number | string | null>;
  chart: ReportConfig["chart"];
  groupBy: string[];
  generatedAt: string;
}
