# 01 — Executive Dashboard

> **Goal:** A single screen that tells the CEO/founder "how is the business
> doing right now?" — calls, revenue, pipeline, and system health in one view.

---

## 1. Dashboard Layout

### 1.1 Information architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Today | 7d | 30d | 90d | Custom]    [Workspace ▾]  [Export 📥]   │
├─────────────────────────────────────────────────────────────────────┤
│  ROW 1: KPI STAT CARDS                                              │
│  ┌────────┬────────┬────────┬────────┬────────┬────────┐          │
│  │ CALLS  │CONNECT │REVENUE │ MARGIN │NPS/CSAT│ACTIVE  │          │
│  │  142   │  68%   │₹84,000 │  32%   │  47    │  18    │          │
│  │ ↑12%   │ ↑3%    │ ↑18%   │ ↑2%    │        │ users  │          │
│  └────────┴────────┴────────┴────────┴────────┴────────┘          │
├─────────────────────────────────────────────────────────────────────┤
│  ROW 2: TRENDS                                                      │
│  ┌─────────────────────────────┬─────────────────────────────┐    │
│  │ Calls (inbound/outbound)    │ Revenue + Cost (area)       │    │
│  │ over time — stacked bar     │ over time — dual line       │    │
│  └─────────────────────────────┴─────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────┤
│  ROW 3: BREAKDOWN                                                   │
│  ┌──────────────┬──────────────┬──────────────┐                   │
│  │ By Agent     │ By Campaign  │ By Source    │                   │
│  │ (pie/table)  │ (bar)        │ (treemap)    │                   │
│  └──────────────┴──────────────┴──────────────┘                   │
├─────────────────────────────────────────────────────────────────────┤
│  ROW 4: LIVE + ALERTS                                               │
│  ┌─────────────────────────────┬─────────────────────────────┐    │
│  │ Active calls (live tiles)   │ Alerts: low wallet, stale    │    │
│  │                             │ deals, overdue tasks         │    │
│  └─────────────────────────────┴─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Existing dashboard

The app already has `/dashboard` with `live-tiles.tsx`. **Extend** it with the
KPI cards and trend charts below, rather than creating a new page.

---

## 2. KPI Cards

### 2.1 Definitions

| KPI | Formula | Source |
|---|---|---|
| **Total calls** | Count of `Call` in range | `prisma.call.count` |
| **Connect rate** | `COMPLETED` calls / total calls | aggregate |
| **Revenue** | Sum of `billedPaise` for range | aggregate |
| **Gross margin** | (Revenue − telephony/STT/LLM/TTS cost) / Revenue | aggregate |
| **CSAT** | Avg `QaScore.totalScore / maxScore * 100` | aggregate |
| **Active users** | Distinct `Session.userId` active in range | aggregate |

### 2.2 Component with trend

```tsx
// src/app/(app)/dashboard/kpi-card.tsx
import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  trend?: { value: number; positive: boolean }; // % change vs previous period
  icon?: React.ReactNode;
  sparkline?: number[];
}

export function KpiCard({ label, value, trend, icon, sparkline }: KpiCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {trend && (
        <div className={`flex items-center gap-1 text-xs mt-1 ${trend.positive ? "text-green-600" : "text-red-600"}`}>
          {trend.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span>{Math.abs(trend.value)}% vs previous</span>
        </div>
      )}
      {sparkline && <Sparkline data={sparkline} />}
    </Card>
  );
}
```

### 2.3 Trend calculation

```ts
// src/lib/analytics.ts (extend)
export async function getKpiWithTrend(workspaceId: string, current: DateRange, previous: DateRange) {
  const [currentStats, previousStats] = await Promise.all([
    getCallStats(workspaceId, current),
    getCallStats(workspaceId, previous),
  ]);

  const pctChange = (curr: number, prev: number) =>
    prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);

  return {
    totalCalls: { value: currentStats.total, trend: pctChange(currentStats.total, previousStats.total) },
    connectRate: { value: currentStats.connectRate, trend: pctChange(currentStats.connectRate, previousStats.connectRate) },
    revenue: { value: currentStats.revenue, trend: pctChange(currentStats.revenue, previousStats.revenue) },
  };
}
```

---

## 3. Trend Charts

### 3.1 Calls over time (stacked bar)

