# 02 — Database Schema & Prisma

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and then execute
> `/root/vaani-ai/plan/02_database_schema_and_prisma.md` exactly. Follow every step in
> order, create every file EXACTLY as shown, run every **Verify** command, and compare
> with **Expected**. On mismatch use the **If it fails** block (max 2 attempts), then
> STOP and report the step number, command, and full error. Never change versions or
> invent new fields/models beyond this guide. End with the FINAL REPORT.
> ---

---

## Goal

The complete v1 data model — covering EVERY feature domain of the product spec
(auth & tenancy, white-label, agent builder, knowledge base, tools, integrations,
inbound/HITL, outbound campaigns, WhatsApp, analytics/QA, billing, compliance,
onboarding) — migrated into PostgreSQL, seeded with demo data, and verified by
unit tests plus a scripted CRUD smoke test. After this file, `npx prisma studio`
shows a fully relational schema with rows in every major table.

**Time estimate:** 2–3 hours. **Prerequisite:** guide 01 fully green (docker dev infra
running, `.env` present).

---

## Data model overview (context — do not code from this section)

Tenancy: a `Workspace` owns everything. A `User` can belong to many workspaces via
`Membership` (with a `Role` + optional per-member permission grants/revokes). The
active workspace is stored in the `Session` row. Every tenant-owned table has
`workspaceId` + an index on it. Detail/join rows (`CallEvent`, `TranscriptEntry`,
`CampaignContact`, `WebhookDelivery`, `WalletTransaction`) are scoped through their
parent — same convention as before.

**Domain map (all models by group):**

```
AUTH & TENANCY          Workspace, User, Membership (role + granted/revoked permissions),
                        Session (device/IP/UA, revokedAt = forced logout), AuditLog,
                        ApiKey (scopes, IP allowlist, revocation), WorkspaceInvite,
                        TotpSecret (PENDING→ENABLED), SsoIdentity (GOOGLE/SAML/OIDC)

WHITE-LABEL             fields on Workspace: logoUrl, primaryColor, customDomain,
                        customDomainVerifiedAt, whiteLabelEnabled
                        ResellerAccount (parent workspace → child workspaces, rate card)

AGENT BUILDER           Agent, AgentVersion (draft/published/rollback, A/B variant +
                        traffic %, dograhWorkflowId per version), KnowledgeDocument
                        (PDF/DOCX/URL/FAQ, index status, re-index schedule),
                        AgentToolConfig (8 tool types, per agent),
                        MarketplaceTemplate (community gallery)

INTEGRATIONS            CalendarConnection (google/microsoft/calendly/calcom),
                        CrmConnection (6 CRMs, tokens, field mapping, two-way sync),
                        WebhookSubscription + WebhookDelivery (retry worker state)

INBOUND / HITL          PhoneNumber (+ NumberType, pool, daily/lifetime caps, rent),
                        NumberPool, Contact (+ consent flags, timezone, crmExternalId),
                        DncEntry (OPT_OUT/REGISTRY/MANUAL), Call (+ AMD, sentiment,
                        entities, interest HOT/WARM/COLD, hallucination, dead-air,
                        script adherence), CallEvent, TranscriptEntry, LiveCallState
                        (listen/whisper/barge/takeover), TransferRequest (queue/skill),
                        VoicemailMessage

OUTBOUND                ContactList, Campaign (+ CampaignType x8, CPS/concurrency,
                        timezone windows JSON, retry policy JSON, opening hook,
                        objection playbook, AMD policy, predictive flag),
                        CampaignContact (attempts, lastResult, nextAttemptAt),
                        CallbackTask ("call me tomorrow at 5"),
                        WhatsAppTemplate (DLT status) + WhatsAppCampaign

ANALYTICS / QA          QaScore (rubric, per-criterion JSON, scorer model),
                        Call cost breakdown (telephony/stt/llm/tts/billed paise),
                        SavedReport, ScheduledDigest (frequency, recipients, lastSentAt),
                        Call.transcript = plain text (full-text-search ready)

BILLING                 Plan (+ feature gates: concurrentLines, whiteLabel,
                        premiumVoices, dedicatedInfra, featureGates JSON),
                        Subscription, Wallet, WalletTransaction,
                        Invoice (+ GST: gstin, placeOfSupply, hsnSac,
                        cgst/sgst/igst paise, pdfKey),
                        PaymentOrder (RAZORPAY/STRIPE), AutoTopUp,
                        NumberRental (price + margin), TrialState (minutes, KYC,
                        sandbox number)

COMPLIANCE              RetentionPolicy (recordings/transcripts days, auto-delete),
                        GdprRequest (EXPORT/ERASURE), recording disclosure text on
                        Workspace + Agent, Call.piiRedacted flag

ONBOARDING              OnboardingState (wizard step, checklist JSON, sample data),
                        KycRecord (India KYC for regulated 140/1600 series)
```

Billing flow: `Plan` defines tiers + feature gates; `Subscription` ties a workspace to
a plan; `Wallet` holds prepaid paise; `WalletTransaction` is the append-only ledger;
`PaymentOrder` tracks Razorpay/Stripe checkout; `Invoice` is the GST-compliant record;
`NumberRental` bills DID rent with margin; `AutoTopUp` recharges the wallet.

Voice flow: `Agent` maps to Dograh via `AgentVersion.dograhWorkflowId` (one Dograh
workflow per published version). `PhoneNumber` maps a Vobiz DID to an agent. `Call`
is the CDR (one row per call, updated by webhooks); `CallEvent` + `TranscriptEntry`
are the append-only streams; `LiveCallState` is the transient row for the live
dashboard (one per in-progress call, deleted when the call ends).

Outbound flow: `ContactList` → `Contact`; `Campaign` → `CampaignContact`
(PENDING → DIALING → COMPLETED/FAILED/RETRY_SCHEDULED/SKIPPED_DNC). Mid-call
"call me back" requests become `CallbackTask` rows. Number rotation uses
`NumberPool` ↔ `PhoneNumber.poolId` with per-number caps.

---

## Step 1: prisma schema file

Create `prisma/schema.prisma` with EXACTLY this content (this is the full schema — do
not add or remove models or fields):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------- Tenancy & Auth ----------

enum Role {
  OWNER
  ADMIN
  MANAGER
  AGENT
  VIEWER
}

enum TotpStatus {
  PENDING
  ENABLED
  DISABLED
}

enum SsoProvider {
  GOOGLE
  SAML
  OIDC
}

enum InviteStatus {
  PENDING
  ACCEPTED
  REVOKED
  EXPIRED
}

model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  industry  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // White-label (spec 3.1)
  logoUrl               String?
  primaryColor          String? // hex, e.g. "#7c3aed"
  customDomain          String?  @unique
  customDomainVerifiedAt DateTime?
  whiteLabelEnabled     Boolean @default(false)

  // Recording disclosure default for the whole workspace (spec 11)
  recordingDisclosureText String?

  // Reseller: this workspace may be a child of a ResellerAccount
  resellerId String?
  reseller   ResellerAccount? @relation("ResellerChildren", fields: [resellerId], references: [id], onDelete: SetNull)

  memberships         Membership[]
  agents              Agent[]
  agentVersions       AgentVersion[]
  knowledgeDocuments  KnowledgeDocument[]
  marketplaceTemplates MarketplaceTemplate[] // templates authored BY this workspace
  phoneNumbers        PhoneNumber[]
  numberPools         NumberPool[]
  contactLists        ContactList[]
  contacts            Contact[]
  dncEntries          DncEntry[]
  campaigns           Campaign[]
  calls               Call[]
  liveCallStates      LiveCallState[]
  transferRequests    TransferRequest[]
  voicemailMessages   VoicemailMessage[]
  callbackTasks       CallbackTask[]
  whatsAppTemplates   WhatsAppTemplate[]
  whatsAppCampaigns   WhatsAppCampaign[]
  calendarConnections CalendarConnection[]
  crmConnections      CrmConnection[]
  webhookSubscriptions WebhookSubscription[]
  qaScores            QaScore[]
  savedReports        SavedReport[]
  scheduledDigests    ScheduledDigest[]
  wallet              Wallet?
  subscription        Subscription?
  invoices            Invoice[]
  paymentOrders       PaymentOrder[]
  autoTopUp           AutoTopUp?
  numberRentals       NumberRental[]
  trialState          TrialState?
  resellerAccount     ResellerAccount? @relation("ResellerParent") // set if this workspace IS a reseller parent
  retentionPolicy     RetentionPolicy?
  gdprRequests        GdprRequest[]
  onboardingState     OnboardingState?
  kycRecords          KycRecord[]
  auditLogs           AuditLog[]
  apiKeys             ApiKey[]
  invites             WorkspaceInvite[]
  ssoIdentities       SsoIdentity[]
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  fullName     String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  memberships   Membership[]
  sessions      Session[]
  totpSecret    TotpSecret?
  ssoIdentities SsoIdentity[]
  apiKeysCreated      ApiKey[]
  invitesSent         WorkspaceInvite[]
  transfersAccepted   TransferRequest[]
  callbackTasksAssigned CallbackTask[]
}

model Membership {
  id          String   @id @default(cuid())
  userId      String
  workspaceId String
  role        Role     @default(VIEWER)
  // Granular feature-level permission overrides on top of the role (spec 3.2).
  // Permission keys are strings like "agents:write", "billing:read".
  grantedPermissions String[] @default([])
  revokedPermissions String[] @default([])
  createdAt   DateTime @default(now())

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
  @@index([workspaceId])
}

