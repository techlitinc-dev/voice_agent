# 01 — CRM Data Model & Migrations

> **Goal:** Add a native CRM layer (pipelines, deals, activities, segments) that
> turns voice-call outcomes into a structured sales pipeline. This integrates
> with the existing `Contact`, `Call`, and `Campaign` models — voice agents now
> **create and update deals** automatically.

---

## 1. Design Principles

1. **Voice-native**: Every call can create/update a deal automatically via the `CRM_WRITE` tool.
2. **Multi-tenant**: All models are scoped by `workspaceId` (no exceptions).
3. **Compatible**: Uses the same conventions as the existing schema (cuid IDs, paise integers, E.164 phones, Json for flexible attrs).
4. **Extensible**: Custom fields on deals/contacts via `attributes Json?` (no schema change needed to add fields).
5. **Bi-directional sync**: Native CRM ↔ external CRM (HubSpot/Zoho) via the existing `CrmConnection`.

---

## 2. New Models

Add the following to `prisma/schema.prisma`:

### 2.1 Pipeline & Stages

```prisma
// ---------- CRM: Pipeline, Stages, Deals ----------

model Pipeline {
  id          String   @id @default(cuid())
  workspaceId String
  name        String   // e.g. "Sales", "Support", "Recruitment"
  isDefault   Boolean  @default(false) // one default pipeline per workspace
  stages      Stage[]
  deals       Deal[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model Stage {
  id          String   @id @default(cuid())
  pipelineId  String
  workspaceId String
  name        String   // e.g. "New", "Contacted", "Qualified", "Won", "Lost"
  order       Int      // display order: 0, 1, 2...
  probability Int      @default(0) // win probability % — used for forecast value
  isWonStage  Boolean  @default(false)
  isLostStage Boolean  @default(false)
  color       String?  // hex for UI badge
  deals       Deal[]
  createdAt   DateTime @default(now())

  pipeline  Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([pipelineId, order])
  @@index([workspaceId])
}
```

### 2.2 Deals

```prisma
enum DealStatus {
  OPEN
  WON
  LOST
}

model Deal {
  id            String     @id @default(cuid())
  workspaceId   String
  pipelineId    String
  stageId       String
  contactId     String?
  title         String     // e.g. "Home loan — Ramesh (₹25L)"
  valuePaise    Int        @default(0) // deal value
  currency      String     @default("INR")
  status        DealStatus @default(OPEN)
  priority      String     @default("medium") // low | medium | high | urgent
  expectedClose DateTime?  // forecast date
  closedAt      DateTime?
  closedReason  String?    // why won/lost
  source        String?    // "campaign:clxxx", "inbound", "manual", "api"
  attributes    Json?      // custom fields: {"loan_amount":2500000, "city":"Pune"}
  ownerUserId   String?    // assigned sales rep
  createdFromCallId String? // the call that created this deal
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  pipeline   Pipeline   @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  stage      Stage      @relation(fields: [stageId], references: [id], onDelete: Cascade)
  contact    Contact?   @relation(fields: [contactId], references: [id], onDelete: SetNull)
  activities Activity[]
  notes      DealNote[]
  calls      Call[]     @relation("DealCalls")
  owner      User?      @relation("DealOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)
  createdFromCall Call? @relation("DealSourceCall", fields: [createdFromCallId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status])
  @@index([workspaceId, stageId])
  @@index([workspaceId, ownerUserId])
  @@index([workspaceId, expectedClose])
}

model DealNote {
  id        String   @id @default(cuid())
  dealId    String
  userId    String?
  body      String
  createdAt DateTime @default(now())

  deal Deal @relation(fields: [dealId], references: [id], onDelete: Cascade)

  @@index([dealId, createdAt])
}
```

### 2.3 Activities (timeline)

