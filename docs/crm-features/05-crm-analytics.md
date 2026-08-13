# 05 — CRM Analytics

> **Goal:** Dashboards and reports that measure pipeline health, conversion
> rates, sales rep performance, and revenue — the metrics that matter for a
> CRM.

---

## 1. CRM Dashboard (`/crm/analytics`)

A dedicated analytics page for CRM metrics, separate from the call analytics.

### 1.1 KPI cards (top row)

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ OPEN PIPELINE│ WON THIS    │ WIN RATE    │ AVG DEAL    │
│  ₹24,30,000 │  ₹12,00,000 │    42%      │  ₹3,50,000  │
│  28 deals   │  12 deals   │ ↑ 5% vs last│ ↑ ₹50K      │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

```tsx
// src/app/(app)/crm/analytics/page.tsx
export default async function CrmAnalyticsPage({ searchParams }) {
  const range = getDateRange(searchParams);
  const stats = await getCrmStats(ctx.workspaceId, range);

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open Pipeline" value={formatINR(stats.openPipelineValue)} sub={`${stats.openDealCount} deals`} />
        <StatCard label="Won (period)" value={formatINR(stats.wonValue)} sub={`${stats.wonCount} deals`} trend={stats.wonTrend} />
        <StatCard label="Win Rate" value={`${stats.winRate}%`} trend={stats.winRateTrend} />
        <StatCard label="Avg Deal Size" value={formatINR(stats.avgDealSize)} trend={stats.avgDealTrend} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card><CardContent><FunnelChart stages={stats.funnel} /></CardContent></Card>
        <Card><CardContent><RevenueOverTime data={stats.revenueTimeSeries} /></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card><CardContent><ConversionBySource data={stats.bySource} /></CardContent></Card>
        <Card><CardContent><SalesRepLeaderboard reps={stats.repPerformance} /></CardContent></Card>
      </div>

      <Card><CardContent><DealsByStageHeatmap data={stats.stageAging} /></CardContent></Card>
    </div>
  );
}
```

---

## 2. Pipeline Funnel

Visualize conversion at each stage:

```
New ──────────────────── 100 contacts (₹40L)
   │ 60% conversion
Contacted ────────────── 60 contacts (₹28L)
   │ 50% conversion
Qualified ────────────── 30 contacts (₹18L)
   │ 67% conversion
Negotiation ──────────── 20 contacts (₹14L)
   │ 60% conversion
Won ──────────────────── 12 contacts (₹12L)
```