model Session {
  id                String   @id @default(cuid())
  token             String   @unique
  userId            String
  activeWorkspaceId String?
  deviceName        String?
  ipAddress         String?
  userAgent         String?
  lastSeenAt        DateTime @default(now())
  revokedAt         DateTime? // set by forced logout (spec 3.3)
  expiresAt         DateTime
  createdAt         DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model AuditLog {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String?
  action      String
  entity      String
  entityId    String?
  metadata    Json?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
}

model ApiKey {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  keyPrefix   String   // first 8 chars, shown in UI, e.g. "vaani_k1"
  keyHash     String   @unique // sha256 hex of the full key; the key itself is never stored
  scopes      String[] @default([]) // e.g. ["calls:read","campaigns:write"]
  ipAllowlist String[] @default([]) // CIDR strings; empty = any IP allowed
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  revokedAt   DateTime?
  createdByUserId String?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy User?     @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@index([workspaceId])
}

model WorkspaceInvite {
  id          String   @id @default(cuid())
  workspaceId String
  email       String
  role        Role     @default(VIEWER)
  token       String   @unique
  status      InviteStatus @default(PENDING)
  invitedByUserId String?
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  invitedBy User?     @relation(fields: [invitedByUserId], references: [id], onDelete: SetNull)

  @@index([workspaceId])
}

model TotpSecret {
  id        String   @id @default(cuid())
  userId    String   @unique
  secret    String   // base32 TOTP secret
  status    TotpStatus @default(PENDING) // PENDING until first successful verify
  enabledAt DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model SsoIdentity {
  id                String      @id @default(cuid())
  userId            String
  workspaceId       String? // set when an enterprise SAML/OIDC IdP is tied to one workspace
  provider          SsoProvider
  externalSubjectId String // the IdP "sub" claim
  email             String?
  createdAt         DateTime    @default(now())

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([provider, externalSubjectId])
  @@index([userId])
  @@index([workspaceId])
}
```

**Continue the SAME file** — append the block below to `prisma/schema.prisma` (voice
agents, knowledge, tools, telephony):

```prisma
// ---------- Voice Agents, Knowledge & Telephony ----------

enum AgentStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum VersionStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum KnowledgeDocType {
  PDF
  DOCX
  URL
  FAQ
}

enum KnowledgeIndexStatus {
  PENDING
  INDEXING
  INDEXED
  FAILED
}

enum AgentToolType {
  CALENDAR_BOOKING
  HUMAN_TRANSFER
  SMS
  WHATSAPP
  CRM_WRITE
  PAYMENT_LINK
  CUSTOM_WEBHOOK
  VOICEMAIL
}

enum NumberType {
  LOCAL
  TOLLFREE
  MOBILE
  SERIES_140  // TRAI promotional series
  SERIES_1600 // TRAI service/transactional series
}

model Agent {
  id               String      @id @default(cuid())
  workspaceId      String
  name             String
  template         String?     // e.g. "clinic-receptionist"
  systemPrompt     String
  greeting         String
  languageMode     String      @default("auto") // auto | fixed | caller-select
  fixedLanguage    String?     // e.g. "hi", "en-IN"
  voiceId          String      @default("anushka") // Sarvam Bulbul speaker
  llmModel         String      @default("meta-llama/llama-3.1-70b-instruct")
  maxCallSeconds   Int         @default(600)
  recordingDisclosureText String? // overrides Workspace.recordingDisclosureText
  dograhWorkflowId String?     // set after publishing to Dograh (mirrors latest published AgentVersion)
  status           AgentStatus @default(DRAFT)
  version          Int         @default(1) // mirrors latest AgentVersion.version
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  workspace    Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  versions     AgentVersion[]
  knowledgeDocuments KnowledgeDocument[]
  toolConfigs  AgentToolConfig[]
  phoneNumbers PhoneNumber[]
  campaigns    Campaign[]
  calls        Call[]

  @@index([workspaceId])
}

model AgentVersion {
  id               String        @id @default(cuid())
  agentId          String
  workspaceId      String
  version          Int
  status           VersionStatus @default(DRAFT)
  label            String? // e.g. "v3 — shorter greeting"
  systemPrompt     String
  greeting         String
  config           Json?    // snapshot: voiceId, llmModel, languageMode, tools
  dograhWorkflowId String?  // Dograh workflow created for THIS version
  isAbVariant      Boolean  @default(false)
  abTrafficPercent Int?     // 0-100; set only on A/B variants, variants of one agent sum to 100
  publishedAt      DateTime?
  createdByUserId  String?
  createdAt        DateTime @default(now())

  agent     Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([agentId, version])
  @@index([workspaceId])
}

model KnowledgeDocument {
  id          String   @id @default(cuid())
  workspaceId String
  agentId     String? // null = shared knowledge for all agents in the workspace
  type        KnowledgeDocType
  title       String
  sourceUrl   String? // for type URL
  storageKey  String? // MinIO key for uploaded PDF/DOCX
  contentText String? // extracted plain text (also used for FAQ entries)
  status      KnowledgeIndexStatus @default(PENDING)
  error       String?
  reindexIntervalHours Int? // null = no scheduled re-index
  lastIndexedAt DateTime?
  nextReindexAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agent     Agent?    @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([agentId])
}

model AgentToolConfig {
  id      String        @id @default(cuid())
  agentId String
  tool    AgentToolType
  enabled Boolean       @default(true)
  config  Json? // per-tool settings: calendarId, webhook url+headers, message template, queue/skill...
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@unique([agentId, tool])
}

model MarketplaceTemplate {
  id               String   @id @default(cuid())
  authorWorkspaceId String // workspace that published it; the seed workspace authors the starter templates
  name             String
  industry         String
  description      String
  systemPrompt     String
  greeting         String
  config           Json? // suggested voice/llm/tools
  installs         Int      @default(0)
  published        Boolean  @default(false)
  createdAt        DateTime @default(now())

  authorWorkspace Workspace @relation(fields: [authorWorkspaceId], references: [id], onDelete: Cascade)

  @@index([authorWorkspaceId])
  @@index([industry, published])
}

model PhoneNumber {
  id             String   @id @default(cuid())
  workspaceId    String
  number         String   // E.164, e.g. "+9180XXXXXX01"
  label          String?
  provider       String   @default("vobiz")
  vobizNumberId  String?
  numberType     NumberType @default(LOCAL)
  agentId        String?
  poolId         String?  // NumberPool this DID rotates in (outbound)
  monthlyRentPaise Int    @default(0) // what we charge the tenant (wholesale + margin)
  dailyCallCap   Int?     // spam-flag protection (spec 6.1)
  lifetimeCallCap Int?
  dailyCallsUsed   Int    @default(0) // reset by the nightly worker
  lifetimeCallsUsed Int   @default(0)
  createdAt      DateTime @default(now())

  workspace Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agent     Agent?     @relation(fields: [agentId], references: [id], onDelete: SetNull)
  pool      NumberPool? @relation(fields: [poolId], references: [id], onDelete: SetNull)
  rentals   NumberRental[]
  voicemailMessages VoicemailMessage[]

  @@unique([workspaceId, number])
  @@index([workspaceId])
}

model NumberPool {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  numbers   PhoneNumber[]
  campaigns Campaign[]

  @@index([workspaceId])
}
```

**Continue the SAME file** — append the block below (contacts, campaigns, WhatsApp,
calls, human-in-the-loop):

```prisma
// ---------- Contacts & Campaigns ----------

enum CampaignStatus {
  DRAFT
  SCHEDULED
  RUNNING
  PAUSED
  COMPLETED
  CANCELLED
}

enum CampaignType {
  LEAD_QUALIFICATION
  APPOINTMENT_REMINDER
  PAYMENT_REMINDER
  FEEDBACK_SURVEY
  ORDER_CONFIRMATION
  REACTIVATION
  EVENT_INVITE
  POLITICAL_SURVEY
}

enum AmdPolicy {
  HANGUP
  LEAVE_MESSAGE
}

enum CallbackStatus {
  PENDING
  DONE
  CANCELLED
}

enum WhatsAppTemplateStatus {
  DRAFT
  PENDING
  APPROVED
  REJECTED
}

enum DncSource {
  OPT_OUT  // caller said "stop calling me" / opted out mid-call
  REGISTRY // TRAI DND registry scrubbing
  MANUAL   // uploaded/added by a workspace user
}

model ContactList {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  contacts  Contact[]
  campaigns Campaign[]
  whatsAppCampaigns WhatsAppCampaign[]

  @@index([workspaceId])
}

model Contact {
  id          String   @id @default(cuid())
  workspaceId String
  listId      String?
  phone       String   // E.164
  name        String?
  attributes  Json?    // arbitrary CSV columns, e.g. {"city":"Pune","loan_id":"LN123"}
  dnc         Boolean  @default(false) // fast flag kept in sync with DncEntry
  timezone    String?  // IANA, e.g. "Asia/Kolkata" — per-contact dialing windows
  consentAt   DateTime?  // TCPA-style consent timestamp (spec 11)
  consentSource String?  // e.g. "web-form", "csv-upload", "verbal"
  optOutAt    DateTime?  // set when the contact opts out mid-call or via SMS
  crmExternalId String?  // id of this contact in the connected CRM (two-way sync)
  createdAt   DateTime @default(now())

  workspace Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  list      ContactList? @relation(fields: [listId], references: [id], onDelete: SetNull)
  campaignContacts CampaignContact[]
  callbackTasks CallbackTask[]

  @@unique([workspaceId, phone])
  @@index([workspaceId])
}

model DncEntry {
  id          String   @id @default(cuid())
  workspaceId String
  phone       String   // E.164
  source      DncSource
  reason      String?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, phone])
  @@index([workspaceId])
}

model Campaign {
  id             String         @id @default(cuid())
  workspaceId    String
  name           String
  type           CampaignType   @default(LEAD_QUALIFICATION)
  agentId        String
  listId         String
  status         CampaignStatus @default(DRAFT)
  callsPerMinute Int            @default(10) // pacing cap
  concurrency    Int            @default(1)  // max simultaneous calls
  maxAttempts    Int            @default(2)
  retryDelayMin  Int            @default(60)
  retryPolicy    Json? // per-disposition overrides, e.g. {"busy":{"attempts":3,"delayMin":30},"no-answer":{"attempts":2,"delayMin":120},"voicemail":{"attempts":1,"delayMin":1440}}
  callingWindowStart String     @default("09:00") // HH:mm, tenant-local
  callingWindowEnd   String     @default("19:00")
  timezoneWindows Json? // optional day-of-week rules, e.g. {"timezone":"Asia/Kolkata","days":[1,2,3,4,5],"windows":[["09:00","13:00"],["16:00","19:00"]]}
  openingHook       String? // configurable first-15-seconds opener (spec 6.2)
  objectionPlaybook String? // LLM guidance text for objection handling
  amdPolicy      AmdPolicy @default(HANGUP) // voicemail/AMD behavior
  predictiveDialing Boolean @default(false) // over-dial ahead of agent availability
  poolId         String?  // NumberPool for DID rotation
  scheduledAt    DateTime?
  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  workspace Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agent     Agent            @relation(fields: [agentId], references: [id])
  list      ContactList      @relation(fields: [listId], references: [id])
  pool      NumberPool?      @relation(fields: [poolId], references: [id], onDelete: SetNull)
  contacts  CampaignContact[]
  calls     Call[]
  callbackTasks CallbackTask[]

  @@index([workspaceId])
}

enum CampaignContactStatus {
  PENDING
  DIALING
  COMPLETED
  FAILED
  RETRY_SCHEDULED
  SKIPPED_DNC
}

model CampaignContact {
  id           String                @id @default(cuid())
  campaignId   String
  contactId    String
  status       CampaignContactStatus @default(PENDING)
  attempts     Int                   @default(0)
  lastResult   String?               // last disposition: "no-answer", "busy", "completed", "voicemail"
  lastCallId   String?               // Call id of the most recent attempt
  nextAttemptAt DateTime?            // retry scheduling
  updatedAt    DateTime              @updatedAt

  campaign Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contact  Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@unique([campaignId, contactId])
  @@index([campaignId, status])
}

model CallbackTask {
  id          String   @id @default(cuid())
  workspaceId String
  contactId   String?
  campaignId  String?
  callId      String?  // the call where the caller asked for the callback
  phone       String   // E.164
  note        String?  // e.g. "call me tomorrow at 5 about the EMI"
  dueAt       DateTime
  status      CallbackStatus @default(PENDING)
  assignedToUserId String?
  completedAt DateTime?
  createdAt   DateTime @default(now())

  workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  contact    Contact?   @relation(fields: [contactId], references: [id], onDelete: SetNull)
  campaign   Campaign?  @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  call       Call?      @relation(fields: [callId], references: [id], onDelete: SetNull)
  assignedTo User?      @relation(fields: [assignedToUserId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status, dueAt])
}