```prisma
enum ActivityType {
  CALL_OUTBOUND
  CALL_INBOUND
  SMS_SENT
  WHATSAPP_SENT
  EMAIL_SENT
  NOTE_ADDED
  STAGE_CHANGED
  DEAL_CREATED
  DEAL_WON
  DEAL_LOST
  MEETING_SCHEDULED
  TASK_COMPLETED
  CONTACT_UPDATED
  MANUAL
}

model Activity {
  id           String       @id @default(cuid())
  workspaceId  String
  dealId       String?
  contactId    String?
  type         ActivityType
  title        String       // human-readable: "Call completed (4m 12s)"
  description  String?
  metadata     Json?        // type-specific: { callId, durationSec, outcome }
  userId       String?      // who did it (null = system/AI)
  callId       String?      // link to the call that generated this activity
  createdAt    DateTime     @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  deal      Deal?     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  contact   Contact?  @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
  @@index([dealId, createdAt])
  @@index([contactId, createdAt])
}
```

### 2.4 Tasks (follow-ups)

> **Note**: `CallbackTask` already exists for call-back scheduling. Add a general
> `Task` model for non-callback follow-ups (send quote, prepare proposal, etc.).

```prisma
enum TaskType {
  CALL
  SMS
  WHATSAPP
  EMAIL
  MEETING
  DOCUMENT
  FOLLOW_UP
  CUSTOM
}

enum TaskStatus {
  PENDING
  IN_PROGRESS
  DONE
  CANCELLED
}

model Task {
  id            String     @id @default(cuid())
  workspaceId   String
  dealId        String?
  contactId     String?
  assigneeId    String?
  type          TaskType   @default(FOLLOW_UP)
  title         String
  description   String?
  dueAt         DateTime
  reminderMin   Int        @default(30) // remind assignee N min before dueAt
  status        TaskStatus @default(PENDING)
  completedAt   DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  deal      Deal?     @relation(fields: [dealId], references: [id], onDelete: SetNull)
  contact   Contact?  @relation(fields: [contactId], references: [id], onDelete: SetNull)
  assignee  User?     @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status, dueAt])
  @@index([assigneeId, status])
  @@index([dealId])
}
```

### 2.5 Segments (dynamic contact groups)

```prisma
model Segment {
  id          String   @id @default(cuid())
  workspaceId String
  name        String   // "Hot leads Pune", "EMI overdue > 30 days"
  description String?
  // Rule engine: array of conditions evaluated against Contact + Call stats
  // e.g. [{"field":"call.interestScore","op":"eq","value":"HOT"},{"field":"contact.attributes.city","op":"eq","value":"Pune"}]
  rules       Json
  matchMode   String   @default("all") // "all" (AND) or "any" (OR)
  isDynamic   Boolean  @default(true) // re-evaluated on each contact change
  memberCount Int      @default(0) // cached count, refreshed by worker
  lastEvalAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}
```

### 2.6 Lead Score (computed)

```prisma
model LeadScore {
  id          String   @id @default(cuid())
  workspaceId String
  contactId   String   @unique // one score per contact
  score       Int      @default(0) // 0–100
  grade       String   @default("C") // A (80–100), B (60–79), C (40–59), D (0–39)
  reasons     String[] @default([]) // ["HOT interest on last call", "Opened 3 emails"]
  factors     Json?    // breakdown: { "engagement": 30, "intent": 25, "recency": 15 }
  computedAt  DateTime @default(now()) @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  contact   Contact   @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([workspaceId, grade])
}
```

### 2.7 Schema additions to existing models

Add these relations to existing models:

```prisma
model Workspace {
  // ... existing fields ...
  pipelines   Pipeline[]
  stages      Stage[]
  deals       Deal[]
  activities  Activity[]
  tasks       Task[]
  segments    Segment[]
  leadScores  LeadScore[]
}

model User {
  // ... existing fields ...
  ownedDeals  Deal[]    @relation("DealOwner")
  assignedTasks Task[]  @relation("TaskAssignee")
}

model Contact {
  // ... existing fields ...
  deals      Deal[]
  activities Activity[]
  tasks      Task[]
  leadScore  LeadScore?
}

model Call {
  // ... existing fields ...
  dealId      String? // the deal this call is associated with
  deal        Deal?   @relation("DealCalls", fields: [dealId], references: [id], onDelete: SetNull)
  dealsCreated Deal[] @relation("DealSourceCall") // deals created by this call
  activityId   String? // link to the activity created for this call
}
```

---

## 3. Migration

### 3.1 Create the migration

```bash
cd vaani-ai
npx prisma migrate dev --name add_crm_pipeline_deals_activities_segments
```