```tsx
// src/app/(app)/crm/analytics/funnel-chart.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export function FunnelChart({ stages }: { stages: StageFunnel[] }) {
  const data = stages.map((s) => ({ name: s.name, count: s.dealCount, value: s.valuePaise, color: s.color }));
  const maxCount = Math.max(...data.map((d) => d.count));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" width={100} />
        <Tooltip content={({ active, payload }) => active && payload ? (
          <div className="bg-background border rounded p-2 text-sm">
            <p>{payload[0].payload.name}: {payload[0].payload.count} deals</p>
            <p className="text-muted-foreground">{formatINR(payload[0].payload.value)}</p>
          </div>
        ) : null} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

### Stage conversion rates

| Stage → Next | Count | Rate | Avg days | Insight |
|---|---|---|---|---|
| New → Contacted | 100→60 | 60% | 1.2d | Healthy |
| Contacted → Qualified | 60→30 | 50% | 3.5d | Focus area |
| Qualified → Negotiation | 30→20 | 67% | 5.1d | Strong |
| Negotiation → Won | 20→12 | 60% | 8.2d | Healthy |
| **Overall** | 100→12 | **12%** | 18.0d | — |

---

## 3. Revenue Analytics

### 3.1 Revenue over time

Line/area chart of won-deal value by week/month:

```tsx
export function RevenueOverTime({ data }: { data: { date: string; valuePaise: number; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" />
        <YAxis tickFormatter={(v) => formatINR(v, true)} width={80} />
        <Tooltip formatter={(v: number) => formatINR(v)} />
        <Area dataKey="valuePaise" stroke="#10b981" fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

### 3.2 Revenue by source

Where do closed-won deals come from?

| Source | Deals | Revenue | Avg Size |
|---|---|---|---|
| Inbound | 8 | ₹8,00,000 | ₹1,00,000 |
| Campaign: "Aug EMI" | 3 | ₹3,50,000 | ₹1,16,666 |
| Manual | 1 | ₹50,000 | ₹50,000 |

### 3.3 Revenue forecast

Weighted pipeline projection (from [02-pipeline §6](02-pipeline-and-deals.md#6-forecast-view)):

```
This month forecast:  ₹15,88,000 (weighted)
Next month forecast:  ₹22,40,000 (based on expectedClose)
```

---

## 4. Sales Rep Performance

### 4.1 Leaderboard

| Rep | Deals Won | Revenue | Win Rate | Avg Cycle | Calls Made |
|---|---|---|---|---|---|
| Priya | 6 | ₹7,20,000 | 55% | 14d | 142 |
| Rahul | 4 | ₹3,80,000 | 40% | 21d | 98 |
| Amit | 2 | ₹1,00,000 | 33% | 28d | 67 |

```ts
// src/app/(app)/crm/analytics/queries.ts
async function getRepPerformance(workspaceId: string, range: DateRange) {
  const reps = await prisma.deal.groupBy({
    by: ["ownerUserId"],
    where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
    _count: true,
    _sum: { valuePaise: true },
  });

  return Promise.all(reps.map(async (r) => {
    const user = await prisma.user.findUnique({ where: { id: r.ownerUserId! } });
    const totalAssigned = await prisma.deal.count({ where: { workspaceId, ownerUserId: r.ownerUserId } });
    const callsMade = await prisma.call.count({
      where: { workspaceId, /* fromNumber in rep's contacts */, direction: "OUTBOUND" },
    });
    return {
      name: user?.fullName || "Unassigned",
      dealsWon: r._count,
      revenue: r._sum.valuePaise || 0,
      winRate: Math.round((r._count / totalAssigned) * 100),
      callsMade,
    };
  }));
}
```

### 4.2 Rep activity tracking

Per-rep drill-down showing:

- Calls made per day (bar chart)
- Tasks completed vs overdue
- Deals touched per week
- Average response time (call → first action)

---

## 5. Stage Aging Report

Identify **stale deals** stuck in a stage too long:

| Deal | Current Stage | Days in Stage | Owner | Action |
|---|---|---|---|---|
| Home loan — Ramesh | Qualified | 12 days | Priya | ⚠ Follow up |
| Car loan — Priya | Contacted | 18 days | Rahul | ⚠ Stale |
| Biz loan — Acme | Negotiation | 25 days | Amit | ⚠ At risk |

```ts
async function getStageAging(workspaceId: string) {
  const deals = await prisma.deal.findMany({
    where: { workspaceId, status: "OPEN" },
    include: { stage: true, owner: true },
  });

  // Compute days since last stage change (from Activity log)
  return Promise.all(deals.map(async (d) => {
    const lastStageChange = await prisma.activity.findFirst({
      where: { dealId: d.id, type: "STAGE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    const since = lastStageChange?.createdAt || d.createdAt;
    const daysInStage = Math.floor((Date.now() - since.getTime()) / 86400000);
    return { ...d, daysInStage, lastActivityAt: since };
  }));
}
```

**Alerts**:
- Deal in same stage > 14 days → yellow warning
- Deal in same stage > 21 days → red alert + auto-create follow-up task

---

## 6. Cohort Analysis

Track deal cohorts by creation month to measure velocity over time:

| Created | Count | →Contacted (avg days) | →Qualified | →Won | Win rate |
|---|---|---|---|---|---|
| Jul 2026 | 45 | 1.1d | 3.2d | 12.5d | 27% |
| Jun 2026 | 38 | 1.3d | 4.1d | 15.8d | 24% |
| May 2026 | 32 | 1.5d | 3.8d | 14.2d | 31% |

This shows whether sales velocity is improving over time.

---

## 7. Voice-to-Pipeline Attribution

Unique to a voice-native CRM: **which calls produced deals?**

| Metric | Value |
|---|---|
| Calls that created a deal | 28 / 142 (20%) |
| Calls that moved a deal stage | 67 / 142 (47%) |
| Avg time from first call → deal creation | 2.3 days |
| Revenue attributed to AI calls | ₹18,40,000 (100% of won) |

```ts
async function getVoiceAttribution(workspaceId: string, range: DateRange) {
  const dealsFromCalls = await prisma.deal.count({
    where: { workspaceId, createdFromCallId: { not: null }, closedAt: { gte: range.start, lte: range.end } },
  });
  const revenueFromCalls = await prisma.deal.aggregate({
    where: { workspaceId, createdFromCallId: { not: null }, status: "WON" },
    _sum: { valuePaise: true },
  });
  // ... more attribution queries
}
```

---

## 8. Exportable Reports

Every analytics view should be **exportable** as:

- **CSV** (for spreadsheet analysis)
- **PDF** (for stakeholder sharing)
- **Scheduled email** (existing `ScheduledDigest` model)

```tsx
// Add export buttons to each analytics page
<Button variant="outline" onClick={() => exportCsv("crm-funnel", range)}>
  <Download className="w-4 h-4 mr-2" /> Export CSV
</Button>
```

Use the existing `/api/exports` route pattern.

---

## 9. Query Patterns

### 9.1 Centralized analytics queries

Create a queries file that all analytics components import from:

```ts
// src/lib/crm/queries.ts (new)
import { prisma } from "@/lib/db";

export async function getCrmStats(workspaceId: string, range: DateRange) {
  const [openDeals, wonDeals, lostDeals, totalDeals] = await Promise.all([
    prisma.deal.aggregate({ where: { workspaceId, status: "OPEN" }, _sum: { valuePaise: true }, _count: true }),
    prisma.deal.aggregate({ where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } }, _sum: { valuePaise: true }, _count: true }),
    prisma.deal.aggregate({ where: { workspaceId, status: "LOST", closedAt: { gte: range.start, lte: range.end } }, _count: true }),
    prisma.deal.count({ where: { workspaceId, createdAt: { gte: range.start, lte: range.end } } }),
  ]);

  const winRate = wonDeals._count + lostDeals._count > 0
    ? Math.round((wonDeals._count / (wonDeals._count + lostDeals._count)) * 100)
    : 0;

  return {
    openPipelineValue: openDeals._sum.valuePaise || 0,
    openDealCount: openDeals._count,
    wonValue: wonDeals._sum.valuePaise || 0,
    wonCount: wonDeals._count,
    winRate,
    avgDealSize: wonDeals._count > 0 ? Math.round((wonDeals._sum.valuePaise || 0) / wonDeals._count) : 0,
  };
}
```

### 9.2 Caching analytics

CRM analytics are expensive to compute. Cache with Redis (see
[production-readiness/03 §3](../production-readiness/03-scalability-and-performance.md#3-caching-strategy)):

```ts
const stats = await cache(`crm:stats:${workspaceId}:${rangeKey}`, 300, () =>
  getCrmStats(workspaceId, range)
);
```

Invalidate on any deal mutation (create, stage change, close).

---

← Back to [CRM Features](../README.md#crm-features) | [Detailed Analytics →](../analytics/01-executive-dashboard.md)