# 02 — Pipeline & Deals UI

> **Goal:** Build the visual pipeline board (Kanban), deal detail page, and deal
> management flows — the core of the CRM experience.

---

## 1. Routes & Navigation

### 1.1 New routes

```
app/(app)/crm/
├── layout.tsx              ← CRM sub-nav (Pipeline | Deals | Tasks | Segments)
├── page.tsx                ← redirect to /crm/pipeline
├── pipeline/
│   ├── page.tsx            ← Kanban board (default view)
│   └── [pipelineId]/page.tsx ← Switch between multiple pipelines
├── deals/
│   ├── page.tsx            ← List/table view of all deals (filterable)
│   ├── new/page.tsx        ← Create deal form
│   └── [id]/
│       ├── page.tsx        ← Deal detail (left: details, right: timeline)
│       └── edit/page.tsx   ← Edit deal
├── tasks/
│   └── page.tsx            ← Task list (kanban or list)
└── segments/
    ├── page.tsx            ← Segment list
    ├── new/page.tsx        ← Segment builder
    └── [id]/page.tsx       ← Segment members
```

### 1.2 Add to main nav

Add "CRM" to the main navigation (between "Contacts" and "Campaigns") with a
`LayoutDashboard` or `KanbanSquare` icon.

---

## 2. Pipeline Board (Kanban)

The centerpiece: a drag-and-drop board showing deals grouped by stage.

### 2.1 Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Pipeline: [Sales ▾]    [Filter: Owner=Me ▾]   [+ Deal]   [Forecast]     │
├───────────────┬───────────────┬───────────────┬───────────────┬──────────┐
│   NEW (12)    │  CONTACTED(8) │ QUALIFIED (5) │ NEGOTIATION(3)│ WON (24) │
│   ₹4,80,000   │   ₹3,20,000   │   ₹2,50,000   │   ₹1,80,000   │ ₹12,00,000│
├───────────────┼───────────────┼───────────────┼───────────────┼──────────┤
│ ┌───────────┐ │ ┌───────────┐ │ ┌───────────┐ │ ┌───────────┐ │ ┌──────┐ │
│ │ Home loan │ │ │ Car loan  │ │ │ Biz loan  │ │ │ Education │ │ │ ...  │ │
│ │ Ramesh    │ │ │ Priya     │ │ │ Acme Corp │ │ │ Amit      │ │ │      │ │
│ │ ₹50,000   │ │ │ ₹40,000   │ │ │ ₹50,000   │ │ │ ₹60,000   │ │ │      │ │
│ │ 🔥 HOT    │ │ │ ⚡ WARM   │ │ │ 🔥 HOT    │ │ │ 🔥 HOT    │ │ │      │ │
│ │ 3d ago    │ │ │ 1d ago    │ │ │ 5h ago    │ │ │ 2h ago    │ │ │      │ │
│ └───────────┘ │ └───────────┘ │ └───────────┘ │ └───────────┘ │ └──────┘ │
│ ┌───────────┐ │ ┌───────────┐ │               │               │          │
│ │ ...       │ │ │ ...       │ │               │               │          │
│ └───────────┘ │ └───────────┘ │               │               │          │
└───────────────┴───────────────┴───────────────┴───────────────┴──────────┘
```

### 2.2 Deal card component

```tsx
// src/app/(app)/crm/pipeline/deal-card.tsx
"use client";
import { Draggable } from "@hello-pangea/dnd";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatINR } from "@/lib/money";

export function DealCard({ deal, index }: { deal: Deal; index: number }) {
  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided) => (
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="p-3 mb-2 cursor-grab active:cursor-grabbing hover:shadow-md transition"
        >
          <div className="flex justify-between items-start mb-2">
            <p className="font-medium text-sm line-clamp-2">{deal.title}</p>
          </div>
          {deal.contact?.name && (
            <p className="text-xs text-muted-foreground mb-2">{deal.contact.name}</p>
          )}
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold">{formatINR(deal.valuePaise)}</span>
            <InterestBadge score={deal.interestScore} />
          </div>
          <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
            <span>{relativeTime(deal.updatedAt)}</span>
            {deal.owner && <Avatar name={deal.owner.fullName} size="sm" />}
          </div>
        </Card>
      )}
    </Draggable>
  );
}
```

### 2.3 Board with drag-and-drop

```tsx
// src/app/(app)/crm/pipeline/page.tsx
"use client";
import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { updateDealStage } from "@/server/actions/crm";

