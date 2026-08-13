# 02 — Funnel & Cohort Analysis

> **Goal:** Measure how contacts move through the funnel (call → lead → deal →
> won) and how cohorts behave over time — the analytics that reveal **where
> revenue leaks**.

---

## 1. Call-to-Deal Funnel

The end-to-end funnel from first touch to closed-won:

```
┌─────────────────────────────────────────────────────────────────┐
│  STAGE            COUNT   CONV%    ₹ VALUE     AVG TIME         │
├─────────────────────────────────────────────────────────────────┤
│  Calls made      1,000    —       —           —                 │
│     ↓ 45%                                                  │
│  Answered          450    45%     —           0 (instant)       │
│     ↓ 67%                                                  │
│  Engaged > 60s    300    67%     —           1.2 min            │
│     ↓ 40%                                                  │
│  Qualified (HOT)  120    40%     —           4.5 min            │
│     ↓ 58%                                                  │
│  Deal created      70    58%     ₹1.4 Cr    2.3 days           │
│     ↓ 31%                                                  │
│  Deal won          22    31%     ₹22 L     18 days             │
└─────────────────────────────────────────────────────────────────┘
│  OVERALL: 2.2% call-to-win rate, ₹22 L revenue from 1000 calls  │
└─────────────────────────────────────────────────────────────────┘
```

### Funnel query

```ts
// src/lib/analytics/funnel.ts (new)
export async function getCallToDealFunnel(workspaceId: string, range: DateRange) {
  const [totalCalls, answered, engaged, qualified, dealsCreated, dealsWon] = await Promise.all([
    prisma.call.count({ where: { workspaceId, startedAt: { gte: range.start, lte: range.end } } }),
    prisma.call.count({ where: { workspaceId, status: "COMPLETED", startedAt: { gte: range.start, lte: range.end } } }),
    prisma.call.count({ where: { workspaceId, status: "COMPLETED", durationSec: { gte: 60 }, startedAt: { gte: range.start, lte: range.end } } }),
    prisma.call.count({ where: { workspaceId, interestScore: "HOT", startedAt: { gte: range.start, lte: range.end } } }),
    prisma.deal.count({ where: { workspaceId, createdAt: { gte: range.start, lte: range.end } } }),
    prisma.deal.aggregate({
      where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
      _count: true,
      _sum: { valuePaise: true },
    }),
  ]);

  return [
    { stage: "Calls made", count: totalCalls, conversion: null },
    { stage: "Answered", count: answered, conversion: pct(answered, totalCalls) },
    { stage: "Engaged > 60s", count: engaged, conversion: pct(engaged, answered) },
    { stage: "Qualified (HOT)", count: qualified, conversion: pct(qualified, engaged) },
    { stage: "Deal created", count: dealsCreated, conversion: pct(dealsCreated, qualified) },
    { stage: "Deal won", count: dealsWon._count, conversion: pct(dealsWon._count, dealsCreated), valuePaise: dealsWon._sum.valuePaise },
  ];
}
```

### Funnel chart component