model WhatsAppTemplate {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  language    String   @default("en")
  body        String   // template text with {{1}} {{2}} placeholders
  dltTemplateId String? // DLT registration id (spec 11)
  status      WhatsAppTemplateStatus @default(DRAFT)
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  campaigns WhatsAppCampaign[]

  @@index([workspaceId])
}

model WhatsAppCampaign {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  templateId  String
  listId      String?
  status      CampaignStatus @default(DRAFT)
  scheduledAt DateTime?
  startedAt   DateTime?
  finishedAt  DateTime?
  createdAt   DateTime @default(now())

  workspace Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  template  WhatsAppTemplate @relation(fields: [templateId], references: [id])
  list      ContactList?     @relation(fields: [listId], references: [id], onDelete: SetNull)

  @@index([workspaceId])
}

// ---------- Calls (CDR) & Human-in-the-Loop ----------

enum CallDirection {
  INBOUND
  OUTBOUND
}

enum CallStatus {
  RINGING
  IN_PROGRESS
  COMPLETED
  FAILED
  NO_ANSWER
  BUSY
  VOICEMAIL
}

enum AmdResult {
  UNKNOWN
  HUMAN
  MACHINE // voicemail / answering machine detected
}

enum InterestScore {
  HOT
  WARM
  COLD
}

enum LiveMode {
  NONE
  LISTEN
  WHISPER
  BARGE
  TAKEOVER
}

enum Speaker {
  AGENT
  CALLER
  SYSTEM
}

enum TransferStatus {
  QUEUED
  RINGING
  ACCEPTED
  COMPLETED
  CANCELLED
  NO_ANSWER
}

enum VoicemailStatus {
  NEW
  READ
  ARCHIVED
}

model Call {
  id             String        @id @default(cuid())
  workspaceId    String
  dograhCallId   String?       @unique
  direction      CallDirection
  status         CallStatus    @default(RINGING)
  fromNumber     String
  toNumber       String
  agentId        String?
  campaignId     String?
  startedAt      DateTime      @default(now())
  answeredAt     DateTime?
  endedAt        DateTime?
  durationSec    Int           @default(0)
  summary        String?
  sentiment      String?       // positive | neutral | negative
  outcome        String?       // e.g. "booked", "qualified", "not-interested", "message-taken"
  extractedEntities Json?      // e.g. {"name":"Ramesh","city":"Pune","loan_id":"LN123"}
  amdResult      AmdResult     @default(UNKNOWN)
  interestScore  InterestScore? // HOT/WARM/COLD lead classification (spec 6.2)
  interestReason String?        // why the classifier picked the score
  hallucinationFlag  Boolean    @default(false)
  hallucinationNotes String?
  deadAirSeconds     Int        @default(0) // total silence > 3s during the call
  scriptAdherenceScore Int?     // 0-100, set by QA scoring
  piiRedacted        Boolean    @default(false) // transcript was PII-redacted (spec 11)
  recordingKey   String?       // MinIO object key
  transcript     String?       // full plain-text transcript (full-text-search ready)
  costTelephonyPaise Int       @default(0)
  costSttPaise       Int       @default(0)
  costLlmPaise       Int       @default(0)
  costTtsPaise       Int       @default(0)
  billedPaise        Int       @default(0) // what WE charge the tenant (cost + markup)
  createdAt      DateTime      @default(now())

  workspace Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agent     Agent?     @relation(fields: [agentId], references: [id], onDelete: SetNull)
  campaign  Campaign?  @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  events    CallEvent[]
  transcriptEntries TranscriptEntry[]
  qaScores  QaScore[]
  liveState LiveCallState?
  transferRequests TransferRequest[]
  voicemailMessages VoicemailMessage[]
  callbackTasks CallbackTask[]

  @@index([workspaceId, createdAt])
  @@index([workspaceId, campaignId])
}

model CallEvent {
  id        String   @id @default(cuid())
  callId    String
  type      String   // "status" | "transcript" | "tool" | "summary"
  payload   Json
  createdAt DateTime @default(now())

  call Call @relation(fields: [callId], references: [id], onDelete: Cascade)

  @@index([callId, createdAt])
}

model TranscriptEntry {
  id          String   @id @default(cuid())
  callId      String
  speaker     Speaker
  text        String
  timestampMs Int      @default(0) // ms from call start
  createdAt   DateTime @default(now())

  call Call @relation(fields: [callId], references: [id], onDelete: Cascade)

  @@index([callId, timestampMs])
}

model LiveCallState {
  id          String   @id @default(cuid())
  workspaceId String
  callId      String   @unique // one row per in-progress call; delete when the call ends
  status      CallStatus @default(IN_PROGRESS)
  mode        LiveMode   @default(NONE) // supervisor listen/whisper/barge/takeover
  liveTranscript String?  // rolling tail of the transcript for the live dashboard
  supervisorUserId String?
  whisperContext   String? // coach text injected as LLM context in WHISPER mode
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  call      Call      @relation(fields: [callId], references: [id], onDelete: Cascade)

  @@index([workspaceId, status])
}

model TransferRequest {
  id          String   @id @default(cuid())
  workspaceId String
  callId      String
  queue       String?  // e.g. "sales", "support"
  skill       String?  // e.g. "hindi", "loans" — skills-based routing (spec 7)
  status      TransferStatus @default(QUEUED)
  reason      String?  // why the AI escalated (low confidence, explicit request, VIP...)
  contextSnapshot Json? // transcript + summary shown to the human before accepting
  acceptedByUserId String?
  acceptedAt  DateTime?
  createdAt   DateTime @default(now())

  workspace  Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  call       Call      @relation(fields: [callId], references: [id], onDelete: Cascade)
  acceptedBy User?     @relation(fields: [acceptedByUserId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status])
}

model VoicemailMessage {
  id            String   @id @default(cuid())
  workspaceId   String
  callId        String?
  phoneNumberId String?
  fromNumber    String
  transcript    String?  // voicemail-to-text (spec 5)
  recordingKey  String?
  status        VoicemailStatus @default(NEW)
  createdAt     DateTime @default(now())

  workspace   Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  call        Call?        @relation(fields: [callId], references: [id], onDelete: SetNull)
  phoneNumber PhoneNumber? @relation(fields: [phoneNumberId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status])
}
```

**Continue the SAME file** — append the block below (integrations, analytics/QA,
billing, compliance, onboarding). This completes `prisma/schema.prisma`:

```prisma
// ---------- Integrations ----------

enum CalendarProvider {
  GOOGLE
  MICROSOFT
  CALENDLY
  CALCOM
}

enum CrmProvider {
  HUBSPOT
  ZOHO
  SALESFORCE
  LEADSQUARED
  FRESHSALES
  PIPEDRIVE
}

enum WebhookDeliveryStatus {
  PENDING
  SUCCESS
  FAILED
}

model CalendarConnection {
  id          String   @id @default(cuid())
  workspaceId String
  provider    CalendarProvider
  accountEmail String?
  accessToken  String
  refreshToken String?
  tokenExpiresAt DateTime?
  primaryCalendarId String? // calendar used for availability checks + bookings
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, provider])
  @@index([workspaceId])
}

model CrmConnection {
  id          String   @id @default(cuid())
  workspaceId String
  provider    CrmProvider
  instanceUrl String? // e.g. Salesforce/Zoho instance URL
  accessToken  String
  refreshToken String?
  tokenExpiresAt DateTime?
  fieldMapping Json? // {"contact.name":"firstname","contact.phone":"phone","call.outcome":"hs_lead_status"}
  twoWaySyncEnabled Boolean @default(false)
  lastSyncAt  DateTime?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, provider])
  @@index([workspaceId])
}

model WebhookSubscription {
  id          String   @id @default(cuid())
  workspaceId String
  url         String
  events      String[] @default([]) // e.g. ["call.started","call.completed","lead.qualified","campaign.finished"]
  secret      String   // HMAC-SHA256 signing secret sent as X-Vaani-Signature
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  deliveries WebhookDelivery[]

  @@index([workspaceId])
}

model WebhookDelivery {
  id             String   @id @default(cuid())
  subscriptionId String
  event          String
  payload        Json
  status         WebhookDeliveryStatus @default(PENDING)
  attempts       Int      @default(0)
  responseCode   Int?
  nextRetryAt    DateTime? // consumed by the webhook retry worker
  deliveredAt    DateTime?
  createdAt      DateTime @default(now())

  subscription WebhookSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@index([status, nextRetryAt])
}

// ---------- Analytics & Quality ----------

enum DigestFrequency {
  DAILY
  WEEKLY
  MONTHLY
}

