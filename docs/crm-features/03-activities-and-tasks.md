# 03 — Activities & Tasks

> **Goal:** Build a unified activity timeline and task management system that
> captures every interaction (call, SMS, note, stage change) and schedules
> follow-ups.

---

## 1. Activity Timeline

Every interaction in the CRM is logged as an `Activity`. The timeline is the
single source of truth for "what happened with this contact/deal".

### 1.1 Activity sources

Activities are created from:

| Source | Trigger | Type |
|---|---|---|
| AI call completed | Post-call worker | `CALL_INBOUND` / `CALL_OUTBOUND` |
| SMS sent | Tool executor | `SMS_SENT` |
| WhatsApp sent | Tool executor | `WHATSAPP_SENT` |
| Deal created | Server action | `DEAL_CREATED` |
| Stage changed | Drag-drop or server action | `STAGE_CHANGED` / `DEAL_WON` / `DEAL_LOST` |
| Note added | User UI | `NOTE_ADDED` |
| Task completed | User UI | `TASK_COMPLETED` |
| Meeting booked | Calendar tool | `MEETING_SCHEDULED` |
| External CRM sync | Sync worker | `CONTACT_UPDATED` |
| Manual entry | User UI | `MANUAL` |

### 1.2 Timeline component

```tsx
// src/components/crm/activity-timeline.tsx
import { ScrollArea } from "@/components/ui/scroll-area";
import { activityIcon, activityColor } from "./activity-meta";

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  return (
    <div className="relative">
      {/* vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
      <ScrollArea className="h-[600px] pr-4">
        <div className="space-y-1">
          {activities.map((act) => (
            <ActivityItem key={act.id} activity={act} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const Icon = activityIcon(activity.type);
  return (
    <div className="flex gap-3 py-3 relative">
      {/* dot on the timeline */}
      <div className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${activityColor(activity.type)}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 pb-3 border-b last:border-0">
        <p className="text-sm font-medium">{activity.title}</p>
        {activity.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{activity.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>{relativeTime(activity.createdAt)}</span>
          {activity.userId && <span>• {activity.userName}</span>}
          {activity.callId && (
            <a href={`/calls/${activity.callId}`} className="text-primary hover:underline">
              View call →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 1.3 Activity metadata helper

```ts
// src/components/crm/activity-meta.ts
import {
  PhoneIncoming, PhoneOutgoing, MessageSquare, MessageCircle, Mail,
  FileText, ArrowRightCircle, PlusCircle, Trophy, XCircle, Calendar,
  CheckCircle2, UserCog, PenLine,
} from "lucide-react";

const META: Record<ActivityType, { icon: any; color: string }> = {
  CALL_INBOUND:       { icon: PhoneIncoming,   color: "bg-blue-100 text-blue-700" },
  CALL_OUTBOUND:      { icon: PhoneOutgoing,   color: "bg-indigo-100 text-indigo-700" },
  SMS_SENT:           { icon: MessageSquare,   color: "bg-emerald-100 text-emerald-700" },
  WHATSAPP_SENT:      { icon: MessageCircle,   color: "bg-green-100 text-green-700" },
  EMAIL_SENT:         { icon: Mail,            color: "bg-cyan-100 text-cyan-700" },
  NOTE_ADDED:         { icon: PenLine,         color: "bg-gray-100 text-gray-700" },
  STAGE_CHANGED:      { icon: ArrowRightCircle,color: "bg-amber-100 text-amber-700" },
  DEAL_CREATED:       { icon: PlusCircle,      color: "bg-violet-100 text-violet-700" },
  DEAL_WON:           { icon: Trophy,          color: "bg-green-100 text-green-700" },
  DEAL_LOST:          { icon: XCircle,         color: "bg-red-100 text-red-700" },
  MEETING_SCHEDULED:  { icon: Calendar,        color: "bg-purple-100 text-purple-700" },
  TASK_COMPLETED:     { icon: CheckCircle2,    color: "bg-teal-100 text-teal-700" },
  CONTACT_UPDATED:    { icon: UserCog,         color: "bg-slate-100 text-slate-700" },
  MANUAL:             { icon: FileText,        color: "bg-gray-100 text-gray-700" },
};

export const activityIcon = (type: ActivityType) => META[type]?.icon || FileText;
export const activityColor = (type: ActivityType) => META[type]?.color || "bg-gray-100 text-gray-700";
```

### 1.4 Activity logging helper

```ts
// src/lib/crm/activity.ts (new)
import { prisma } from "@/lib/db";

