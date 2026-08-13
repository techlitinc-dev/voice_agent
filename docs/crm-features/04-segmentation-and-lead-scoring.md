# 04 — Segmentation & Lead Scoring

> **Goal:** Let users build dynamic contact segments ("Hot leads in Pune", "EMI
> overdue > 30 days") and automatically score every lead 0–100 so sales reps
> prioritize the right people.

---

## 1. Segmentation Engine

### 1.1 What is a segment?

A **segment** is a saved query that dynamically matches contacts based on rules.
Segments are used for:

- Filtering the contacts list
- Targeting campaigns (existing `ContactList` can be populated from a segment)
- Building analytics cohorts
- Triggering automations ("when contact enters segment X, create task Y")

### 1.2 Segment builder UI

```
┌──────────────────────────────────────────────────────────────────┐
│  NEW SEGMENT                                                     │
│  Name: [Hot leads Pune                              ]            │
│  Match: (•) All conditions   ( ) Any condition                   │
├──────────────────────────────────────────────────────────────────┤
│  CONDITIONS                                                      │
│  ┌────────────────────┬─────────┬────────────────────┐ [✕]      │
│  │ Last call interest │   is    │ HOT                │          │
│  └────────────────────┴─────────┴────────────────────┘          │
│  ┌────────────────────┬─────────┬────────────────────┐ [✕]      │
│  │ City (attribute)   │   is    │ Pune               │          │
│  └────────────────────┴─────────┴────────────────────┘          │
│  ┌────────────────────┬─────────┬────────────────────┐ [✕]      │
│  │ Total calls        │  ≥      │ 2                  │          │
│  └────────────────────┴─────────┴────────────────────┘          │
│  [+ Add condition]                                               │
├──────────────────────────────────────────────────────────────────┤
│  PREVIEW: 47 contacts match (showing first 5)                    │
│  • Ramesh Kumar  +91 98XXX  •  HOT  •  3 calls                   │
│  • Priya Sharma  +91 99XXX  •  HOT  •  2 calls                   │
│  • ...                                                           │
├──────────────────────────────────────────────────────────────────┤
│            [Cancel]  [Save Segment]  [Save & Create Campaign]    │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 Rule schema

```ts
// src/lib/crm/segments.ts (new)
type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "exists";

interface Condition {
  field: SegmentField;   // what to compare
  op: Operator;          // how to compare
  value: string | number | boolean | string[]; // what to compare against
}

interface SegmentRules {
  matchMode: "all" | "any";  // AND or OR
  conditions: Condition[];
}
```

### 1.4 Available fields

| Field | Source | Type |
|---|---|---|
| `contact.name` | Contact | string |
| `contact.phone` | Contact | string |
| `contact.city` | Contact.attributes | string |
| `contact.consentAt` | Contact | date |
| `contact.optOutAt` | Contact | date |
| `contact.dnc` | Contact | boolean |
| `contact.createdAt` | Contact | date |
| `contact.leadScore` | LeadScore | number (0–100) |
| `contact.leadGrade` | LeadScore | string (A/B/C/D) |
| `call.count` | aggregated Call | number |
| `call.lastInterestScore` | latest Call | enum (HOT/WARM/COLD) |
| `call.lastOutcome` | latest Call | string |
| `call.lastCallAt` | latest Call | date |
| `call.totalDurationSec` | aggregated Call | number |
| `deal.count` | aggregated Deal | number |
| `deal.openValuePaise` | aggregated Deal | number |
| `deal.stage` | latest Deal | string |
| `campaign.lastContacted` | CampaignContact | date |
| `task.pendingCount` | aggregated Task | number |
| Custom attribute | Contact.attributes.* | any |

### 1.5 Evaluation (SQL translation)

For performance, translate rules into a Prisma `where` clause rather than
fetching all contacts and filtering in JS:

```ts
// src/lib/crm/segments.ts
function buildWhereClause(rules: SegmentRules, workspaceId: string): Prisma.ContactWhereInput {
  const connectors = rules.matchMode === "all" ? "AND" : "OR";
  const conditions = rules.conditions.map((c) => translateCondition(c));
  return { workspaceId, [connectors]: conditions };
}

function translateCondition(c: Condition): Prisma.ContactWhereInput {
  switch (c.field) {
    case "contact.name":
      return c.op === "eq" ? { name: c.value as string } : {};
    case "contact.city":
      return { attributes: { path: ["city"], equals: c.value } }; // Json path query
    case "call.lastInterestScore":
      return {
        campaignContacts: { some: { lastCall: { interestScore: c.value as InterestScore } } },
      };
    case "call.count":
      // requires a subquery / having — use raw SQL or aggregate
      return {}; // see note below
    // ... etc
  }
}
```

For complex aggregations (`call.count >= 2`), fall back to a two-step query:

```ts
// Step 1: get matching contact IDs via raw SQL
const ids = await prisma.$queryRaw<Array<{id: string}>>`
  SELECT c.id FROM contacts c
  LEFT JOIN calls cal ON cal."workspaceId" = c."workspaceId" AND cal."fromNumber" = c.phone
  WHERE c."workspaceId" = ${workspaceId}
  GROUP BY c.id
  HAVING COUNT(cal.id) >= ${minCalls}
`;
// Step 2: fetch contacts
const contacts = await prisma.contact.findMany({ where: { id: { in: ids.map(r => r.id) } } });
```

### 1.6 Segment evaluation worker

Dynamic segments re-evaluate periodically (every 15 min) and cache the member
count:

```ts
// src/worker/cron.ts (extend)
async function refreshSegments() {
  const segments = await prisma.segment.findMany({ where: { isDynamic: true } });
  for (const segment of segments) {
    const where = buildWhereClause(segment.rules as SegmentRules, segment.workspaceId);
    const count = await prisma.contact.count({ where });
    await prisma.segment.update({
      where: { id: segment.id },
      data: { memberCount: count, lastEvalAt: new Date() },
    });
  }
}
```

### 1.7 Segment-triggered automations

```ts
// "When contact enters segment X, create task / send WhatsApp / start campaign"
interface SegmentAutomation {
  segmentId: string;
  trigger: "enter" | "exit";
  action:
    | { type: "create_task"; taskType: TaskType; title: string; delayHours: number }
    | { type: "send_whatsapp"; templateId: string }
    | { type: "start_campaign"; campaignId: string }
    | { type: "notify_user"; userIds: string[] };
}
```

---

## 2. Lead Scoring

### 2.1 Scoring factors

The `LeadScore` model holds a 0–100 score, computed from multiple factors:

| Factor | Weight | Source | Points logic |
|---|---|---|---|
| **Intent** | 30 | Latest call `interestScore` | HOT=30, WARM=15, COLD=0 |
| **Engagement** | 25 | Call count + duration | 1 call=5, 2-3=10, 4-6=15, 7+=25 |
| **Recency** | 15 | Last call date | < 24h=15, < 3d=12, < 7d=8, < 30d=4, else 0 |
| **Pipeline position** | 15 | Deal stage progress | Qualified=5, Negotiation=10, Won=15 |
| **Deal value** | 10 | Open deal value | < ₹50K=2, < ₹5L=5, < ₹50L=8, else 10 |
| **Responsiveness** | 5 | Inbound vs outbound ratio | > 50% inbound=5, else 0 |

**Total max = 100.**

### 2.2 Grade mapping

| Score | Grade | Color | Label |
|---|---|---|---|
| 80–100 | **A** | Green | "Sales-ready — prioritize" |
| 60–79 | **B** | Blue | "Warm — nurture" |
| 40–59 | **C** | Amber | "Lukewarm — re-engage" |
| 0–39 | **D** | Gray | "Cold — long-term" |

### 2.3 Scoring worker

```ts
// src/worker/cron.ts (extend)
// OR src/lib/crm/scoring.ts (called from postcall worker)

export async function recomputeLeadScore(workspaceId: string, contactId: string) {
  const contact = await prisma.contact.findFirstOrThrow({
    where: { id: contactId, workspaceId },
    include: {
      campaignContacts: { include: { lastCall: true } },
      deals: { where: { status: "OPEN" }, include: { stage: true } },
    },
  });

  // Aggregate call stats
  const callStats = await prisma.call.aggregate({
    where: { fromNumber: contact.phone, workspaceId },
    _count: true,
    _sum: { durationSec: true },
    _max: { startedAt: true },
  });

  const lastCall = await prisma.call.findFirst({
    where: { fromNumber: contact.phone, workspaceId },
    orderBy: { startedAt: "desc" },
  });

  // Compute factors
  const factors = {
    intent: scoreIntent(lastCall?.interestScore),              // 0-30
    engagement: scoreEngagement(callStats._count),             // 0-25
    recency: scoreRecency(callStats._max?.startedAt),          // 0-15
    pipeline: scorePipeline(contact.deals),                    // 0-15
    value: scoreValue(contact.deals),                          // 0-10
    responsiveness: scoreResponsiveness(callStats._count, /* inboundCount */), // 0-5
  };

  const score = Object.values(factors).reduce((a, b) => a + b, 0);
  const grade = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D";
  const reasons = buildReasons(factors, lastCall);

  await prisma.leadScore.upsert({
    where: { contactId },
    create: { workspaceId, contactId, score, grade, reasons, factors },
    update: { score, grade, reasons, factors, computedAt: new Date() },
  });
}

function scoreIntent(interest?: InterestScore): number {
  if (interest === "HOT") return 30;
  if (interest === "WARM") return 15;
  return 0;
}

function scoreRecency(lastCallAt?: Date | null): number {
  if (!lastCallAt) return 0;
  const hoursAgo = (Date.now() - lastCallAt.getTime()) / 3600000;
  if (hoursAgo < 24) return 15;
  if (hoursAgo < 72) return 12;
  if (hoursAgo < 168) return 8;
  if (hoursAgo < 720) return 4;
  return 0;
}
```

### 2.4 Recompute triggers

Recompute a contact's score when:

- A call completes (post-call worker calls `recomputeLeadScore`)
- A deal is created or stage changed
- A task is completed
- Periodically (nightly job recomputes all contacts touched in the last 7 days)

### 2.5 Lead score in the UI

Show the score prominently:

```
Contact card:                    Deal card:
┌─────────────────────┐          ┌───────────────────┐
│ Ramesh Kumar        │          │ Home loan ₹25L    │
│ +91 98XXX XXXXX     │          │ ┌─┐               │
│                     │          │ │A│ 92             │
│ ┌───┐               │          │ └─┘ Excellent     │
│ │ A │ 92  Excellent │          │                   │
│ └───┘               │          │ 🔥 HOT            │
└─────────────────────┘          └───────────────────┘
```

```tsx
// src/components/crm/lead-score-badge.tsx
export function LeadScoreBadge({ score }: { score: LeadScore }) {
  const colors = { A: "bg-green-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-gray-400" };
  const labels = { A: "Excellent", B: "Good", C: "Average", D: "Cold" };
  return (
    <div className="flex items-center gap-2">
      <div className={`w-8 h-8 rounded-lg ${colors[score.grade]} text-white flex items-center justify-center font-bold`}>
        {score.grade}
      </div>
      <div>
        <p className="text-sm font-semibold">{score.score}/100</p>
        <p className="text-xs text-muted-foreground">{labels[score.grade]}</p>
      </div>
    </div>
  );
}
```

### 2.6 Lead score breakdown

On the contact detail page, show the factor breakdown:

```
┌─────────────────────────────────────┐
│  LEAD SCORE: 78/100  Grade: B       │
│  ┌─────────────────────────────┐    │
│  │ ██████████████░░░░░░  78%   │    │
│  └─────────────────────────────┘    │
│                                     │
│  Intent          30/30  ████████████│
│  Engagement      20/25  ███████████ │
│  Recency         12/15  █████████   │
│  Pipeline        10/15  ████████    │
│  Value            5/10  ████        │
│  Responsiveness   1/5   █           │
│                                     │
│  Reasons:                           │
│  • HOT interest on last call        │
│  • 4 total calls (engaged)          │
│  • Last contacted 2 days ago        │
└─────────────────────────────────────┘
```

---

## 3. Custom Score Models (advanced)

Allow workspace admins to define custom scoring models:

```ts
// Settings → CRM → Scoring Model
interface ScoringModel {
  name: string;          // "Loan leads", "SaaS trials"
  factors: {
    factor: string;      // "intent" | "engagement" | "recency" | ...
    weight: number;      // 0-100, normalized
    rules: ScoringRule[];// how to compute this factor
  }[];
  gradeThresholds: { A: number; B: number; C: number }; // e.g. {A:80, B:60, C:40}
}
```

This lets a real-estate CRM weight "property budget" heavily while a SaaS CRM
weights "trial usage" heavily.

---

## Next

→ [05 — CRM Analytics](05-crm-analytics.md)