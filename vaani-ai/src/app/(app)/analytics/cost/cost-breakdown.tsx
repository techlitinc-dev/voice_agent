"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatINR } from "@/lib/money";

const COLORS: Record<string, string> = {
  telephony: "#3b82f6",
  stt: "#8b5cf6",
  llm: "#f59e0b",
  tts: "#10b981",
};

export type CostBreakdownDatum = { key: string; name: string; value: number };

/** Donut of wholesale cost by provider (guide 03 §1.2). */
export function CostBreakdownDonut({ data, total }: { data: CostBreakdownDatum[]; total: number }) {
  if (total <= 0) return <p className="pt-16 text-center text-sm text-muted-foreground">No cost in this period.</p>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
          {data.map((d, i) => <Cell key={i} fill={COLORS[d.key] ?? "#94a3b8"} />)}
        </Pie>
        <Tooltip formatter={(v: number | string) => formatINR(Number(v))} contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export type CostSummary = {
  totalCostPaise: number;
  revenuePaise: number;
  marginPaise: number;
  marginPct: number;
};

/** Cost / revenue / margin summary bar under the donut (guide 03 §1.2). */
export function CostSummaryPanel({ summary }: { summary: CostSummary }) {
  const rows = [
    { label: "Total cost", value: summary.totalCostPaise, className: "" },
    { label: "Revenue (billed)", value: summary.revenuePaise, className: "text-primary" },
    {
      label: "Margin",
      value: summary.marginPaise,
      className: summary.marginPaise >= 0 ? "text-green-400" : "text-red-400",
    },
  ];
  return (
    <div className="mt-2 space-y-1 text-sm">
      {rows.map((r) => (
        <p key={r.label} className={`flex justify-between border-b border-border/40 py-1 ${r.className}`}>
          <span>{r.label}</span>
          <span className="font-semibold">{formatINR(r.value)}</span>
        </p>
      ))}
      <p className="flex justify-between py-1 text-muted-foreground">
        <span>Margin %</span>
        <span className="font-semibold">{summary.marginPct}%</span>
      </p>
    </div>
  );
}