export async function logActivity(params: {
  workspaceId: string;
  dealId?: string;
  contactId?: string;
  type: ActivityType;
  title: string;
  description?: string;
  metadata?: any;
  userId?: string;
  callId?: string;
}) {
  return prisma.activity.create({ data: params });
}
```

### 1.5 Filtering the timeline

The timeline supports filters:

- **By type**: show only calls, only notes, only stage changes, etc.
- **By user**: show only activities by a specific user (or "AI/System").
- **By date range**: activities in the last 7/30/90 days.

---

## 2. Task Management

### 2.1 Task list page

```
┌──────────────────────────────────────────────────────────────────┐
│  TASKS                                  [+ New Task] [Filter ▾]  │
├──────────────────────────────────────────────────────────────────┤
│  Tab: [Today (5)] [Upcoming (12)] [Overdue (3)] [Completed (45)] │
├──────────────────────────────────────────────────────────────────┤
│  ☐ 📞 Follow-up call — Ramesh Kumar              Due: Today 4 PM │
│     Deal: Home loan ₹25L  •  Assigned to: Me                     │
│  ☐ 📧 Send rate card — Priya                     Due: Today 6 PM │
│     Deal: Car loan ₹8L   •  Assigned to: Me                      │
│  ☐ 📞 Callback — Acme Corp                       Due: Tomorrow   │
│     Contact: +91 98XXX  •  Assigned to: Rahul                    │
│  ⚠ 📄 Prepare proposal — Amit (OVERDUE 2 days)                  │
│     Deal: Education loan  •  Assigned to: Me                     │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Task component

```tsx
// src/app/(app)/crm/tasks/task-row.tsx
"use client";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { completeTask } from "@/server/actions/crm";

export function TaskRow({ task }: { task: Task }) {
  const [optimisticDone, setOptimisticDone] = useState(false);
  const isOverdue = !optimisticDone && task.status === "PENDING" && new Date(task.dueAt) < new Date();

  return (
    <div className={`flex items-start gap-3 p-3 border-b hover:bg-muted/30 ${isOverdue ? "bg-red-50" : ""}`}>
      <Checkbox
        checked={optimisticDone || task.status === "DONE"}
        onCheckedChange={async (checked) => {
          setOptimisticDone(!!checked);
          if (checked) await completeTask(task.id);
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <TaskTypeIcon type={task.type} />
          <p className={`text-sm font-medium ${optimisticDone ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </p>
        </div>
        {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {task.deal && <span>Deal: <Link href={`/crm/deals/${task.dealId}`}>{task.deal.title}</Link></span>}
          <span className={isOverdue ? "text-red-600 font-medium" : ""}>
            Due: {isOverdue ? "OVERDUE " : ""}{formatDateTime(task.dueAt)}
          </span>
          {task.assignee && <span>• {task.assignee.fullName}</span>}
        </div>
      </div>
    </div>
  );
}
```

### 2.3 Task server actions

```ts
// src/server/actions/crm.ts (extend)
const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  type: z.enum(["CALL", "SMS", "WHATSAPP", "EMAIL", "MEETING", "DOCUMENT", "FOLLOW_UP", "CUSTOM"]),
  dealId: z.string().cuid().optional(),
  contactId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  dueAt: z.string().datetime(),
  reminderMin: z.number().int().min(0).max(10080).default(30),
});

export async function createTask(input: z.infer<typeof taskSchema>) {
  await requirePermission("deals:write", ctx.workspaceId, ctx.userId);
  const task = await prisma.task.create({
    data: { workspaceId: ctx.workspaceId, ...input, dueAt: new Date(input.dueAt) },
  });
  revalidatePath("/crm/tasks");
  return task;
}

