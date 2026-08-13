"use client";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  BarChart, Bar, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/money";

const TOOLTIP_STYLE = { background: "#0d1526", border: "1px solid #1e2a40" };

type StageFunnel = { id: string; name: string; color: string; dealCount: number; valuePaise: number };
type RevenuePoint = { date: string; valuePaise: number; count: number };
type SourceRow = { source: string; deals: number; revenue: number; avgSize: number };
type RepRow = { ownerUserId: string; name: string; dealsWon: number; revenue: number; winRate: number; openDeals: number };
type AgingRow = {
  id: string; title: string; stage: string; stageColor: string | null; valuePaise: number;
  daysInStage: number; alert: "ok" | "warning" | "stale"; owner: string | null; contactName: string | null; lastActivityAt: Date;
};
type CohortRow = { month: string; count: number; avgToContacted: number | null; avgToWon: number | null; winRate: number };

export function FunnelChart({ stages }: { stages: StageFunnel[] }) {
  if (stages.length === 0) return <p className="text-sm text-muted-foreground">No pipeline stages.</p>;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={stages} layout="vertical" margin={{ left: 80 }}>
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" width={100} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          content={({ active, payload }) => active && payload && payload[0] ? (
            <div className="rounded border bg-background p-2 text-sm">
              <p>{String(payload[0].payload.name)}: {Number(payload[0].payload.dealCount)} deals</p>
              <p className="text-muted-foreground">{formatINR(Number(payload[0].payload.valuePaise))}</p>
            </div>
          ) : null}
        />
        <Bar dataKey="dealCount" radius={[0, 4, 4, 0]}>
          {stages.map((d) => <Cell key={d.id} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueOverTime({ data }: { data: RevenuePoint[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No closed-won revenue in this period.</p>;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" stroke="#6b7a90" fontSize={12} />
        <YAxis tickFormatter={(v) => `₹${(Number(v) / 100).toLocaleString("en-IN")}`} width={80} stroke="#6b7a90" fontSize={12} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatINR(Number(v))} />
        <Area type="monotone" dataKey="valuePaise" stroke="#10b981" fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RevenueBySource({ data }: { data: SourceRow[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No closed-won deals by source yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
        <XAxis type="number" stroke="#6b7a90" fontSize={12} tickFormatter={(v) => `₹${(Number(v) / 100000).toFixed(0)}L`} />
        <YAxis dataKey="source" type="category" width={90} stroke="#6b7a90" fontSize={12} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatINR(Number(v))} />
        <Bar dataKey="revenue" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RepLeaderboard({ reps }: { reps: RepRow[] }) {
  if (reps.length === 0) return <p className="text-sm text-muted-foreground">No sales rep activity in this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2">Rep</th>
          <th className="py-2 text-right">Won</th>
          <th className="py-2 text-right">Revenue</th>
          <th className="py-2 text-right">Win rate</th>
          <th className="py-2 text-right">Open</th>
        </tr>
      </thead>
      <tbody>
        {reps.map((r) => (
          <tr key={r.ownerUserId} className="border-b last:border-0">
            <td className="py-2 font-medium">{r.name}</td>
            <td className="py-2 text-right">{r.dealsWon}</td>
            <td className="py-2 text-right font-semibold">{formatINR(r.revenue)}</td>
            <td className="py-2 text-right">{r.winRate}%</td>
            <td className="py-2 text-right text-muted-foreground">{r.openDeals}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StageAgingTable({ rows }: { rows: AgingRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No open deals.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Deal</th>
            <th className="py-2">Stage</th>
            <th className="py-2 text-right">Value</th>
            <th className="py-2 text-right">Days in stage</th>
            <th className="py-2">Owner</th>
            <th className="py-2">Alert</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-b last:border-0">
              <td className="py-2 font-medium">{d.title}</td>
              <td className="py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.stageColor ?? "#94a3b8" }} />
                  {d.stage}
                </span>
              </td>
              <td className="py-2 text-right">{formatINR(d.valuePaise)}</td>
              <td className="py-2 text-right">{d.daysInStage}d</td>
              <td className="py-2">{d.owner ?? "—"}</td>
              <td className="py-2">
                {d.alert === "stale" ? <Badge variant="danger">Stale</Badge>
                  : d.alert === "warning" ? <Badge variant="warning">Warning</Badge>
                  : <Badge variant="secondary">OK</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CohortTable({ rows }: { rows: CohortRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No deals in recent months.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Created</th>
            <th className="py-2 text-right">Count</th>
            <th className="py-2 text-right">→Contacted (avg d)</th>
            <th className="py-2 text-right">→Won (avg d)</th>
            <th className="py-2 text-right">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.month} className="border-b last:border-0">
              <td className="py-2 font-medium">{new Date(c.month + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</td>
              <td className="py-2 text-right">{c.count}</td>
              <td className="py-2 text-right">{c.avgToContacted !== null ? `${c.avgToContacted}d` : "—"}</td>
              <td className="py-2 text-right">{c.avgToWon !== null ? `${c.avgToWon}d` : "—"}</td>
              <td className="py-2 text-right">{c.winRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ForecastCards({ thisMonth, nextMonthWeighted }: { thisMonth: number; nextMonthWeighted: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">This month forecast (weighted)</CardTitle></CardHeader>
        <CardContent className="text-2xl font-bold text-primary">{formatINR(thisMonth)}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Next month forecast (by expectedClose)</CardTitle></CardHeader>
        <CardContent className="text-2xl font-bold">{formatINR(nextMonthWeighted)}</CardContent>
      </Card>
    </div>
  );
}