model QaScore {
  id          String   @id @default(cuid())
  workspaceId String
  callId      String
  rubricName  String   // e.g. "receptionist-default", "collections-compliance"
  scores      Json     // per-criterion: {"greeting":9,"compliance_lines":10,"closing":8}
  totalScore  Int
  maxScore    Int
  scorerModel String   // LLM that scored, e.g. "meta-llama/llama-3.1-70b-instruct"
  notes       String?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  call      Call      @relation(fields: [callId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
  @@index([callId])
}

model SavedReport {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  reportType  String   // "calls" | "campaign" | "cost" | "agent-performance"
  config      Json?    // filters, date range, grouping, columns
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  digests   ScheduledDigest[]

  @@index([workspaceId])
}

model ScheduledDigest {
  id          String   @id @default(cuid())
  workspaceId String
  reportId    String? // optional: digest of a specific SavedReport
  frequency   DigestFrequency
  recipients  String[] // email addresses
  active      Boolean  @default(true)
  lastSentAt  DateTime?
  createdAt   DateTime @default(now())

  workspace Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  report    SavedReport? @relation(fields: [reportId], references: [id], onDelete: SetNull)

  @@index([workspaceId])
}

// ---------- Billing ----------

enum PaymentProvider {
  RAZORPAY
  STRIPE
}

enum RentalStatus {
  ACTIVE
  ENDED
}

model Plan {
  id             String  @id @default(cuid())
  code           String  @unique // "starter" | "growth" | "enterprise"
  name           String
  monthlyPricePaise Int
  includedMinutes   Int
  maxAgents         Int
  maxSeats          Int
  concurrentLines   Int  @default(1)
  whiteLabel        Boolean @default(false)
  premiumVoices     Boolean @default(false)
  dedicatedInfra    Boolean @default(false)
  featureGates      Json?  // any extra gates, e.g. {"qa_scoring":true,"api_access":false}
  markupPercent     Int  @default(40) // our margin over wholesale cost

  subscriptions Subscription[]
}

model Subscription {
  id          String   @id @default(cuid())
  workspaceId String   @unique
  planId      String
  status      String   @default("active") // active | past_due | cancelled
  currentPeriodEnd DateTime
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  plan      Plan      @relation(fields: [planId], references: [id])
}

model Wallet {
  id          String   @id @default(cuid())
  workspaceId String   @unique
  balancePaise Int     @default(0)
  lowBalanceAlertPaise Int @default(50000) // ₹500
  updatedAt   DateTime @updatedAt

  workspace Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  transactions WalletTransaction[]
}

enum TxnType {
  TOPUP
  CALL_DEBIT
  NUMBER_RENT
  REFUND
  TRIAL_CREDIT
}

model WalletTransaction {
  id          String   @id @default(cuid())
  walletId    String
  type        TxnType
  amountPaise Int      // positive = credit, negative = debit
  balanceAfterPaise Int
  reference   String?  // call id / payment order id
  note        String?
  createdAt   DateTime @default(now())

  wallet Wallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([walletId, createdAt])
}

model Invoice {
  id             String   @id @default(cuid())
  workspaceId    String
  razorpayPaymentId String? @unique
  razorpayOrderId   String?
  amountPaise    Int      // taxable base (before GST)
  gstPaise       Int      @default(0) // total GST = cgst+sgst or igst (kept for quick display)
  gstin          String?  // customer GSTIN (B2B invoices)
  placeOfSupply  String?  // e.g. "Karnataka (29)"
  hsnSac         String?  // e.g. "998314"
  cgstPaise      Int      @default(0)
  sgstPaise      Int      @default(0)
  igstPaise      Int      @default(0)
  pdfKey         String?  // MinIO key of the generated GST invoice PDF
  status         String   @default("pending") // pending | paid | failed
  createdAt      DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
}

model PaymentOrder {
  id          String   @id @default(cuid())
  workspaceId String
  provider    PaymentProvider
  providerOrderId   String? @unique // razorpay order id / stripe payment intent id
  providerSessionId String? // stripe checkout session id
  amountPaise Int
  currency    String   @default("INR")
  status      String   @default("created") // created | paid | failed | expired
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
}

model AutoTopUp {
  id          String   @id @default(cuid())
  workspaceId String   @unique
  thresholdPaise Int   // trigger when wallet falls below this
  amountPaise    Int   // top-up amount
  active      Boolean  @default(true)
  paymentMethodRef String? // razorpay customer/token id for off-session charge
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

model NumberRental {
  id          String   @id @default(cuid())
  workspaceId String
  phoneNumberId String
  monthlyPricePaise Int
  marginPercent Int   @default(20) // our margin over the Vobiz wholesale rent
  status      RentalStatus @default(ACTIVE)
  startedAt   DateTime @default(now())
  endedAt     DateTime?

  workspace   Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  phoneNumber PhoneNumber @relation(fields: [phoneNumberId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}

model ResellerAccount {
  id          String   @id @default(cuid())
  parentWorkspaceId String @unique // the agency workspace
  wholesaleRateCard Json? // e.g. {"telephony_per_min_paise":45,"stt_per_min_paise":30,"tts_per_min_paise":40}
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())

  parentWorkspace Workspace @relation("ResellerParent", fields: [parentWorkspaceId], references: [id], onDelete: Cascade)
  children        Workspace[] @relation("ResellerChildren")
}

model TrialState {
  id          String   @id @default(cuid())
  workspaceId String   @unique
  trialMinutesUsed  Int @default(0)
  trialMinutesLimit Int @default(30)
  kycStatus   KycStatus @default(NOT_STARTED) // trial is KYC-gated to prevent abuse (spec 10)
  sandboxNumberId String? // PhoneNumber id of the free sandbox DID
  expiresAt   DateTime?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

// ---------- Compliance & Onboarding ----------

enum KycStatus {
  NOT_STARTED
  PENDING
  VERIFIED
  REJECTED
}

enum KycDocumentType {
  GST
  PAN
  AADHAAR
  INCORPORATION
  OTHER
}

enum GdprRequestType {
  EXPORT
  ERASURE
}

enum GdprRequestStatus {
  PENDING
  PROCESSING
  COMPLETED
  REJECTED
}

model RetentionPolicy {
  id          String   @id @default(cuid())
  workspaceId String   @unique
  recordingsDays  Int  @default(90)  // auto-delete recordings after N days
  transcriptsDays Int  @default(365) // auto-delete transcripts after N days
  autoDelete  Boolean  @default(true)
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

model GdprRequest {
  id          String   @id @default(cuid())
  workspaceId String
  type        GdprRequestType
  subjectPhone String? // the data subject (a caller/contact)
  subjectEmail String?
  status      GdprRequestStatus @default(PENDING)
  resultKey   String?  // MinIO key of the export archive (EXPORT only)
  completedAt DateTime?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, status])
}

model KycRecord {
  id          String   @id @default(cuid())
  workspaceId String
  documentType KycDocumentType
  documentRef  String? // e.g. GSTIN / PAN number
  storageKey   String? // MinIO key of the uploaded document
  status      KycStatus @default(PENDING)
  reviewedAt  DateTime?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}

model OnboardingState {
  id          String   @id @default(cuid())
  workspaceId String   @unique
  currentStep Int      @default(0) // wizard position (spec 13: industry → template → KB → test call → number → live)
  checklist   Json?    // e.g. {"industry":true,"template":true,"knowledge":false,"test_call":false,"number":false}
  sampleDataEnabled Boolean @default(false)
  completedAt DateTime?
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}
```

**Verify:**
```bash
cd /root/vaani-ai && npx prisma format && npx prisma validate
```
**Expected:** `Prisma schema loaded from prisma/schema.prisma` and
`The schema at prisma/schema.prisma is valid 🚀` (or "valid" without the emoji).
`prisma format` may re-indent the file — that is fine, do not revert it.
**If it fails:** the error names the line — fix the schema to match the guide text
exactly (most common: a missing closing brace, or a missing code-fence separator
between the append blocks, from a copy truncation). Do NOT delete models to make the error go away.

---

## Step 2: Run the first migration

Make sure dev infra from guide 01 is up: `docker compose ps` shows `vaani-db` healthy.
If a previous attempt at this guide already created `prisma/migrations/`, delete that
folder first (`rm -rf prisma/migrations`) — this guide ships ONE `init` migration.

**Do:**
```bash
cd /root/vaani-ai
npx prisma migrate dev --name init
```

**Expected:** `Applying migration '...._init'` then `Your database is now in sync with
your schema.` and `✔ Generated Prisma Client`.
**If it fails:**
- `Can't reach database server` → `docker compose up -d && sleep 10` then retry.
- `P1001`/auth errors → confirm `DATABASE_URL` in `.env` matches
  `postgresql://vaani:vaani_dev_password@localhost:5432/vaani`.

---

## Step 3: Prisma client singleton + money helpers

**File `src/lib/db.ts`:**
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

**File `src/lib/money.ts`:**
```ts
/** All money in this codebase is integer paise (1 INR = 100 paise). Never floats. */

export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

/** Apply our markup % to a wholesale cost. */
export function withMarkup(costPaise: number, markupPercent: number): number {
  return Math.round(costPaise * (1 + markupPercent / 100));
}

/** Per-second call billing: bill ceil(seconds * perMinutePaise / 60). */
export function billForSeconds(seconds: number, perMinutePaise: number): number {
  if (seconds <= 0) return 0;
  return Math.ceil((seconds * perMinutePaise) / 60);
}

/**
 * Split GST on a taxable base amount (GST rate 18% by default).
 * Intra-state supply → CGST + SGST (9% + 9%); inter-state → IGST (18%).
 * cgst/sgst are split with floor/remainder so cgst + sgst always equals the total.
 */
export function splitGst(
  basePaise: number,
  interState: boolean,
  ratePercent = 18,
): { cgstPaise: number; sgstPaise: number; igstPaise: number; totalGstPaise: number } {
  const totalGstPaise = Math.round((basePaise * ratePercent) / 100);
  if (interState) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: totalGstPaise, totalGstPaise };
  }
  const cgstPaise = Math.floor(totalGstPaise / 2);
  const sgstPaise = totalGstPaise - cgstPaise;
  return { cgstPaise, sgstPaise, igstPaise: 0, totalGstPaise };
}

/** Total wholesale cost of a call from its 4 components. */
export function callCostPaise(parts: {
  telephonyPaise: number;
  sttPaise: number;
  llmPaise: number;
  ttsPaise: number;
}): number {
  return parts.telephonyPaise + parts.sttPaise + parts.llmPaise + parts.ttsPaise;
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** silent, exit 0.
**If it fails:** `prisma generate` was not run — run `npx prisma generate` and retry.

---

## Step 4: Unit tests for money helpers (Vitest)

Install the pinned test runner (already pinned in 00_MASTER_PLAN §3 — safe even if
already installed):
```bash
cd /root/vaani-ai && npm install --save-dev vitest@2.1.3
```

Add this to `package.json` inside the existing `"scripts"` block (merge, do not
replace other scripts):
```json
"test": "vitest run"
```

**File `tests/money.test.ts`:**
```ts
import { describe, expect, it } from "vitest";
import {
  billForSeconds,
  callCostPaise,
  formatINR,
  paiseToRupees,
  splitGst,
  withMarkup,
} from "../src/lib/money";

describe("paiseToRupees", () => {
  it("converts integer paise to a 2-decimal rupee string", () => {
    expect(paiseToRupees(299900)).toBe("2999.00");
    expect(paiseToRupees(92)).toBe("0.92");
    expect(paiseToRupees(0)).toBe("0.00");
  });
});

describe("formatINR", () => {
  it("formats with Indian digit grouping", () => {
    expect(formatINR(2499900)).toContain("24,999.00");
    expect(formatINR(100000)).toContain("1,000.00");
  });
});

describe("withMarkup", () => {
  it("applies percentage markup with integer rounding", () => {
    expect(withMarkup(100, 40)).toBe(140);
    expect(withMarkup(259, 40)).toBe(363); // 362.6 rounds to 363
    expect(withMarkup(0, 50)).toBe(0);
  });
});

describe("billForSeconds", () => {
  it("bills per-second, rounding up to the next paise", () => {
    expect(billForSeconds(60, 100)).toBe(100);
    expect(billForSeconds(30, 100)).toBe(50);
    expect(billForSeconds(31, 100)).toBe(52); // 51.67 -> 52
    expect(billForSeconds(0, 100)).toBe(0);
    expect(billForSeconds(-5, 100)).toBe(0);
  });
});

describe("splitGst", () => {
  it("splits 18% into CGST+SGST for intra-state supply", () => {
    const r = splitGst(100000, false);
    expect(r.totalGstPaise).toBe(18000);
    expect(r.cgstPaise).toBe(9000);
    expect(r.sgstPaise).toBe(9000);
    expect(r.igstPaise).toBe(0);
  });

  it("uses IGST only for inter-state supply", () => {
    const r = splitGst(100000, true);
    expect(r.igstPaise).toBe(18000);
    expect(r.cgstPaise).toBe(0);
    expect(r.sgstPaise).toBe(0);
  });

  it("keeps cgst + sgst == total on odd amounts", () => {
    const r = splitGst(101, false); // total 18 paise
    expect(r.cgstPaise + r.sgstPaise).toBe(r.totalGstPaise);
  });

  it("respects a custom rate", () => {
    expect(splitGst(1000, true, 5).igstPaise).toBe(50);
  });
});

describe("callCostPaise", () => {
  it("sums the four cost components", () => {
    expect(
      callCostPaise({ telephonyPaise: 92, sttPaise: 55, llmPaise: 38, ttsPaise: 74 }),
    ).toBe(259);
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/money.test.ts
```
**Expected:** `✓ tests/money.test.ts (9 tests)` (9 test cases across 6 describe
blocks, all pass), `Test Files  1 passed (1)`, exit code 0.
**If it fails:**
- `Cannot find module '../src/lib/money'` → you are in the wrong directory or the file
  path is wrong; confirm `ls src/lib/money.ts` exists and re-run from `/root/vaani-ai`.
- A single assertion mismatch → fix the TEST to match the guide (never change
  `src/lib/money.ts` logic).

---

## Step 5: Seed script — plans, demo workspace, demo user, demo data for EVERY domain

**File `prisma/seed.ts`** (full content):

```ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";

const db = new PrismaClient();

async function main() {
  // --- Plans (with feature gates) ---
  const starter = await db.plan.upsert({
    where: { code: "starter" },
    update: { concurrentLines: 2, whiteLabel: false, premiumVoices: false, dedicatedInfra: false },
    create: {
      code: "starter",
      name: "Starter",
      monthlyPricePaise: 299900, // ₹2,999/mo
      includedMinutes: 500,
      maxAgents: 2,
      maxSeats: 2,
      concurrentLines: 2,
      whiteLabel: false,
      premiumVoices: false,
      dedicatedInfra: false,
      featureGates: { qa_scoring: false, api_access: false },
      markupPercent: 40,
    },
  });
  await db.plan.upsert({
    where: { code: "growth" },
    update: { concurrentLines: 10, whiteLabel: false, premiumVoices: true, dedicatedInfra: false },
    create: {
      code: "growth",
      name: "Growth",
      monthlyPricePaise: 799900, // ₹7,999/mo
      includedMinutes: 2500,
      maxAgents: 10,
      maxSeats: 10,
      concurrentLines: 10,
      whiteLabel: false,
      premiumVoices: true,
      dedicatedInfra: false,
      featureGates: { qa_scoring: true, api_access: true },
      markupPercent: 45,
    },
  });
  await db.plan.upsert({
    where: { code: "enterprise" },
    update: { concurrentLines: 100, whiteLabel: true, premiumVoices: true, dedicatedInfra: true },
    create: {
      code: "enterprise",
      name: "Enterprise",
      monthlyPricePaise: 2499900, // ₹24,999/mo
      includedMinutes: 12000,
      maxAgents: 100,
      maxSeats: 50,
      concurrentLines: 100,
      whiteLabel: true,
      premiumVoices: true,
      dedicatedInfra: true,
      featureGates: { qa_scoring: true, api_access: true, saml_sso: true, reseller_panel: true },
      markupPercent: 50,
    },
  });

  // --- Demo workspace + user (login: demo@vaani.ai / demo1234) ---
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const user = await db.user.upsert({
    where: { email: "demo@vaani.ai" },
    update: {},
    create: { email: "demo@vaani.ai", passwordHash, fullName: "Demo Owner" },
  });

  const workspace = await db.workspace.upsert({
    where: { slug: "demo-clinic" },
    update: {},
    create: {
      name: "Demo Dental Clinic",
      slug: "demo-clinic",
      industry: "healthcare",
      primaryColor: "#7c3aed",
      recordingDisclosureText:
        "This call may be recorded for quality and training purposes.",
    },
  });

  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });

  await db.wallet.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: { workspaceId: workspace.id, balancePaise: 100000 }, // ₹1,000 trial credit
  });

  await db.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      planId: starter.id,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // --- Auth & tenancy extras: API key, invite, TOTP (pending), SSO identity ---
  await db.apiKey.upsert({
    where: { keyHash: createHash("sha256").update("demo-api-key-do-not-use").digest("hex") },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "Demo read-only key",
      keyPrefix: "vaani_de",
      keyHash: createHash("sha256").update("demo-api-key-do-not-use").digest("hex"),
      scopes: ["calls:read", "contacts:read"],
      ipAllowlist: [],
      createdByUserId: user.id,
    },
  });

  await db.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      email: "receptionist@democlinic.example",
      role: "AGENT",
      token: "demo-invite-token-001",
      status: "PENDING",
      invitedByUserId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await db.totpSecret.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, secret: "JBSWY3DPEHPK3PXP", status: "PENDING" },
  });

  await db.ssoIdentity.create({
    data: {
      userId: user.id,
      provider: "GOOGLE",
      externalSubjectId: "google-sub-demo-0001",
      email: "demo@vaani.ai",
    },
  });

  // --- Demo agent (template: clinic receptionist) ---
  const agent = await db.agent.create({
    data: {
      workspaceId: workspace.id,
      name: "Front Desk — Priya",
      template: "clinic-receptionist",
      greeting:
        "Namaste! Thank you for calling Demo Dental Clinic. Main aapki kya madad kar sakti hoon?",
      systemPrompt: `You are Priya, the AI receptionist of Demo Dental Clinic, Bengaluru.
You speak Hindi, English, and Hinglish, matching the caller's language.
Your jobs: (1) answer FAQs — timings 10am-8pm Mon-Sat, address MG Road, (2) book,
reschedule or cancel appointments, (3) take a message for the doctor.
Rules: be warm and concise, never give medical advice, confirm name + phone number
before booking, and if the caller is upset or asks for a human, say you will have the
clinic manager call back. End every call by summarizing what was agreed.`,
      languageMode: "auto",
      voiceId: "anushka",
      status: "DRAFT",
    },
  });

  // --- Agent builder: version, knowledge doc, tool configs, marketplace template ---
  await db.agentVersion.create({
    data: {
      agentId: agent.id,
      workspaceId: workspace.id,
      version: 1,
      status: "DRAFT",
      label: "v1 — initial from clinic-receptionist template",
      systemPrompt: agent.systemPrompt,
      greeting: agent.greeting,
      config: { voiceId: "anushka", llmModel: "meta-llama/llama-3.1-70b-instruct", languageMode: "auto" },
      createdByUserId: user.id,
    },
  });

  await db.knowledgeDocument.create({
    data: {
      workspaceId: workspace.id,
      agentId: agent.id,
      type: "FAQ",
      title: "Clinic FAQ — timings, pricing, location",
      contentText:
        "Q: What are your timings? A: 10am-8pm, Monday to Saturday.\nQ: How much is teeth cleaning? A: ₹1,500.\nQ: Where are you located? A: MG Road, Bengaluru.",
      status: "INDEXED",
      lastIndexedAt: new Date(),
      reindexIntervalHours: 24,
      nextReindexAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await db.agentToolConfig.createMany({
    data: [
      {
        agentId: agent.id,
        tool: "CALENDAR_BOOKING",
        enabled: true,
        config: { provider: "google", calendarId: "primary", slotMinutes: 30 },
      },
      {
        agentId: agent.id,
        tool: "HUMAN_TRANSFER",
        enabled: true,
        config: { queue: "clinic-front-desk", skill: "hindi", whisperSummary: true },
      },
      {
        agentId: agent.id,
        tool: "VOICEMAIL",
        enabled: true,
        config: { transcribe: true, notifyEmail: "frontdesk@democlinic.example" },
      },
    ],
  });

  await db.marketplaceTemplate.create({
    data: {
      authorWorkspaceId: workspace.id,
      name: "Dental Clinic Receptionist",
      industry: "healthcare",
      description: "Answers FAQs, books appointments, takes messages for dental clinics.",
      systemPrompt: agent.systemPrompt,
      greeting: agent.greeting,
      config: { voiceId: "anushka", tools: ["CALENDAR_BOOKING", "VOICEMAIL"] },
      installs: 0,
      published: true,
    },
  });

  // --- Telephony: number pool + two DIDs with caps + a rental ---
  const pool = await db.numberPool.create({
    data: { workspaceId: workspace.id, name: "Outbound pool — Bengaluru" },
  });

  const phone1 = await db.phoneNumber.create({
    data: {
      workspaceId: workspace.id,
      number: "+918040001234",
      label: "Front desk (inbound)",
      numberType: "LOCAL",
      agentId: agent.id,
      monthlyRentPaise: 25000, // ₹250/mo
    },
  });

  const phone2 = await db.phoneNumber.create({
    data: {
      workspaceId: workspace.id,
      number: "+911400001234",
      label: "Promotional 140 series",
      numberType: "SERIES_140",
      poolId: pool.id,
      monthlyRentPaise: 35000, // ₹350/mo
      dailyCallCap: 200,
      lifetimeCallCap: 10000,
    },
  });

  await db.numberRental.create({
    data: {
      workspaceId: workspace.id,
      phoneNumberId: phone1.id,
      monthlyPricePaise: 25000,
      marginPercent: 25,
      status: "ACTIVE",
    },
  });

  // --- Contacts & DNC ---
  const list = await db.contactList.create({
    data: { workspaceId: workspace.id, name: "Appointment reminders — July" },
  });
  await db.contact.createMany({
    data: [
      { workspaceId: workspace.id, listId: list.id, phone: "+919900000001", name: "Ravi Kumar", attributes: { city: "Bengaluru" }, timezone: "Asia/Kolkata", consentAt: new Date(), consentSource: "web-form" },
      { workspaceId: workspace.id, listId: list.id, phone: "+919900000002", name: "Sunita Sharma", attributes: { city: "Mysuru" }, timezone: "Asia/Kolkata", consentAt: new Date(), consentSource: "csv-upload", crmExternalId: "hs-88321" },
      { workspaceId: workspace.id, listId: list.id, phone: "+919900000003", name: "Amit Patel", attributes: { city: "Hubballi" }, dnc: true, optOutAt: new Date() },
    ],
  });

  await db.dncEntry.upsert({
    where: { workspaceId_phone: { workspaceId: workspace.id, phone: "+919900000003" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      phone: "+919900000003",
      source: "OPT_OUT",
      reason: "Caller said 'stop calling me' on 2024-07-02",
    },
  });

  // --- Demo campaign with full outbound config ---
  const campaign = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      name: "July checkup reminders",
      type: "APPOINTMENT_REMINDER",
      agentId: agent.id,
      listId: list.id,
      status: "DRAFT",
      callsPerMinute: 5,
      concurrency: 2,
      retryPolicy: { busy: { attempts: 3, delayMin: 30 }, "no-answer": { attempts: 2, delayMin: 120 } },
      timezoneWindows: { timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5, 6], windows: [["10:00", "19:00"]] },
      openingHook: "Namaste, this is Priya calling from Demo Dental Clinic about your upcoming checkup.",
      objectionPlaybook: "If the caller says they are busy, offer two alternative slots. If they say cost is an issue, mention the ₹999 first-visit offer.",
      amdPolicy: "LEAVE_MESSAGE",
      poolId: pool.id,
    },
  });

  const ravi = await db.contact.findUnique({
    where: { workspaceId_phone: { workspaceId: workspace.id, phone: "+919900000001" } },
  });
  if (ravi) {
    await db.campaignContact.create({
      data: { campaignId: campaign.id, contactId: ravi.id, status: "PENDING" },
    });
  }

  // --- Calls: one completed inbound (with intelligence fields) + one live call ---
  const call = await db.call.create({
    data: {
      workspaceId: workspace.id,
      direction: "INBOUND",
      status: "COMPLETED",
      fromNumber: "+919812345678",
      toNumber: phone1.number,
      agentId: agent.id,
      durationSec: 184,
      summary:
        "Caller Ramesh asked about teeth-cleaning pricing (₹1,500) and booked a slot for Saturday 11am. Confirmed phone number. Sent no SMS (demo).",
      sentiment: "positive",
      outcome: "booked",
      extractedEntities: { name: "Ramesh", service: "teeth cleaning", slot: "Saturday 11am", price_inr: 1500 },
      interestScore: "HOT",
      interestReason: "Caller asked for price and completed a booking in the same call.",
      deadAirSeconds: 2,
      scriptAdherenceScore: 94,
      transcript:
        "AI: Namaste! Thank you for calling Demo Dental Clinic...\nCaller: Kitna charge hai cleaning ka?\nAI: Cleaning ka charge ₹1,500 hai...",
      costTelephonyPaise: 92,
      costSttPaise: 55,
      costLlmPaise: 38,
      costTtsPaise: 74,
      billedPaise: 362,
    },
  });

  await db.transcriptEntry.createMany({
    data: [
      { callId: call.id, speaker: "AGENT", text: "Namaste! Thank you for calling Demo Dental Clinic. Main aapki kya madad kar sakti hoon?", timestampMs: 0 },
      { callId: call.id, speaker: "CALLER", text: "Kitna charge hai cleaning ka?", timestampMs: 4200 },
      { callId: call.id, speaker: "AGENT", text: "Cleaning ka charge ₹1,500 hai. Kya main aapke liye slot book kar doon?", timestampMs: 7100 },
    ],
  });

  await db.qaScore.create({
    data: {
      workspaceId: workspace.id,
      callId: call.id,
      rubricName: "receptionist-default",
      scores: { greeting: 10, compliance_lines: 10, faq_accuracy: 9, closing: 8 },
      totalScore: 37,
      maxScore: 40,
      scorerModel: "meta-llama/llama-3.1-70b-instruct",
      notes: "Greeting and disclosure perfect; closing summary slightly rushed.",
    },
  });

  const liveCall = await db.call.create({
    data: {
      workspaceId: workspace.id,
      direction: "INBOUND",
      status: "IN_PROGRESS",
      fromNumber: "+919876500001",
      toNumber: phone1.number,
      agentId: agent.id,
      answeredAt: new Date(),
    },
  });

  await db.liveCallState.create({
    data: {
      workspaceId: workspace.id,
      callId: liveCall.id,
      status: "IN_PROGRESS",
      mode: "NONE",
      liveTranscript: "AI: Namaste! ... Caller: Mujhe appointment chahiye tha",
    },
  });

  await db.transferRequest.create({
    data: {
      workspaceId: workspace.id,
      callId: liveCall.id,
      queue: "clinic-front-desk",
      skill: "hindi",
      status: "QUEUED",
      reason: "Caller explicitly asked for a human",
      contextSnapshot: { summary: "Caller wants to reschedule a root-canal appointment.", sentiment: "neutral" },
    },
  });

  await db.voicemailMessage.create({
    data: {
      workspaceId: workspace.id,
      callId: call.id,
      phoneNumberId: phone1.id,
      fromNumber: "+919812345678",
      transcript: "Hello, this is Ramesh. Please confirm my Saturday appointment. Thank you.",
      status: "NEW",
    },
  });

  await db.callbackTask.create({
    data: {
      workspaceId: workspace.id,
      contactId: ravi?.id,
      campaignId: campaign.id,
      phone: "+919900000001",
      note: "Caller said: call me tomorrow at 5 about the cleaning offer",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: "PENDING",
      assignedToUserId: user.id,
    },
  });

  // --- WhatsApp ---
  const waTemplate = await db.whatsAppTemplate.create({
    data: {
      workspaceId: workspace.id,
      name: "appointment_confirmation",
      language: "en",
      body: "Hi {{1}}, your appointment at Demo Dental Clinic is confirmed for {{2}}. Reply C to cancel.",
      dltTemplateId: "DLT-TPL-DEMO-001",
      status: "APPROVED",
    },
  });

  await db.whatsAppCampaign.create({
    data: {
      workspaceId: workspace.id,
      name: "July appointment confirmations",
      templateId: waTemplate.id,
      listId: list.id,
      status: "DRAFT",
    },
  });

  // --- Integrations: calendar, CRM, webhook + a delivery ---
  await db.calendarConnection.upsert({
    where: { workspaceId_provider: { workspaceId: workspace.id, provider: "GOOGLE" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      provider: "GOOGLE",
      accountEmail: "democlinic@example.com",
      accessToken: "demo-access-token",
      refreshToken: "demo-refresh-token",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      primaryCalendarId: "primary",
      active: true,
    },
  });

  await db.crmConnection.upsert({
    where: { workspaceId_provider: { workspaceId: workspace.id, provider: "HUBSPOT" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      provider: "HUBSPOT",
      accessToken: "demo-hubspot-token",
      fieldMapping: { "contact.name": "firstname", "contact.phone": "phone", "call.outcome": "hs_lead_status" },
      twoWaySyncEnabled: true,
      active: true,
    },
  });

  const webhook = await db.webhookSubscription.create({
    data: {
      workspaceId: workspace.id,
      url: "https://democlinic.example/hooks/vaani",
      events: ["call.started", "call.completed", "lead.qualified"],
      secret: "whsec_demo_0123456789abcdef",
      active: true,
    },
  });

  await db.webhookDelivery.create({
    data: {
      subscriptionId: webhook.id,
      event: "call.completed",
      payload: { callId: call.id, outcome: "booked", durationSec: 184 },
      status: "SUCCESS",
      attempts: 1,
      responseCode: 200,
      deliveredAt: new Date(),
    },
  });

  // --- Analytics: saved report + scheduled digest ---
  const report = await db.savedReport.create({
    data: {
      workspaceId: workspace.id,
      name: "Weekly inbound summary",
      reportType: "calls",
      config: { direction: "INBOUND", groupBy: "day", metrics: ["count", "avg_duration", "cost"] },
    },
  });

  await db.scheduledDigest.create({
    data: {
      workspaceId: workspace.id,
      reportId: report.id,
      frequency: "WEEKLY",
      recipients: ["owner@democlinic.example"],
      active: true,
    },
  });

  // --- Billing: payment order, auto top-up, GST invoice ---
  await db.paymentOrder.create({
    data: {
      workspaceId: workspace.id,
      provider: "RAZORPAY",
      providerOrderId: "order_DemoSeed0001",
      amountPaise: 100000,
      currency: "INR",
      status: "paid",
    },
  });

  await db.autoTopUp.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      thresholdPaise: 20000, // ₹200
      amountPaise: 100000,   // ₹1,000
      active: false,
      paymentMethodRef: null,
    },
  });

  await db.invoice.create({
    data: {
      workspaceId: workspace.id,
      razorpayPaymentId: "pay_DemoSeed0001",
      razorpayOrderId: "order_DemoSeed0001",
      amountPaise: 100000,
      gstPaise: 18000,
      gstin: "29ABCDE1234F1Z5",
      placeOfSupply: "Karnataka (29)",
      hsnSac: "998314",
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
      status: "paid",
    },
  });

  // --- Reseller: demo workspace parents a child client workspace ---
  await db.resellerAccount.upsert({
    where: { parentWorkspaceId: workspace.id },
    update: {},
    create: {
      parentWorkspaceId: workspace.id,
      wholesaleRateCard: { telephony_per_min_paise: 45, stt_per_min_paise: 30, llm_per_1k_tokens_paise: 2, tts_per_min_paise: 40 },
      active: true,
    },
  });
  const resellerAccount = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId: workspace.id },
  });
  const childWorkspace = await db.workspace.upsert({
    where: { slug: "demo-agency-client" },
    update: {},
    create: {
      name: "Demo Agency Client — Smile Dental",
      slug: "demo-agency-client",
      industry: "healthcare",
      resellerId: resellerAccount?.id,
    },
  });
  await db.wallet.upsert({
    where: { workspaceId: childWorkspace.id },
    update: {},
    create: { workspaceId: childWorkspace.id, balancePaise: 0 },
  });

  // --- Trial, KYC, compliance, onboarding ---
  await db.trialState.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      trialMinutesUsed: 3,
      trialMinutesLimit: 30,
      kycStatus: "VERIFIED",
      sandboxNumberId: phone1.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  await db.kycRecord.create({
    data: {
      workspaceId: workspace.id,
      documentType: "GST",
      documentRef: "29ABCDE1234F1Z5",
      status: "VERIFIED",
      reviewedAt: new Date(),
    },
  });

  await db.retentionPolicy.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      recordingsDays: 90,
      transcriptsDays: 365,
      autoDelete: true,
    },
  });

  await db.gdprRequest.create({
    data: {
      workspaceId: workspace.id,
      type: "EXPORT",
      subjectPhone: "+919812345678",
      status: "PENDING",
    },
  });

  await db.onboardingState.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      currentStep: 3,
      checklist: { industry: true, template: true, knowledge: true, test_call: false, number: false },
      sampleDataEnabled: true,
    },
  });

  // --- Audit log sample ---
  await db.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "workspace.seeded",
      entity: "Workspace",
      entityId: workspace.id,
      metadata: { seed: true },
    },
  });

  console.log("Seed complete:");
  console.log("  login:     demo@vaani.ai / demo1234");
  console.log("  workspace: Demo Dental Clinic (demo-clinic)");
  console.log("  plans:     starter, growth, enterprise (with feature gates)");
  console.log("  demo rows: agent+version, knowledge doc, tool configs, pool+2 numbers,");
  console.log("             contacts+DNC, campaign, 2 calls (1 completed+QA, 1 live+transfer),");
  console.log("             voicemail, callback, WhatsApp, calendar/CRM, webhook+delivery,");
  console.log("             report+digest, payment order, invoice, reseller+child, trial/KYC,");
  console.log("             retention, GDPR, onboarding");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