This generates a migration SQL file. Verify it before applying to production.

### 3.2 Seed default pipeline

```ts
// prisma/seed.ts (extend)
async function seedCrm(prisma: PrismaClient) {
  const workspace = await prisma.workspace.findFirst(); // or create demo workspace

  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId: workspace!.id,
      name: "Sales",
      isDefault: true,
      stages: {
        create: [
          { workspaceId: workspace!.id, name: "New",          order: 0, probability: 10,  color: "#6b7280" },
          { workspaceId: workspace!.id, name: "Contacted",    order: 1, probability: 25,  color: "#3b82f6" },
          { workspaceId: workspace!.id, name: "Qualified",    order: 2, probability: 50,  color: "#8b5cf6" },
          { workspaceId: workspace!.id, name: "Negotiation",  order: 3, probability: 75,  color: "#f59e0b" },
          { workspaceId: workspace!.id, name: "Won",          order: 4, probability: 100, isWonStage: true,  color: "#10b981" },
          { workspaceId: workspace!.id, name: "Lost",         order: 5, probability: 0,   isLostStage: true, color: "#ef4444" },
        ],
      },
    },
  });

  console.log("Seeded default pipeline:", pipeline.name);
}
```

### 3.3 Backfill activities for existing calls

One-time job to create `Activity` rows for all existing calls:

```ts
// scripts/backfill-activities.ts
import { prisma } from "../src/lib/db";

async function backfill() {
  const calls = await prisma.call.findMany({ where: { /* no activity linked */ } });
  for (const call of calls) {
    await prisma.activity.create({
      data: {
        workspaceId: call.workspaceId,
        contactId: /* resolve from toNumber */,
        type: call.direction === "INBOUND" ? "CALL_INBOUND" : "CALL_OUTBOUND",
        title: `Call ${call.direction.toLowerCase()} (${call.durationSec}s)`,
        description: call.summary,
        metadata: { callId: call.id, durationSec: call.durationSec, outcome: call.outcome },
        callId: call.id,
        createdAt: call.startedAt,
      },
    });
  }
}
```

---

## 4. Voice Agent Integration

The `CRM_WRITE` tool type already exists in `AgentToolType`. Implement it to let
AI agents create/update deals mid-call:

### 4.1 Tool schema (for the LLM)

```ts
// src/lib/tool-configs.ts (extend CRM_WRITE config)
{
  type: "CRM_WRITE",
  config: {
    actions: ["create_deal", "update_deal_stage", "add_note", "schedule_task"],
    create_deal: {
      params: {
        title: "string — short deal title",
        value_paise: "number — deal value in paise",
        pipeline_name: "string — optional, defaults to workspace default",
        stage_name: "string — optional, defaults to first stage",
        contact_phone: "string — E.164, will match or create contact",
      },
    },
    update_deal_stage: {
      params: { deal_id: "string", stage_name: "string" },
    },
    add_note: { params: { deal_id: "string", body: "string" } },
    schedule_task: {
      params: { deal_id: "string", type: "CALL|EMAIL|MEETING", due_at: "ISO date", title: "string" },
    },
  },
}
```

### 4.2 Tool executor

```ts
// src/lib/tool-executor.ts (extend)
async function executeCrmWrite(params: any, ctx: ToolContext) {
  switch (params.action) {
    case "create_deal": {
      // 1. Find or create contact by phone
      const contact = await findOrCreateContact(ctx.workspaceId, params.contact_phone);
      // 2. Find pipeline + stage
      const pipeline = await findPipeline(ctx.workspaceId, params.pipeline_name);
      const stage = await findStage(pipeline.id, params.stage_name);
      // 3. Create deal
      const deal = await prisma.deal.create({
        data: {
          workspaceId: ctx.workspaceId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          contactId: contact.id,
          title: params.title,
          valuePaise: params.value_paise,
          source: `call:${ctx.callId}`,
          createdFromCallId: ctx.callId,
          attributes: params.attributes || {},
        },
      });
      // 4. Log activity
      await logActivity({ workspaceId: ctx.workspaceId, dealId: deal.id, contactId: contact.id, type: "DEAL_CREATED", title: `Deal created: ${deal.title}`, callId: ctx.callId });
      return { success: true, deal_id: deal.id };
    }
    case "update_deal_stage": {
      const stage = await prisma.stage.findFirst({ where: { workspaceId: ctx.workspaceId, name: params.stage_name } });
      const deal = await prisma.deal.update({ where: { id: params.deal_id }, data: { stageId: stage!.id } });
      await logActivity({ workspaceId: ctx.workspaceId, dealId: deal.id, type: "STAGE_CHANGED", title: `Stage → ${stage!.name}`, callId: ctx.callId });
      return { success: true };
    }
    case "add_note":
      await prisma.dealNote.create({ data: { dealId: params.deal_id, userId: ctx.userId, body: params.body } });
      return { success: true };
    case "schedule_task":
      await prisma.task.create({ data: { workspaceId: ctx.workspaceId, dealId: params.deal_id, type: params.type, title: params.title, dueAt: new Date(params.due_at) } });
      return { success: true };
    default:
      return { success: false, error: `Unknown CRM action: ${params.action}` };
  }
}
```