export async function completeTask(taskId: string) {
  await requirePermission("deals:write", ctx.workspaceId, ctx.userId);
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE", completedAt: new Date() },
  });
  await logActivity({
    workspaceId: ctx.workspaceId,
    dealId: task.dealId || undefined,
    contactId: task.contactId || undefined,
    type: "TASK_COMPLETED",
    title: `Task completed: ${task.title}`,
  });
  revalidatePath("/crm/tasks");
}
```

### 2.4 Task reminders

A cron job checks for tasks due soon and notifies the assignee:

```ts
// src/worker/cron.ts (extend)
async function sendTaskReminders() {
  const soon = new Date(Date.now() + 60 * 60 * 1000); // next hour
  const tasks = await prisma.task.findMany({
    where: {
      status: "PENDING",
      dueAt: { lte: soon, gte: new Date() },
      // not yet reminded
    },
    include: { assignee: true, deal: true },
  });

  for (const task of tasks) {
    const reminderTime = new Date(task.dueAt.getTime() - task.reminderMin * 60 * 1000);
    if (reminderTime <= new Date()) {
      await sendNotification(task.assignee, {
        title: `Task due soon: ${task.title}`,
        body: `Due at ${formatDateTime(task.dueAt)}`,
        link: `/crm/tasks`,
      });
    }
  }
}
```

---

## 3. Contact Activity View

When viewing a contact (existing `/contacts/[phone]`), show their full activity
history:

```tsx
// src/app/(app)/contacts/[phone]/page.tsx (extend)
export default async function ContactDetailPage({ params }) {
  const contact = await prisma.contact.findFirstOrThrow({
    where: { workspaceId: ctx.workspaceId, phone: params.phone },
    include: {
      leadScore: true,
      deals: { include: { stage: true }, orderBy: { updatedAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 100 },
      tasks: { where: { status: "PENDING" }, orderBy: { dueAt: "asc" } },
      campaignContacts: { include: { campaign: true } },
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <ContactCard contact={contact} />
        <ContactDeals deals={contact.deals} />
        <ContactTasks tasks={contact.tasks} />
      </div>
      <div className="lg:col-span-2">
        <Tabs defaultValue="activity">
          <TabsList>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="calls">Calls</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          </TabsList>
          <TabsContent value="activity">
            <ActivityTimeline activities={contact.activities} />
          </TabsContent>
          <TabsContent value="calls">
            <CallList calls={/* filter from activities */} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

---

## 4. Smart Task Creation

### 4.1 Auto-task from call outcome

The post-call worker can auto-create tasks based on the call outcome:

```ts
// src/worker/postcall.ts (extend)
const TASK_RULES: Record<string, { type: TaskType; title: string; delayHours: number }> = {
  "callback-requested": { type: "CALL", title: "Callback requested by customer", delayHours: 24 },
  "send-quote": { type: "EMAIL", title: "Send quotation", delayHours: 4 },
  "document-pending": { type: "DOCUMENT", title: "Collect pending documents", delayHours: 48 },
  "payment-pending": { type: "FOLLOW_UP", title: "Follow up on payment", delayHours: 24 },
};

async function autoCreateTasks(call: Call) {
  const rule = TASK_RULES[call.outcome || ""];
  if (!rule) return;

  const contact = await findContactByPhone(call.workspaceId, call.fromNumber);
  if (!contact) return;

  const deal = await prisma.deal.findFirst({ where: { contactId: contact.id, status: "OPEN" } });

  await prisma.task.create({
    data: {
      workspaceId: call.workspaceId,
      dealId: deal?.id,
      contactId: contact.id,
      type: rule.type,
      title: rule.title,
      dueAt: new Date(Date.now() + rule.delayHours * 3600 * 1000),
      source: `call:${call.id}`,
    },
  });
}
```

### 4.2 Task templates per industry

Allow workspace admins to define outcome → task mappings per industry:

```ts
// Settings → CRM → Task Rules
interface TaskRule {
  outcome: string;         // "callback-requested"
  taskType: TaskType;      // "CALL"
  titleTemplate: string;   // "Callback {contact.name}"
  delayHours: number;      // 24
  assignTo: "deal_owner" | "unassigned" | "specific_user";
}
```

---

## 5. Quick Actions

Quick-action buttons appear on deals, contacts, and tasks:

| Action | What it does |
|---|---|
| **📞 Call** | Opens the click-to-dial (existing `/dialer`) pre-filled |
| **💬 SMS** | Opens SMS composer |
| **🟢 WhatsApp** | Opens WhatsApp composer |
| **✉️ Email** | Opens email composer |
| **📅 Schedule** | Opens calendar booking |
| **📝 Note** | Quick note input |
| **➕ Task** | Quick task creation |

```tsx
// src/components/crm/quick-actions.tsx
"use client";
export function QuickActions({ contact, deal }: { contact?: Contact; deal?: Deal }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => dial(contact?.phone)}>
        <Phone className="w-4 h-4 mr-1" /> Call
      </Button>
      <Button size="sm" variant="outline" onClick={() => openSms(contact?.phone)}>
        <MessageSquare className="w-4 h-4 mr-1" /> SMS
      </Button>
      <Button size="sm" variant="outline" onClick={() => openWhatsApp(contact?.phone)}>
        <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
      </Button>
      <Button size="sm" variant="outline" onClick={() => openNote(deal?.id)}>
        <PenLine className="w-4 h-4 mr-1" /> Note
      </Button>
      <Button size="sm" variant="outline" onClick={() => openTaskModal({ dealId: deal?.id, contactId: contact?.id })}>
        <Plus className="w-4 h-4 mr-1" /> Task
      </Button>
    </div>
  );
}
```

---

## Next

→ [04 — Segmentation & Lead Scoring](04-segmentation-and-lead-scoring.md)