Add this to `package.json` at top level (merge, do not replace other keys):
```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

**Do:**
```bash
cd /root/vaani-ai && npm run prisma:seed
```
**Expected:** prints `Seed complete:` plus the info lines ending with
`retention, GDPR, onboarding`, exit code 0.
**If it fails:** `Unique constraint` errors mean it ran twice — safe to re-run only
after a reset: `npx prisma migrate reset --force` (wipes dev data, fine in dev) then
`npm run prisma:seed` again.

---

## Step 6: Schema smoke test — CRUD round-trip on the new models

This script creates a throwaway workspace, writes and reads back one row in every
major new model, then deletes everything (verifying cascade rules). It is the fast
proof that the schema matches the Prisma client.

**File `scripts/schema-smoke.ts`** (full content):

```ts
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const db = new PrismaClient();
let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  // clean previous runs
  await db.workspace.deleteMany({ where: { slug: { in: ["smoke-test-ws", "smoke-child-ws"] } } });
  await db.user.deleteMany({ where: { email: "smoke@vaani.dev" } });
  await db.plan.deleteMany({ where: { code: "smoke-plan" } });

  const ws = await db.workspace.create({
    data: {
      name: "Smoke WS",
      slug: "smoke-test-ws",
      logoUrl: "https://example.com/logo.png",
      primaryColor: "#112233",
      customDomain: "smoke.example.com",
      whiteLabelEnabled: true,
      recordingDisclosureText: "This call is recorded.",
    },
  });
  assert(ws.customDomain === "smoke.example.com" && ws.whiteLabelEnabled, "white-label fields");
  ok("workspace + white-label fields");

  const user = await db.user.create({
    data: { email: "smoke@vaani.dev", passwordHash: "smoke", fullName: "Smoke User" },
  });
  const m = await db.membership.create({
    data: {
      userId: user.id,
      workspaceId: ws.id,
      role: "MANAGER",
      grantedPermissions: ["campaigns:write"],
      revokedPermissions: ["billing:read"],
    },
  });
  assert(m.grantedPermissions.includes("campaigns:write") && m.revokedPermissions.includes("billing:read"), "permissions arrays");
  ok("membership granular permissions");

  const totp = await db.totpSecret.create({ data: { userId: user.id, secret: "SMOKEBASE32", status: "PENDING" } });
  assert(totp.status === "PENDING", "totp status");
  ok("totpSecret enroll state");

  const sso = await db.ssoIdentity.create({
    data: { userId: user.id, workspaceId: ws.id, provider: "SAML", externalSubjectId: "saml-sub-1", email: "smoke@vaani.dev" },
  });
  assert(sso.provider === "SAML", "sso provider");
  ok("ssoIdentity (SAML)");

  const apiKey = await db.apiKey.create({
    data: {
      workspaceId: ws.id,
      name: "smoke key",
      keyPrefix: "vaani_sm",
      keyHash: createHash("sha256").update("smoke-api-key").digest("hex"),
      scopes: ["calls:read"],
      ipAllowlist: ["10.0.0.0/8"],
      createdByUserId: user.id,
    },
  });
  assert(apiKey.ipAllowlist.length === 1, "api key ip allowlist");
  ok("apiKey scopes + ipAllowlist");

  const invite = await db.workspaceInvite.create({
    data: {
      workspaceId: ws.id,
      email: "invitee@vaani.dev",
      role: "VIEWER",
      token: "smoke-invite-token",
      invitedByUserId: user.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  assert(invite.status === "PENDING", "invite status");
  ok("workspaceInvite");

  const session = await db.session.create({
    data: {
      token: "smoke-session-token",
      userId: user.id,
      activeWorkspaceId: ws.id,
      deviceName: "Chrome / Linux",
      ipAddress: "203.0.113.10",
      userAgent: "smoke-test",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  const sessionAfter = await db.session.findUnique({ where: { id: session.id } });
  assert(sessionAfter?.revokedAt !== null, "session revoke");
  ok("session device info + forced logout");

  const agent = await db.agent.create({
    data: { workspaceId: ws.id, name: "Smoke Agent", systemPrompt: "sp", greeting: "hi", recordingDisclosureText: "rec" },
  });
  const v1 = await db.agentVersion.create({
    data: { agentId: agent.id, workspaceId: ws.id, version: 1, status: "PUBLISHED", systemPrompt: "sp", greeting: "hi", dograhWorkflowId: "dg-wf-1", publishedAt: new Date() },
  });
  const v2 = await db.agentVersion.create({
    data: { agentId: agent.id, workspaceId: ws.id, version: 2, status: "DRAFT", systemPrompt: "sp2", greeting: "hi2", isAbVariant: true, abTrafficPercent: 20 },
  });
  assert(v1.dograhWorkflowId === "dg-wf-1" && v2.isAbVariant && v2.abTrafficPercent === 20, "agent versions");
  ok("agentVersion draft/published + A/B fields");

  const kd = await db.knowledgeDocument.create({
    data: { workspaceId: ws.id, agentId: agent.id, type: "URL", title: "site", sourceUrl: "https://example.com", status: "INDEXED", reindexIntervalHours: 24, nextReindexAt: new Date(Date.now() + 86400000) },
  });
  assert(kd.status === "INDEXED", "knowledge doc status");
  ok("knowledgeDocument (URL, re-index schedule)");

  const tc = await db.agentToolConfig.upsert({
    where: { agentId_tool: { agentId: agent.id, tool: "CUSTOM_WEBHOOK" } },
    update: { enabled: false },
    create: { agentId: agent.id, tool: "CUSTOM_WEBHOOK", config: { url: "https://example.com/hook", method: "POST" } },
  });
  assert(tc.tool === "CUSTOM_WEBHOOK", "tool config");
  ok("agentToolConfig upsert");

  const tpl = await db.marketplaceTemplate.create({
    data: { authorWorkspaceId: ws.id, name: "Smoke Template", industry: "testing", description: "d", systemPrompt: "sp", greeting: "hi", published: true },
  });
  await db.marketplaceTemplate.update({ where: { id: tpl.id }, data: { installs: { increment: 1 } } });
  ok("marketplaceTemplate + installs counter");

  const pool = await db.numberPool.create({ data: { workspaceId: ws.id, name: "smoke pool" } });
  const phone = await db.phoneNumber.create({
    data: { workspaceId: ws.id, number: "+911600009999", numberType: "SERIES_1600", agentId: agent.id, poolId: pool.id, monthlyRentPaise: 40000, dailyCallCap: 100, lifetimeCallCap: 5000 },
  });
  assert(phone.numberType === "SERIES_1600" && phone.dailyCallCap === 100, "phone number fields");
  ok("numberPool + phoneNumber (type, caps, rent)");

  const rental = await db.numberRental.create({
    data: { workspaceId: ws.id, phoneNumberId: phone.id, monthlyPricePaise: 40000, marginPercent: 25 },
  });
  assert(rental.status === "ACTIVE", "rental status");
  ok("numberRental (price + margin)");

  const list = await db.contactList.create({ data: { workspaceId: ws.id, name: "smoke list" } });
  const contact = await db.contact.create({
    data: { workspaceId: ws.id, listId: list.id, phone: "+919999999999", name: "Smoke Contact", timezone: "Asia/Kolkata", consentAt: new Date(), consentSource: "web-form", crmExternalId: "crm-1" },
  });
  const dnc = await db.dncEntry.create({ data: { workspaceId: ws.id, phone: "+919999999998", source: "REGISTRY", reason: "TRAI DND scrub" } });
  assert(contact.consentSource === "web-form" && dnc.source === "REGISTRY", "contact consent + dnc");
  ok("contact consent fields + dncEntry");

  const campaign = await db.campaign.create({
    data: {
      workspaceId: ws.id,
      name: "smoke campaign",
      type: "PAYMENT_REMINDER",
      agentId: agent.id,
      listId: list.id,
      concurrency: 3,
      retryPolicy: { busy: { attempts: 3, delayMin: 30 } },
      timezoneWindows: { timezone: "Asia/Kolkata", days: [1, 2, 3], windows: [["09:00", "13:00"]] },
      openingHook: "hook",
      objectionPlaybook: "playbook",
      amdPolicy: "LEAVE_MESSAGE",
      predictiveDialing: true,
      poolId: pool.id,
    },
  });
  assert(campaign.type === "PAYMENT_REMINDER" && campaign.amdPolicy === "LEAVE_MESSAGE" && campaign.predictiveDialing, "campaign fields");
  ok("campaign (type, retryPolicy, timezoneWindows, AMD, predictive)");

  const cc = await db.campaignContact.create({ data: { campaignId: campaign.id, contactId: contact.id } });
  const cb = await db.callbackTask.create({
    data: { workspaceId: ws.id, contactId: contact.id, campaignId: campaign.id, phone: contact.phone, note: "call me tomorrow at 5", dueAt: new Date(Date.now() + 86400000), assignedToUserId: user.id },
  });
  assert(cc.status === "PENDING" && cb.status === "PENDING", "campaign contact + callback");
  ok("campaignContact + callbackTask");

  const call = await db.call.create({
    data: {
      workspaceId: ws.id,
      direction: "OUTBOUND",
      status: "COMPLETED",
      fromNumber: phone.number,
      toNumber: contact.phone,
      agentId: agent.id,
      campaignId: campaign.id,
      amdResult: "HUMAN",
      interestScore: "WARM",
      interestReason: "asked for callback",
      extractedEntities: { amount_due: 1200 },
      hallucinationFlag: false,
      deadAirSeconds: 1,
      scriptAdherenceScore: 88,
      piiRedacted: true,
      transcript: "smoke transcript",
      costTelephonyPaise: 10,
      costSttPaise: 5,
      costLlmPaise: 4,
      costTtsPaise: 6,
      billedPaise: 35,
    },
  });
  await db.transcriptEntry.createMany({
    data: [
      { callId: call.id, speaker: "AGENT", text: "hello", timestampMs: 0 },
      { callId: call.id, speaker: "CALLER", text: "hi", timestampMs: 900 },
    ],
  });
  const entries = await db.transcriptEntry.count({ where: { callId: call.id } });
  assert(call.interestScore === "WARM" && entries === 2, "call intelligence + transcript entries");
  ok("call (AMD, interest, entities, hallucination, dead-air, PII) + transcriptEntry");

  const qa = await db.qaScore.create({
    data: { workspaceId: ws.id, callId: call.id, rubricName: "smoke-rubric", scores: { greeting: 9, closing: 8 }, totalScore: 17, maxScore: 20, scorerModel: "meta-llama/llama-3.1-70b-instruct" },
  });
  assert(qa.totalScore === 17, "qa score");
  ok("qaScore");

  const live = await db.liveCallState.create({
    data: { workspaceId: ws.id, callId: call.id, mode: "WHISPER", liveTranscript: "tail...", supervisorUserId: user.id, whisperContext: "offer 10% discount" },
  });
  assert(live.mode === "WHISPER", "live call state");
  ok("liveCallState (whisper mode)");

  const tr = await db.transferRequest.create({
    data: { workspaceId: ws.id, callId: call.id, queue: "support", skill: "hindi", reason: "explicit request", contextSnapshot: { summary: "s" }, acceptedByUserId: user.id, status: "ACCEPTED", acceptedAt: new Date() },
  });
  assert(tr.status === "ACCEPTED", "transfer request");
  ok("transferRequest (queue/skill/context)");

  const vm = await db.voicemailMessage.create({
    data: { workspaceId: ws.id, callId: call.id, phoneNumberId: phone.id, fromNumber: contact.phone, transcript: "vm text" },
  });
  assert(vm.status === "NEW", "voicemail");
  ok("voicemailMessage");

  const waT = await db.whatsAppTemplate.create({
    data: { workspaceId: ws.id, name: "smoke_tpl", body: "Hi {{1}}", dltTemplateId: "DLT-SMOKE", status: "APPROVED" },
  });
  const waC = await db.whatsAppCampaign.create({ data: { workspaceId: ws.id, name: "smoke wa", templateId: waT.id, listId: list.id } });
  assert(waT.status === "APPROVED" && waC.status === "DRAFT", "whatsapp");
  ok("whatsAppTemplate + whatsAppCampaign");

  const cal = await db.calendarConnection.create({
    data: { workspaceId: ws.id, provider: "CALCOM", accessToken: "tok", primaryCalendarId: "cal-1" },
  });
  assert(cal.provider === "CALCOM", "calendar");
  ok("calendarConnection");

  const crm = await db.crmConnection.create({
    data: { workspaceId: ws.id, provider: "ZOHO", accessToken: "tok", fieldMapping: { "contact.name": "Last_Name" }, twoWaySyncEnabled: true },
  });
  assert(crm.twoWaySyncEnabled, "crm");
  ok("crmConnection (two-way sync, field mapping)");

  const sub = await db.webhookSubscription.create({
    data: { workspaceId: ws.id, url: "https://example.com/hook", events: ["call.completed"], secret: "whsec_smoke" },
  });
  const del = await db.webhookDelivery.create({
    data: { subscriptionId: sub.id, event: "call.completed", payload: { callId: call.id }, attempts: 2, responseCode: 500, nextRetryAt: new Date(Date.now() + 60000) },
  });
  assert(del.status === "PENDING" && del.attempts === 2, "webhook delivery retry state");
  ok("webhookSubscription + webhookDelivery (retry state)");

  const rep = await db.savedReport.create({ data: { workspaceId: ws.id, name: "smoke report", reportType: "calls", config: { groupBy: "day" } } });
  const dig = await db.scheduledDigest.create({
    data: { workspaceId: ws.id, reportId: rep.id, frequency: "DAILY", recipients: ["a@b.c"], lastSentAt: new Date() },
  });
  assert(dig.frequency === "DAILY" && dig.recipients.length === 1, "digest");
  ok("savedReport + scheduledDigest");

  const plan = await db.plan.create({
    data: { code: "smoke-plan", name: "Smoke", monthlyPricePaise: 100, includedMinutes: 1, maxAgents: 1, maxSeats: 1, concurrentLines: 5, whiteLabel: true, premiumVoices: true, dedicatedInfra: false, featureGates: { api_access: true } },
  });
  const subscription = await db.subscription.create({
    data: { workspaceId: ws.id, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 86400000) },
  });
  assert(plan.concurrentLines === 5 && subscription.status === "active", "plan gates + subscription");
  ok("plan feature gates + subscription");

  const wallet = await db.wallet.create({ data: { workspaceId: ws.id, balancePaise: 5000 } });
  const txn = await db.walletTransaction.create({
    data: { walletId: wallet.id, type: "CALL_DEBIT", amountPaise: -35, balanceAfterPaise: 4965, reference: call.id },
  });
  assert(txn.balanceAfterPaise === 4965, "wallet txn");
  ok("wallet + walletTransaction");

  const po = await db.paymentOrder.create({
    data: { workspaceId: ws.id, provider: "STRIPE", providerOrderId: "pi_smoke_1", providerSessionId: "cs_smoke_1", amountPaise: 5000, status: "paid" },
  });
  const inv = await db.invoice.create({
    data: { workspaceId: ws.id, amountPaise: 5000, gstPaise: 900, gstin: "29SMOKE1234F1Z5", placeOfSupply: "Karnataka (29)", hsnSac: "998314", cgstPaise: 450, sgstPaise: 450, igstPaise: 0, pdfKey: "invoices/smoke.pdf", status: "paid" },
  });
  const atu = await db.autoTopUp.create({ data: { workspaceId: ws.id, thresholdPaise: 1000, amountPaise: 5000 } });
  assert(po.provider === "STRIPE" && inv.cgstPaise + inv.sgstPaise === inv.gstPaise && atu.active, "payment/invoice/autotopup");
  ok("paymentOrder (Stripe) + invoice GST fields + autoTopUp");

  const reseller = await db.resellerAccount.create({
    data: { parentWorkspaceId: ws.id, wholesaleRateCard: { telephony_per_min_paise: 45 } },
  });
  const child = await db.workspace.create({
    data: { name: "Smoke Child", slug: "smoke-child-ws", resellerId: reseller.id },
  });
  const children = await db.workspace.count({ where: { resellerId: reseller.id } });
  assert(children === 1 && child.resellerId === reseller.id, "reseller children");
  ok("resellerAccount + child workspace");

  const trial = await db.trialState.create({ data: { workspaceId: ws.id, trialMinutesUsed: 5, kycStatus: "PENDING", sandboxNumberId: phone.id } });
  const kyc = await db.kycRecord.create({ data: { workspaceId: ws.id, documentType: "PAN", documentRef: "SMOKE1234A" } });
  assert(trial.kycStatus === "PENDING" && kyc.status === "PENDING", "trial + kyc");
  ok("trialState + kycRecord");

  const rp = await db.retentionPolicy.create({ data: { workspaceId: ws.id, recordingsDays: 30, transcriptsDays: 90 } });
  const gdpr = await db.gdprRequest.create({ data: { workspaceId: ws.id, type: "ERASURE", subjectPhone: contact.phone } });
  const ob = await db.onboardingState.create({ data: { workspaceId: ws.id, currentStep: 2, checklist: { industry: true }, sampleDataEnabled: true } });
  assert(rp.autoDelete && gdpr.type === "ERASURE" && ob.sampleDataEnabled, "compliance + onboarding");
  ok("retentionPolicy + gdprRequest + onboardingState");

  // cascade cleanup: deleting the parent workspace must remove all tenant rows
  await db.workspace.delete({ where: { id: child.id } });
  await db.workspace.delete({ where: { id: ws.id } });
  const leftoverCalls = await db.call.count({ where: { workspaceId: ws.id } });
  const leftoverKeys = await db.apiKey.count({ where: { workspaceId: ws.id } });
  assert(leftoverCalls === 0 && leftoverKeys === 0, "cascade delete");
  await db.user.delete({ where: { id: user.id } });
  await db.plan.delete({ where: { id: plan.id } });
  ok("cascade delete removes all tenant rows");

  console.log(`SMOKE OK: ${checks} checks passed, cleanup done`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

**Do:**
```bash
cd /root/vaani-ai && npx tsx scripts/schema-smoke.ts
```
**Expected (exactly 33 `ok` lines, then the summary):**
```
ok 1 - workspace + white-label fields
ok 2 - membership granular permissions
ok 3 - totpSecret enroll state
ok 4 - ssoIdentity (SAML)
ok 5 - apiKey scopes + ipAllowlist
ok 6 - workspaceInvite
ok 7 - session device info + forced logout
ok 8 - agentVersion draft/published + A/B fields
ok 9 - knowledgeDocument (URL, re-index schedule)
ok 10 - agentToolConfig upsert
ok 11 - marketplaceTemplate + installs counter
ok 12 - numberPool + phoneNumber (type, caps, rent)
ok 13 - numberRental (price + margin)
ok 14 - contact consent fields + dncEntry
ok 15 - campaign (type, retryPolicy, timezoneWindows, AMD, predictive)
ok 16 - campaignContact + callbackTask
ok 17 - call (AMD, interest, entities, hallucination, dead-air, PII) + transcriptEntry
ok 18 - qaScore
ok 19 - liveCallState (whisper mode)
ok 20 - transferRequest (queue/skill/context)
ok 21 - voicemailMessage
ok 22 - whatsAppTemplate + whatsAppCampaign
ok 23 - calendarConnection
ok 24 - crmConnection (two-way sync, field mapping)
ok 25 - webhookSubscription + webhookDelivery (retry state)
ok 26 - savedReport + scheduledDigest
ok 27 - plan feature gates + subscription
ok 28 - wallet + walletTransaction
ok 29 - paymentOrder (Stripe) + invoice GST fields + autoTopUp
ok 30 - resellerAccount + child workspace
ok 31 - trialState + kycRecord
ok 32 - retentionPolicy + gdprRequest + onboardingState
ok 33 - cascade delete removes all tenant rows
SMOKE OK: 33 checks passed, cleanup done
```
**If it fails:**
- An `ASSERT FAILED` names the broken model — compare that model in
  `prisma/schema.prisma` against Step 1, fix, run
  `npx prisma migrate dev --name fix-smoke`, re-run the smoke script.
- `Unique constraint failed` on `smoke-test-ws` → a previous run crashed mid-way;
  re-run the script once (it cleans up at the start). If it still fails, run
  `npx prisma migrate reset --force && npm run prisma:seed` and re-run.

---

## Step 7: Verify the seeded data is real (psql)

**Do:**
```bash
cd /root/vaani-ai
docker exec vaani-db psql -U vaani -d vaani -c '\dt' | wc -l
docker exec vaani-db psql -U vaani -d vaani -c 'SELECT code, "monthlyPricePaise", "concurrentLines", "whiteLabel" FROM "Plan" ORDER BY 1;'
docker exec vaani-db psql -U vaani -d vaani -c 'SELECT email FROM "User";'
docker exec vaani-db psql -U vaani -d vaani -c 'SELECT count(*) FROM "Contact";'
docker exec vaani-db psql -U vaani -d vaani -c 'SELECT (SELECT count(*) FROM "QaScore") AS qa, (SELECT count(*) FROM "WebhookSubscription") AS hooks, (SELECT count(*) FROM "TransferRequest") AS transfers, (SELECT count(*) FROM "ResellerAccount") AS resellers, (SELECT count(*) FROM "AgentVersion") AS versions, (SELECT count(*) FROM "CallbackTask") AS callbacks, (SELECT count(*) FROM "WhatsAppTemplate") AS wa_tpl, (SELECT count(*) FROM "LiveCallState") AS live;'
```

**Expected:**
- `\dt | wc -l` prints `52` or more (49 app tables + `_prisma_migrations` + header/
  footer lines from psql).
- Plans: three rows — `enterprise 2499900 100 t`, `growth 799900 10 f`,
  `starter 299900 2 f`.
- Users: `demo@vaani.ai`.
- Contacts count: `3`.
- The combined counts row: `1 | 1 | 1 | 1 | 1 | 1 | 1 | 1`.

**If it fails:** report which query returned wrong output and the migration log from
`ls prisma/migrations/`.

---

## Step 8: Git checkpoint

**Do:**
```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 02: full v1 prisma schema (49 models), migrations, seed, unit + smoke tests"
```

**Expected:** commit created; `git log --oneline -1` shows the message.
**If it fails:** `nothing to commit` means the files were already committed — verify
with `git status` and report it.

---

## Acceptance Checklist

- [ ] `npx prisma validate` passes (49 models, one `init` migration)
- [ ] **Auth & tenancy:** smoke checks 2–7 pass (permissions, TOTP, SSO, ApiKey, invite, session revoke)
- [ ] **White-label:** smoke check 1 passes + psql shows `customDomain` on Workspace
- [ ] **Agent builder:** smoke checks 8–11 pass (versions, knowledge, tools, marketplace)
- [ ] **Integrations:** smoke checks 23–25 pass (calendar, CRM, webhook + retry state)
- [ ] **Inbound/HITL:** smoke checks 12–14, 17, 19–21 pass (numbers/caps, DNC, call intelligence, live state, transfer, voicemail)
- [ ] **Outbound:** smoke checks 15–16, 22 pass (campaign config, callback, WhatsApp)
- [ ] **Analytics/QA:** smoke checks 17–18, 26 pass (cost breakdown fields, QaScore, reports/digests)
- [ ] **Billing:** smoke checks 27–30 pass (plan gates, wallet, GST invoice, Stripe order, reseller)
- [ ] **Compliance:** smoke check 32 passes (retention, GDPR, PII flag in check 17)
- [ ] **Onboarding:** smoke checks 31–32 pass (trial/KYC, onboarding state)
- [ ] Unit tests: `npx vitest run tests/money.test.ts` → 6 describe blocks pass
- [ ] Seed exits 0 and prints all demo info lines
- [ ] psql shows ≥49 app tables, 3 plans, 1 user, 3 contacts, and the combined counts row of eight `1`s
- [ ] `npm run typecheck` exits 0
- [ ] Git commit `phase 02: ...` exists

## FINAL REPORT format

```
STEP 1..8: PASS/FAIL — <one line of evidence each>
ACCEPTANCE: n/16 checked
NOTES: <deviations, e.g. migrate reset used>
```
