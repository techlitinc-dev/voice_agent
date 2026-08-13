/**
 * Pre-built report templates (docs/analytics/04 §3).
 * These give users a one-click starting point in the builder.
 */
import type { ReportConfig } from "./types";

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  config: ReportConfig;
}

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
  {
    id: "agent-performance",
    name: "Agent Performance",
    description: "Calls, HOT count, and billed revenue by agent",
    icon: "Bot",
    config: {
      source: "calls",
      dateRange: { preset: "30d" },
      filters: [],
      groupBy: ["agentId"],
      metrics: ["count", "avgDuration", "hotCount", "sumBilled"],
      chart: { type: "bar", xAxis: "agentId", yAxis: "count" },
    },
  },
  {
    id: "campaign-progress",
    name: "Campaign Progress",
    description: "Calls, connect rate, and deals created per campaign",
    icon: "Megaphone",
    config: {
      source: "campaigns",
      dateRange: { preset: "30d" },
      filters: [],
      groupBy: ["campaign"],
      metrics: ["count", "connectRate", "dealsCreated"],
      chart: { type: "table" },
    },
  },
  {
    id: "cost-breakdown",
    name: "Cost Breakdown",
    description: "Wholesale cost by provider component",
    icon: "IndianRupee",
    config: {
      source: "cost",
      dateRange: { preset: "30d" },
      filters: [],
      groupBy: ["component"],
      metrics: ["sumCost"],
      chart: { type: "pie", xAxis: "component", yAxis: "sumCost" },
    },
  },
  {
    id: "pipeline-funnel",
    name: "Pipeline Funnel",
    description: "Deal counts and value by pipeline stage",
    icon: "Filter",
    config: {
      source: "deals",
      dateRange: { preset: "90d" },
      filters: [],
      groupBy: ["stage"],
      metrics: ["count", "sumValue"],
      chart: { type: "funnel", xAxis: "stage", yAxis: "count" },
    },
  },
  {
    id: "revenue-trend",
    name: "Revenue Trend",
    description: "Billed revenue, cost, and margin by week",
    icon: "TrendingUp",
    config: {
      source: "calls",
      dateRange: { preset: "90d" },
      filters: [],
      groupBy: ["week"],
      metrics: ["sumBilled", "sumCost", "margin"],
      chart: { type: "area", xAxis: "week", yAxis: "sumBilled" },
    },
  },
  {
    id: "sales-rep-leaderboard",
    name: "Sales Rep Leaderboard",
    description: "Won deals and revenue by owner",
    icon: "Trophy",
    config: {
      source: "deals",
      dateRange: { preset: "90d" },
      filters: [],
      groupBy: ["owner"],
      metrics: ["dealsWon", "revenue"],
      chart: { type: "table" },
    },
  },
  {
    id: "hourly-heatmap",
    name: "Hourly Heatmap",
    description: "Call volume by hour of day",
    icon: "CalendarClock",
    config: {
      source: "calls",
      dateRange: { preset: "30d" },
      filters: [],
      groupBy: ["hour"],
      metrics: ["count"],
      chart: { type: "heatmap", xAxis: "hour", yAxis: "count" },
    },
  },
];

export function getTemplate(id: string): ReportTemplate | undefined {
  return REPORT_TEMPLATES.find((t) => t.id === id);
}
