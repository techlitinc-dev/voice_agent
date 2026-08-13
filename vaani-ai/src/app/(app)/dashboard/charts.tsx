"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
  Treemap,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";

const TOOLTIP_STYLE = { background: "#0d1526", border: "1px solid #1e2a40" };
const BLUE = "#3b82f6";
const VIOLET = "#8b5cf6";
const TEAL = "#10b981";
const RED = "#ef4444";
const COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#f87171", "#34d399", "#a78bfa"];

function formatDateShort(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Compact INR for axis ticks: ₹84k / ₹1.2L / ₹5Cr. */
function formatINRCompact(paise: number): string {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 10000000) return `₹${(rupees / 10000000).toFixed(1)}Cr`;
  if (Math.abs(rupees) >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (Math.abs(rupees) >= 1000) return `₹${Math.round(rupees / 1000)}k`;
  return `₹${Math.round(rupees)}`;
}

type TimePoint = { date: string; inbound: number; outbound: number; revenuePaise: number; costPaise: number };

/** Calls over time — stacked inbound/outbound bars (guide 01 §3.1). */
export function CallsOverTime({ data }: { data: TimePoint[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Calls over time</CardTitle></CardHeader>
      <CardContent className="h-64" data-testid="chart-calls-over-time">
        {data.length === 0 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">No calls in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="date" tickFormatter={formatDateShort} stroke="#6b7a90" fontSize={12} />
              <YAxis stroke="#6b7a90" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <Bar dataKey="inbound" stackId="a" fill={BLUE} name="Inbound" />
              <Bar dataKey="outbound" stackId="a" fill={VIOLET} name="Outbound" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** Revenue vs cost — dual-axis lines (guide 01 §3.2). */
export function RevenueVsCost({ data }: { data: TimePoint[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Revenue + cost</CardTitle></CardHeader>
      <CardContent className="h-64" data-testid="chart-revenue-vs-cost">
        {data.length === 0 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">No revenue in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a40" />
              <XAxis dataKey="date" tickFormatter={formatDateShort} stroke="#6b7a90" fontSize={12} />
              <YAxis yAxisId="left" stroke="#6b7a90" fontSize={12} tickFormatter={(v) => formatINRCompact(Number(v))} width={80} />
              <YAxis yAxisId="right" orientation="right" stroke="#6b7a90" fontSize={12} tickFormatter={(v) => formatINRCompact(Number(v))} width={80} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string) => formatINR(Number(v))} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="revenuePaise" stroke={TEAL} name="Revenue" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="costPaise" stroke={RED} name="Cost" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

type AgentRow = { agentId: string | null; agentName: string; calls: number; billedPaise: number };

/** Calls by agent — horizontal bars (guide 01 §4.1). */
export function CallsByAgent({ data }: { data: AgentRow[] }) {
  const total = data.reduce((a, d) => a + d.calls, 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Calls by agent</CardTitle></CardHeader>
      <CardContent className="h-64" data-testid="chart-by-agent">
        {data.length === 0 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">No agent calls in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
              <XAxis type="number" stroke="#6b7a90" fontSize={12} allowDecimals={false} />
              <YAxis type="category" dataKey="agentName" stroke="#6b7a90" fontSize={12} width={140} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                content={({ active, payload }) => active && payload && payload[0] ? (
                  <div className="rounded border border-border bg-background p-2 text-sm">
                    <p className="font-medium">{String(payload[0].payload.agentName)}</p>
                    <p>{Number(payload[0].payload.calls)} calls</p>
                    <p className="text-muted-foreground">{formatINR(Number(payload[0].payload.billedPaise))} billed</p>
                    <p className="text-xs text-muted-foreground">{total > 0 ? Math.round((Number(payload[0].payload.calls) / total) * 100) : 0}% share</p>
                  </div>
                ) : null}
              />
              <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

type CampaignRow = { campaignId: string | null; campaignName: string; calls: number; connected: number; billedPaise: number; connectRate: number };

/** Calls per campaign with a connect-rate conversion overlay (guide 01 §4.2). */
export function CallsByCampaign({ data }: { data: CampaignRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Calls by campaign</CardTitle></CardHeader>
      <CardContent className="h-64" data-testid="chart-by-campaign">
        {data.length === 0 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">No campaign calls in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
              <XAxis type="number" stroke="#6b7a90" fontSize={12} allowDecimals={false} />
              <YAxis type="category" dataKey="campaignName" stroke="#6b7a90" fontSize={12} width={150} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                content={({ active, payload }) => active && payload && payload[0] ? (
                  <div className="rounded border border-border bg-background p-2 text-sm">
                    <p className="font-medium">{String(payload[0].payload.campaignName)}</p>
                    <p>{Number(payload[0].payload.calls)} calls</p>
                    <p>{Number(payload[0].payload.connected)} connected ({Number(payload[0].payload.connectRate)}%)</p>
                    <p className="text-muted-foreground">{formatINR(Number(payload[0].payload.billedPaise))} billed</p>
                  </div>
                ) : null}
              />
              <Bar dataKey="calls" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

type SourceRow = { source: string; calls: number };

function TreemapCell(props: { index?: number; x?: number; y?: number; width?: number; height?: number; name?: string }) {
  const { index = 0, x = 0, y = 0, width = 0, height = 0, name = "" } = props;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={COLORS[index % COLORS.length]} stroke="#0b1120" />
      {width > 60 && height > 30 && (
        <text x={x + 4} y={y + 14} fill="#fff" fontSize={12} fontWeight={600}>
          {name}
        </text>
      )}
    </g>
  );
}

/** Call volume by source — treemap (guide 01 §4.3). */
export function CallsBySource({ data }: { data: SourceRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Calls by source</CardTitle></CardHeader>
      <CardContent className="h-64" data-testid="chart-by-source">
        {data.length === 0 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">No calls in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data}
              dataKey="calls"
              nameKey="source"
              stroke="#0b1120"
              fill="#3b82f6"
              content={<TreemapCell />}
            />
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