### 4.3 Example: post-call automation

```ts
// src/worker/postcall.ts (extend)
async function onCallCompleted(call: Call) {
  // If AI classified the lead as HOT, auto-create a deal
  if (call.interestScore === "HOT") {
    const contact = await findContactByPhone(call.workspaceId, call.fromNumber);
    if (contact) {
      const existing = await prisma.deal.findFirst({ where: { contactId: contact.id, status: "OPEN" } });
      if (!existing) {
        await createDealFromCall(call, contact); // creates deal in "New" stage
      }
    }
  }
  // If outcome indicates booking, move to "Won"
  if (call.outcome === "booked") {
    await moveDealToWon(call);
  }
}
```

---

## 5. External CRM Sync (bi-directional)

The existing `CrmConnection` model + `src/lib/crmPush.ts` + `src/worker/crm-sync.ts`
handle pushing to external CRMs. Extend to be **bi-directional**:

### 5.1 Sync directions

| Event | Native → External | External → Native |
|---|---|---|
| Deal created by AI call | Push deal to HubSpot/Zoho | — |
| Deal stage changed in UI | Update external deal stage | Stage changed in HubSpot → update native |
| Contact created | Push contact | New contact in HubSpot → create native |
| Call completed | Log call activity in external CRM | — |
| Task completed | — | Task done in external → mark native done |

### 5.2 Sync worker

```ts
// src/worker/crm-sync.ts (extend)
async function syncFromExternal(connection: CrmConnection) {
  const provider = getCrmProvider(connection.provider); // hubspot.ts, zoho.ts, etc.
  const lastSync = connection.lastSyncAt || new Date(0);

  // Pull changed deals since lastSync
  const externalDeals = await provider.listDeals(connection, { modifiedSince: lastSync });
  for (const ext of externalDeals) {
    const nativeContact = await findContactByExternalId(connection.workspaceId, ext.contactExternalId);
    if (!nativeContact) continue;
    const nativeDeal = await prisma.deal.findFirst({ where: { workspaceId: connection.workspaceId, contactId: nativeContact.id } });
    if (nativeDeal) {
      // Update stage if changed
      const mappedStage = mapExternalStage(ext.stage, connection.fieldMapping);
      if (mappedStage && nativeDeal.stageId !== mappedStage.id) {
        await prisma.deal.update({ where: { id: nativeDeal.id }, data: { stageId: mappedStage.id } });
      }
    } else {
      // Create native deal from external
      await prisma.deal.create({ data: { /* ... */ } });
    }
  }
  await prisma.crmConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date() } });
}
```

---

## 6. Field Mapping

External CRMs have different field names. The `CrmConnection.fieldMapping` Json
stores the mapping:

```json
{
  "contact.name": "firstname",
  "contact.phone": "phone",
  "contact.email": "email",
  "deal.title": "dealname",
  "deal.value_paise": "amount_cents",
  "deal.stage": "dealstage",
  "call.outcome": "hs_lead_status",
  "call.interest_score": "lifecyclestage"
}
```

Provide a UI mapping editor in Settings → Integrations → CRM.

---

## Next

→ [02 — Pipeline & Deals UI](02-pipeline-and-deals.md)