```tsx
// src/app/(app)/dashboard/charts.tsx (extend)
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

export function CallsOverTime({ data }: { data: { date: string; inbound: number; outbound: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <XAxis dataKey="date" tickFormatter={formatDateShort} />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="inbound" stackId="a" fill="#3b82f6" name="Inbound" />
        <Bar dataKey="outbound" stackId="a" fill="#8b5cf6" name="Outbound" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

### 3.2 Revenue vs cost (dual-axis)

```tsx
export function RevenueVsCost({ data }: { data: { date: string; revenue: number; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis yAxisId="left" tickFormatter={(v) => formatINR(v, true)} />
        <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatINR(v, true)} />
        <Tooltip formatter={(v: number) => formatINR(v)} />
        <Legend />
        <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#10b981" name="Revenue" strokeWidth={2} />
        <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#ef4444" name="Cost" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### 3.3 Time-series query

Generate the daily/weekly buckets in SQL for efficiency:

```ts
// src/lib/analytics.ts (extend)
export async function getCallsTimeSeries(workspaceId: string, range: DateRange, granularity: "day" | "week" | "month" = "day") {
  const trunc = granularity === "day" ? "day" : granularity === "week" ? "week" : "month";
  return prisma.$queryRaw`
    SELECT
      date_trunc(${trunc}, "startedAt") AS date,
      COUNT(*) FILTER (WHERE direction = 'INBOUND') AS inbound,
      COUNT(*) FILTER (WHERE direction = 'OUTBOUND') AS outbound,
      SUM("billedPaise") AS revenue,
      SUM("costTelephonyPaise" + "costSttPaise" + "costLlmPaise" + "costTtsPaise") AS cost
    FROM "Call"
    WHERE "workspaceId" = ${workspaceId}
      AND "startedAt" >= ${range.start}
      AND "startedAt" <= ${range.end}
    GROUP BY date_trunc(${trunc}, "startedAt")
    ORDER BY date ASC
  `;
}
```

---

## 4. Breakdown Charts

### 4.1 By agent

```
┌──────────────────────────┐
│  CALLS BY AGENT          │
│  ┌─────────────────────┐ │
│  │ Clinic Receptionist │ │ 42%
│  │ ██████████████      │ │
│  │ Loan Telecaller     │ │ 31%
│  │ ██████████          │ │
│  │ Support Bot         │ │ 27%
│  │ █████████           │ │
│  └─────────────────────┘ │
└──────────────────────────┘
```

```ts
export async function getCallsByAgent(workspaceId: string, range: DateRange) {
  return prisma.call.groupBy({
    by: ["agentId"],
    where: { workspaceId, startedAt: { gte: range.start, lte: range.end } },
    _count: true,
    _sum: { billedPaise: true, durationSec: true },
  });
}
```

### 4.2 By campaign

Horizontal bar chart showing calls per campaign with conversion overlay.

### 4.3 By source (treemap)

Treemap of where calls come from: inbound DID, campaign, marketplace, API.

---

## 5. Live Dashboard (existing)

The existing `live-dashboard.tsx` and `/live` page show in-progress calls.
**Extend** with:

- WebSocket / SSE for real-time updates (currently polls)
- Supervisor actions (listen/whisper/barge) inline
- Queue depth indicator (calls waiting)

### 5.1 Real-time via Server-Sent Events

```ts
// src/app/api/dashboard/stream/route.ts (new)
export async function GET(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const interval = setInterval(async () => {
        const activeCalls = await getActiveCalls(ctx.workspaceId);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(activeCalls)}\n\n`));
      }, 3000); // 3s refresh
      req.signal.addEventListener("abort", () => { clearInterval(interval); controller.close(); });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
```

```tsx
// src/app/(app)/dashboard/live-tiles.tsx (extend to use SSE)
"use client";
useEffect(() => {
  const es = new EventSource("/api/dashboard/stream");
  es.onmessage = (e) => setCalls(JSON.parse(e.data));
  return () => es.close();
}, []);
```

---

## 6. Date Range Picker

A shared component for all analytics pages:

```tsx
// src/components/analytics/date-range-picker.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

const PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "This month", value: "month" },
  { label: "Last month", value: "lastmonth" },
  { label: "This quarter", value: "quarter" },
  { label: "Custom range...", value: "custom" },
];

export function DateRangePicker({ current }: { current: string }) {
  const router = useRouter();
  return (
    <Select value={current} onValueChange={(v) => router.push(`?range=${v}`)}>
      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
      <SelectContent>
        {PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

```ts
// src/lib/analytics.ts (extend)
export function getDateRange(preset: string): { start: Date; end: Date } {
  const now = new Date();
  switch (preset) {
    case "today": return { start: startOfDay(now), end: now };
    case "7d": return { start: subDays(now, 7), end: now };
    case "30d": return { start: subDays(now, 30), end: now };
    case "month": return { start: startOfMonth(now), end: now };
    case "lastmonth": return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
    case "quarter": return { start: startOfQuarter(now), end: now };
    default: return { start: subDays(now, 7), end: now };
  }
}
```

---

## 7. Personalization

- **Saved layouts**: let users pin/hide KPI cards (stored in user prefs).
- **Default range**: remember the last-used range per user.
- **Workspace selector**: for cross-workspace admin views (reseller).

---

## Next

→ [02 — Funnel & Cohort Analysis](02-funnel-and-cohort-analysis.md)