```tsx
// src/components/analytics/funnel-chart.tsx
export function CallToDealFunnel({ stages }: { stages: FunnelStage[] }) {
  const maxCount = stages[0].count; // first stage is widest
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const widthPct = (s.count / maxCount) * 100;
        const nextStage = stages[i + 1];
        const dropoff = nextStage ? ((s.count - nextStage.count) / s.count) * 100 : 0;
        return (
          <div key={s.stage}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{s.stage}</span>
              <span className="text-sm text-muted-foreground">
                {s.count.toLocaleString()} {s.conversion !== null && `(${s.conversion}%)`}
              </span>
            </div>
            <div className="relative h-10 bg-muted rounded-md overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-500"
                style={{ width: `${widthPct}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-end pr-3 text-xs font-medium">
                {s.valuePaise && formatINR(s.valuePaise)}
              </span>
            </div>
            {nextStage && (
              <p className="text-xs text-muted-foreground mt-1">
                ↓ {dropoff.toFixed(0)}% drop-off to "{nextStage.stage}"
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

## 2. Drop-off Analysis

**Where are we losing people?** Identify the biggest leak:

```
┌────────────────────────────────────────────────────────────┐
│  BIGGEST DROP-OFFS                                         │
├────────────────────────────────────────────────────────────┤
│  ⚠ "Calls made → Answered": 55% drop-off                 │
│     → Most calls go unanswered. Try: different time,      │
│       more retries, better caller-ID reputation           │
│                                                            │
│  ⚠ "Qualified → Deal created": 42% drop-off              │
│     → HOT leads not converting to deals. Try: auto-deal   │
│       creation for HOT, faster follow-up                  │
└────────────────────────────────────────────────────────────┘
```

The UI should automatically surface the stage with the largest drop-off and
suggest actions.

---

## 3. Cohort Analysis

### 3.1 What is a cohort?

A **cohort** is a group of contacts who share a common time-based experience —
typically "contacts first called in month X". We then track their behavior over
subsequent weeks/months.

### 3.2 Cohort retention matrix

```
                    Week 0   Week 1   Week 2   Week 4   Week 8
Jul 2026 cohort     120 (100%) 45 (38%) 28 (23%) 15 (13%) 8 (7%)
Jun 2026 cohort      98 (100%) 40 (41%) 25 (26%) 14 (14%) 9 (9%)
May 2026 cohort      85 (100%) 30 (35%) 22 (26%) 12 (14%) 7 (8%)
```

This shows: "Of 120 people first called in July, 38% had a second call within a
week, 23% within two weeks, etc."

### 3.3 Cohort query

```ts
// src/lib/analytics/cohorts.ts (new)
export async function getContactCohorts(workspaceId: string, cohortBy: "week" | "month" = "month") {
  // Step 1: Assign each contact to a cohort based on their first call date
  const cohorts = await prisma.$queryRaw`
    WITH first_calls AS (
      SELECT
        c.id AS "contactId",
        c.phone,
        date_trunc(${cohortBy}, MIN(cal."startedAt")) AS cohort_month
      FROM "Contact" c
      JOIN "Call" cal ON cal."fromNumber" = c.phone AND cal."workspaceId" = c."workspaceId"
      WHERE c."workspaceId" = ${workspaceId}
      GROUP BY c.id, c.phone
    )
    SELECT
      fc.cohort_month,
      COUNT(DISTINCT fc."contactId") AS cohort_size,
      -- How many had a call in week N after their first
      COUNT(DISTINCT CASE WHEN EXTRACT(WEEK FROM cal."startedAt" - fc.cohort_month) = 0 THEN fc."contactId" END) AS week_0,
      COUNT(DISTINCT CASE WHEN EXTRACT(WEEK FROM cal."startedAt" - fc.cohort_month) = 1 THEN fc."contactId" END) AS week_1,
      COUNT(DISTINCT CASE WHEN EXTRACT(WEEK FROM cal."startedAt" - fc.cohort_month) = 2 THEN fc."contactId" END) AS week_2,
      COUNT(DISTINCT CASE WHEN EXTRACT(WEEK FROM cal."startedAt" - fc.cohort_month) BETWEEN 3 AND 4 THEN fc."contactId" END) AS week_4,
      COUNT(DISTINCT CASE WHEN EXTRACT(WEEK FROM cal."startedAt" - fc.cohort_month) BETWEEN 5 AND 8 THEN fc."contactId" END) AS week_8
    FROM first_calls fc
    LEFT JOIN "Call" cal ON cal."fromNumber" = fc.phone AND cal."workspaceId" = ${workspaceId}
    GROUP BY fc.cohort_month
    ORDER BY fc.cohort_month DESC
  `;
  return cohorts;
}
```

### 3.4 Cohort heatmap

```tsx
// src/components/analytics/cohort-heatmap.tsx
export function CohortHeatmap({ cohorts }: { cohorts: CohortRow[] }) {
  // Color intensity = retention %
  const color = (pct: number) => {
    if (pct === 0) return "bg-muted";
    if (pct < 10) return "bg-blue-200";
    if (pct < 25) return "bg-blue-300";
    if (pct < 40) return "bg-blue-400";
    if (pct < 60) return "bg-blue-500";
    return "bg-blue-600";
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="text-left">Cohort</th>
          <th>Size</th>
          <th>Week 0</th>
          <th>Week 1</th>
          <th>Week 2</th>
          <th>Week 4</th>
          <th>Week 8</th>
        </tr>
      </thead>
      <tbody>
        {cohorts.map((row) => (
          <tr key={row.cohortMonth}>
            <td>{formatMonth(row.cohortMonth)}</td>
            <td className="text-center">{row.cohortSize}</td>
            {["week0", "week1", "week2", "week4", "week8"].map((wk) => {
              const pct = Math.round((row[wk] / row.cohortSize) * 100);
              return (
                <td key={wk} className={`text-center ${color(pct)} text-white font-medium`}>
                  {row[wk]} ({pct}%)
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## 4. Time-to-Conversion Analysis

How long does it take from first call → deal won?

```
┌──────────────────────────────────────────────────────┐
│  DAYS TO CLOSE (distribution)                        │
│                                                      │
│  0-3 days:  ████ 4 deals (18%)                      │
│  4-7 days:  ██████████ 9 deals (41%)  ← mode        │
│  8-14 days: █████ 5 deals (23%)                     │
│  15-30 days:██ 2 deals (9%)                         │
│  30+ days:  ██ 2 deals (9%)                         │
│                                                      │
│  Median: 6 days                                      │
│  Average: 9.3 days                                   │
└──────────────────────────────────────────────────────┘
```

```ts
export async function getTimeToConversion(workspaceId: string, range: DateRange) {
  const deals = await prisma.deal.findMany({
    where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
    include: { createdFromCall: true },
  });

  const daysToClose = deals
    .filter((d) => d.createdFromCall)
    .map((d) => Math.floor((d.closedAt!.getTime() - d.createdFromCall!.startedAt.getTime()) / 86400000));

  // Bucket into ranges
  const buckets = { "0-3": 0, "4-7": 0, "8-14": 0, "15-30": 0, "30+": 0 };
  for (const days of daysToClose) {
    if (days <= 3) buckets["0-3"]++;
    else if (days <= 7) buckets["4-7"]++;
    else if (days <= 14) buckets["8-14"]++;
    else if (days <= 30) buckets["15-30"]++;
    else buckets["30+"]++;
  }

  return { buckets, median: median(daysToClose), average: avg(daysToClose) };
}
```

---

## 5. Campaign Funnel Comparison

Compare funnel performance across campaigns:

| Campaign | Calls | Answered | HOT | Deals | Won | Call-to-Win |
|---|---|---|---|---|---|---|
| Aug EMI Reminder | 500 | 230 (46%) | 75 (33%) | 40 | 12 | 2.4% |
| Reactivation | 300 | 120 (40%) | 22 (18%) | 8 | 2 | 0.7% |
| New Product Launch | 200 | 100 (50%) | 45 (45%) | 30 | 8 | 4.0% |

This reveals which campaign types produce the best ROI.

---

## 6. Agent Funnel Comparison

Which AI agents drive the most pipeline?

| Agent | Calls | HOT rate | Deals created | Revenue/deal | Best at |
|---|---|---|---|---|---|
| Loan Telecaller | 500 | 25% | 40 | ₹3.5L | Volume |
| Clinic Receptionist | 300 | 40% | 0 | — | Bookings (no deal) |
| Support Triage | 200 | 15% | 5 | ₹1.2L | Upsell |

---

## Next

→ [03 — Cost & Revenue Attribution](03-cost-and-revenue-attribution.md)