export default function PipelineBoard({ pipeline, stages, dealsByStage }) {
  async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId) return;

    // Optimistic UI update (use React state)
    // Then persist to server
    await updateDealStage(draggableId, destination.droppableId);
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <Droppable droppableId={stage.id} key={stage.id}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}
                   className="w-72 flex-shrink-0 bg-muted/40 rounded-lg p-3">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: stage.color }} />
                    {stage.name}
                  </h3>
                  <Badge variant="secondary">{dealsByStage[stage.id]?.length || 0}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mb-3">
                  {formatINR(sumValues(dealsByStage[stage.id]))}
                </div>
                {dealsByStage[stage.id]?.map((deal, i) => (
                  <DealCard key={deal.id} deal={deal} index={i} />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  );
}
```

### 2.4 New dependency

```bash
cd vaani-ai && npm install @hello-pangea/dnd
```

> `@hello-pangea/dnd` is a maintainable fork of `react-beautiful-dnd` with React 18 support.

---

## 3. Deal Detail Page

### 3.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to pipeline          [Edit] [⋯ More]                        │
├──────────────────────────────────────┬──────────────────────────────┤
│  HOME LOAN — RAMESH (₹25L)           │  ACTIVITY TIMELINE           │
│  Stage: Qualified ▾   Value: ₹25,00,000│  ─────────────────────────  │
│  Owner: Priya        Priority: High   │  📞 Call outbound (4m 12s)   │
│  Expected close: 15 Aug 2026         │     HOT — "wants 25L, salaried│
│  Source: campaign:clxxx              │     ₹80k/month"              │
│                                      │     2 hours ago              │
│  CONTACT                             │                              │
│  Ramesh Kumar                        │  📝 Note added by Priya      │
│  +91 98XXX XXXXX                     │     "Send rate card"         │
│  Pune                                │     1 day ago                │
│  [Call] [SMS] [WhatsApp] [Email]     │                              │
│                                      │  📞 Call inbound (2m 04s)    │
│  ATTRIBUTES                          │     3 days ago               │
│  Loan amount: ₹25,00,000             │                              │
│  Employment: Salaried                │  ✅ Deal created             │
│  City: Pune                          │     from campaign "Aug EMI"  │
│  Monthly income: ₹80,000             │     5 days ago               │
│                                      │                              │
│  TASKS (2)                          │  [+ Add note]                │
│  ☐ Send rate card — due tomorrow    │                              │
│  ☐ Follow-up call — due 16 Aug      │                              │
│                                      │                              │
│  NOTES (3)                          │                              │
│  "Customer prefers weekend calls"   │                              │
│  "Asked about prepayment charges"   │                              │
└──────────────────────────────────────┴──────────────────────────────┘
```

### 3.2 Two-column layout component

```tsx
// src/app/(app)/crm/deals/[id]/page.tsx
import { prisma } from "@/lib/db";
import { DealHeader } from "./deal-header";
import { DealDetails } from "./deal-details";
import { ActivityTimeline } from "./activity-timeline";

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  const deal = await prisma.deal.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: {
      contact: true,
      stage: true,
      pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
      owner: true,
      activities: { orderBy: { createdAt: "desc" }, take: 50, include: { call: true } },
      notes: { orderBy: { createdAt: "desc" } },
      tasks: { where: { status: "PENDING" }, orderBy: { dueAt: "asc" } },
      calls: { orderBy: { startedAt: "desc" }, take: 10 },
    },
  });

  if (!deal) notFound();

  return (
    <div className="space-y-6">
      <DealHeader deal={deal} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DealDetails deal={deal} />
        </div>
        <div>
          <ActivityTimeline activities={deal.activities} />
        </div>
      </div>
    </div>
  );
}
```

---

## 4. Server Actions

### 4.1 Deal CRUD

```ts
// src/server/actions/crm.ts (new)
"use server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const dealSchema = z.object({
  title: z.string().min(1).max(200),
  valuePaise: z.number().int().min(0),
  pipelineId: z.string().cuid(),
  stageId: z.string().cuid(),
  contactId: z.string().cuid().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  expectedClose: z.string().datetime().optional(),
  attributes: z.record(z.any()).optional(),
  ownerUserId: z.string().cuid().optional(),
});

export async function createDeal(input: z.infer<typeof dealSchema>) {
  await requirePermission("deals:write", ctx.workspaceId, ctx.userId);
  const data = dealSchema.parse(input);

  const deal = await prisma.deal.create({
    data: { workspaceId: ctx.workspaceId, ...data, expectedClose: data.expectedClose ? new Date(data.expectedClose) : null },
  });

  await logActivity({ workspaceId: ctx.workspaceId, dealId: deal.id, contactId: data.contactId, type: "DEAL_CREATED", title: `Deal created: ${deal.title}` });
  revalidatePath("/crm/pipeline");
  return deal;
}

export async function updateDealStage(dealId: string, stageId: string) {
  await requirePermission("deals:write", ctx.workspaceId, ctx.userId);

  const [deal, newStage] = await Promise.all([
    prisma.deal.findFirstOrThrow({ where: { id: dealId, workspaceId: ctx.workspaceId } }),
    prisma.stage.findFirstOrThrow({ where: { id: stageId, workspaceId: ctx.workspaceId } }),
  ]);

  await prisma.deal.update({
    where: { id: dealId },
    data: {
      stageId,
      ...(newStage.isWonStage && { status: "WON", closedAt: new Date() }),
      ...(newStage.isLostStage && { status: "LOST", closedAt: new Date() }),
    },
  });

  await logActivity({
    workspaceId: ctx.workspaceId, dealId, type: newStage.isWonStage ? "DEAL_WON" : newStage.isLostStage ? "DEAL_LOST" : "STAGE_CHANGED",
    title: `Stage → ${newStage.name}`,
  });

  revalidatePath("/crm/pipeline");
  revalidatePath(`/crm/deals/${dealId}`);
}

export async function updateDeal(dealId: string, input: Partial<z.infer<typeof dealSchema>>) {
  await requirePermission("deals:write", ctx.workspaceId, ctx.userId);
  const deal = await prisma.deal.update({ where: { id: dealId, workspaceId: ctx.workspaceId }, data: input });
  revalidatePath(`/crm/deals/${dealId}`);
  return deal;
}

export async function deleteDeal(dealId: string) {
  await requirePermission("deals:delete", ctx.workspaceId, ctx.userId);
  await prisma.deal.delete({ where: { id: dealId, workspaceId: ctx.workspaceId } });
  revalidatePath("/crm/pipeline");
}

export async function addDealNote(dealId: string, body: string) {
  await requirePermission("deals:write", ctx.workspaceId, ctx.userId);
  const note = await prisma.dealNote.create({ data: { dealId, userId: ctx.userId, body } });
  await logActivity({ workspaceId: ctx.workspaceId, dealId, type: "NOTE_ADDED", title: "Note added", metadata: { noteId: note.id } });
  revalidatePath(`/crm/deals/${dealId}`);
}
```

---

## 5. Filtering & Sorting

### 5.1 Pipeline filters

The board supports filters:

| Filter | Options |
|---|---|
| **Owner** | Me / Anyone / Specific user |
| **Priority** | low / medium / high / urgent |
| **Interest** | HOT / WARM / COLD |
| **Value range** | min/max slider (₹) |
| **Source** | campaign / inbound / manual / api |
| **Expected close** | this week / this month / overdue |
| **Created** | today / 7d / 30d / custom range |

Filters are applied via URL search params (shareable, bookmarkable):

```
/crm/pipeline?owner=me&priority=high,turgent&interest=HOT
```

### 5.2 Deal list view (table)

Alternative to the Kanban board — a sortable, paginated table:

```tsx
// src/app/(app)/crm/deals/page.tsx
import { DataTable } from "@/components/ui/data-table";
import { columns } from "./columns";

export default async function DealsPage({ searchParams }) {
  const deals = await fetchDeals(ctx.workspaceId, searchParams);
  return (
    <div className="p-6">
      <DealFilters searchParams={searchParams} />
      <DataTable columns={columns} data={deals} pagination />
    </div>
  );
}
```

Columns: Title | Contact | Value | Stage | Priority | Interest | Owner | Expected Close | Last Activity | Actions

---

## 6. Forecast View

A projection of expected revenue based on stage probability:

```
┌─────────────────────────────────────────────────────────┐
│  REVENUE FORECAST (this month)                          │
├──────────────────────────────┬──────────────────────────┤
│  Stage          Value  ×Prob │  = Weighted              │
├──────────────────────────────┼──────────────────────────┤
│  New           ₹4,80,000 10% │  ₹48,000                 │
│  Contacted     ₹3,20,000 25% │  ₹80,000                 │
│  Qualified     ₹2,50,000 50% │  ₹1,25,000               │
│  Negotiation   ₹1,80,000 75% │  ₹1,35,000               │
│  Won          ₹12,00,000 100%│  ₹12,00,000              │
├──────────────────────────────┼──────────────────────────┤
│  TOTAL (pipeline) ₹24,30,000│  WEIGHTED ₹15,88,000     │
└──────────────────────────────┴──────────────────────────┘
```

```tsx
// src/app/(app)/crm/pipeline/forecast.tsx
export function Forecast({ stages, dealsByStage }) {
  const rows = stages.map((stage) => {
    const deals = dealsByStage[stage.id] || [];
    const value = sum(deals.map((d) => d.valuePaise));
    return { stage: stage.name, value, weighted: Math.round(value * stage.probability / 100), probability: stage.probability };
  });
  const totalPipeline = sum(rows.map((r) => r.value));
  const totalWeighted = sum(rows.map((r) => r.weighted));
  // render table + bar chart (Recharts)
}
```

---

## 7. Bulk Actions

On the deals list view, support:

- [ ] Bulk change stage (select N deals → move to stage)
- [ ] Bulk reassign owner
- [ ] Bulk export (CSV)
- [ ] Bulk delete (with confirmation dialog)

---

## 8. Permissions

| Action | VIEWER | AGENT | MANAGER | ADMIN | OWNER |
|---|---|---|---|---|---|
| View pipeline board | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit deal | ✗ | ✓ | ✓ | ✓ | ✓ |
| Delete deal | ✗ | ✗ | ✓ | ✓ | ✓ |
| Change stage | ✗ | ✓ (own) | ✓ (all) | ✓ | ✓ |
| Reassign owner | ✗ | ✗ | ✓ | ✓ | ✓ |
| Create pipeline | ✗ | ✗ | ✗ | ✓ | ✓ |

---

## Next

→ [03 — Activities & Tasks](03-activities-and-tasks.md)