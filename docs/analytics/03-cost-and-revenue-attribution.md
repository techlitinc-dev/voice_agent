# 03 — Cost & Revenue Attribution

> **Goal:** Know exactly what every call costs, what it earns, and where the
> margin goes — per call, per agent, per campaign, per tenant.

---

## 1. Per-Call Cost Breakdown

The `Call` model already tracks 4 cost components:

| Field | What it measures |
|---|---|
| `costTelephonyPaise` | Vobiz per-minute charge for the SIP leg |
| `costSttPaise` | Sarvam speech-to-text cost |
| `costLlmPaise` | OpenRouter LLM token cost |
| `costTtsPaise` | Sarvam text-to-speech cost |
| `billedPaise` | What we charge the tenant (cost + markup) |

### 1.1 Margin per call

```
Margin = billedPaise − (telephony + stt + llm + tts)
Margin% = (Margin / billedPaise) × 100
```

### 1.2 Cost visualization

```
┌──────────────────────────────────────────────────────────┐
│  COST BREAKDOWN (last 30 days)                           │
│                                                          │
│  Telephony  ████████████████████₹34,000  (40%)          │
│  STT         █████████████₹21,000  (25%)                │
│  LLM         ██████████₹16,800  (20%)                   │
│  TTS         ████████₹12,600  (15%)                     │
│  ──────────────────────────────────────────              │
│  TOTAL COST  ₹84,400                                    │
│  REVENUE     ₹1,21,000 (billed)                         │
│  MARGIN      ₹36,600 (30%)                              │
└──────────────────────────────────────────────────────────┘
```

### 1.3 Donut chart component

```tsx
// src/app/(app)/analytics/cost/cost-breakdown.tsx
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

const COLORS = { telephony: "#3b82f6", stt: "#8b5cf6", llm: "#f59e0b", tts: "#10b981" };

export function CostBreakdown({ data }: { data: { name: string; value: number; key: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
          {data.map((d, i) => <Cell key={i} fill={COLORS[d.key]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => formatINR(v)} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

---

## 2. Cost per Agent

Some agents are more expensive (longer conversations, bigger LLM). Track:

| Agent | Calls | Avg cost/call | Avg duration | Cost/min |
|---|---|---|---|---|
| Loan Telecaller | 500 | ₹2.80 | 4m 12s | ₹0.67 |
| Clinic Receptionist | 300 | ₹1.20 | 1m 45s | ₹0.69 |
| Support Triage | 200 | ₹4.50 | 7m 30s | ₹0.60 |

```ts
export async function getCostByAgent(workspaceId: string, range: DateRange) {
  return prisma.$queryRaw`
    SELECT
      a.id, a.name,
      COUNT(*) AS calls,
      AVG(c."durationSec") AS avg_duration_sec,
      AVG(c."costTelephonyPaise" + c."costSttPaise" + c."costLlmPaise" + c."costTtsPaise") AS avg_cost_paise,
      AVG(c."billedPaise") AS avg_billed_paise,
      SUM(c."costTelephonyPaise") AS total_telephony,
      SUM(c."costSttPaise") AS total_stt,
      SUM(c."costLlmPaise") AS total_llm,
      SUM(c."costTtsPaise") AS total_tts
    FROM "Call" c
    JOIN "Agent" a ON a.id = c."agentId"
    WHERE c."workspaceId" = ${workspaceId} AND c."startedAt" BETWEEN ${range.start} AND ${range.end}
    GROUP BY a.id, a.name
    ORDER BY avg_cost_paise DESC
  `;
}
```

---

## 3. Cost per Campaign

ROI analysis per campaign:

| Campaign | Cost | Revenue (billed) | Margin | ROI |
|---|---|---|---|---|
| Aug EMI | ₹14,000 | ₹22,000 | ₹8,000 (57%) | 1.57× |
| Reactivation | ₹6,300 | ₹8,100 | ₹1,800 (22%) | 1.29× |
| Product Launch | ₹4,200 | ₹6,000 | ₹1,800 (30%) | 1.43× |

```ts
export async function getCampaignROI(workspaceId: string, range: DateRange) {
  return prisma.$queryRaw`
    SELECT
      cmp.id, cmp.name,
      COUNT(c.id) AS calls,
      SUM(c."costTelephonyPaise" + c."costSttPaise" + c."costLlmPaise" + c."costTtsPaise") AS total_cost,
      SUM(c."billedPaise") AS revenue,
      SUM(c."billedPaise") - SUM(c."costTelephonyPaise" + c."costSttPaise" + c."costLlmPaise" + c."costTtsPaise") AS margin
    FROM "Call" c
    JOIN "Campaign" cmp ON cmp.id = c."campaignId"
    WHERE c."workspaceId" = ${workspaceId} AND c."startedAt" BETWEEN ${range.start} AND ${range.end}
    GROUP BY cmp.id, cmp.name
  `;
}
```

---

## 4. Revenue Recognition

### 4.1 Wallet debit → revenue

When a call completes, the wallet is debited `billedPaise`. This is **recognized
revenue**. Track:

| Metric | Formula |
|---|---|
| Recognized revenue | `SUM(billedPaise) WHERE status=COMPLETED` |
| Pending revenue | Active calls × est. cost |
| Deferred revenue | Wallet top-ups not yet consumed (`Wallet.balancePaise`) |
| Bad debt | Top-ups that expire unused (after 12 months) |

### 4.2 MRR/ARR

Monthly recurring revenue from subscriptions + usage:

```ts
export async function getMRR(workspaceId: string) {
  const [subscription, usage] = await Promise.all([
    prisma.subscription.findFirst({ where: { workspaceId }, include: { plan: true } }),
    prisma.call.aggregate({
      where: { workspaceId, startedAt: { gte: startOfMonth(new Date()) } },
      _sum: { billedPaise: true },
    }),
  ]);
  const planPaise = subscription?.plan.monthlyPricePaise || 0;
  const usagePaise = usage._sum.billedPaise || 0;
  return { planMrr: planPaise, usageMrr: usagePaise, totalMrr: planPaise + usagePaise };
}
```

---

## 5. Profitability per Tenant (reseller view)

For reseller accounts, show profitability per child workspace:

| Child workspace | Revenue | Cost | Margin | Margin% | Status |
|---|---|---|---|---|---|
| Clinic A | ₹45,000 | ₹28,000 | ₹17,000 | 38% | ✓ Healthy |
| Clinic B | ₹12,000 | ₹11,000 | ₹1,000 | 8% | ⚠ Low margin |
| Clinic C | ₹3,000 | ₹4,500 | −₹1,500 | −50% | ✗ Losing money |

---

## Next

→ [04 — Custom Reports Builder](04-custom-reports-builder.md)