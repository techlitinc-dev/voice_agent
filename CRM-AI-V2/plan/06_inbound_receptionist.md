# 06 — Inbound Receptionist & Live Operations (Human-in-the-Loop)

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/06_inbound_receptionist.md` exactly. Create files with the EXACT
> contents shown. Run every Verify, compare with Expected, max 2 fix attempts, then
> STOP and report. Tenant rule: every query through `requireWorkspace()`; every
> server action starts with `requirePermission(...)` (guide 03 keys only). Some
> features are marked **OPERATOR GATE** — build the code exactly,
> run the non-gated verifies, and mark the gate `GATED` in your report. Never change
> pinned versions. End with the FINAL REPORT.
> ---

---

## Goal

Full **AI receptionist** (spec §5) and **live operations / human-in-the-loop**
(spec §7):

- Numbers page: register DIDs (local / toll-free 1800 / mobile / TRAI series), assign
  a published agent, per-number type metadata.
- DID → workflow binding in Dograh (the mechanism that makes real calls reach the AI).
- **Smart greeting by context**: business hours per workspace, holiday calendar,
  returning-caller detection ("Welcome back, Ramesh").
- **Spam & robocall filtering**: manual blocklist (DncEntry), spam-prefix list,
  rapid-repeat caller detection.
- **After-call automation**: outcome + sentiment + extracted entities, DNC honored,
  lead capture → Contact upsert → CRM push (dry-run safe), `call.completed` webhook
  event enqueue for subscribers.
- **Message taking + voicemail-to-text**: VoicemailMessage row, Sarvam transcription,
  staff notification by email (nodemailer) and WhatsApp (dry-run gated).
- **Missed-call auto-callback**: CallbackTask + `callback-dial` job on the shared
  dialer queue (consumed by guide 07's worker).
- **Fallback policies**: auto-transfer on explicit human request / repeated
  misunderstanding / low confidence / VIP caller — configured via the agent's
  HUMAN_TRANSFER tool config JSON.
- **Live call dashboard** (`/live`): 5-second polling, real-time transcript viewer.
- **Listen / Whisper / Barge / Takeover**: supervisor controls backed by LiveCallState.
- **Human transfer queues** (`/transfers`): skills-based routing, context snapshot
  before accept, availability toggle.
- **Web dialer** (`/dialer`): click-to-call from workspace numbers via a `manual-dial`
  queue job (guide 07 consumes).

**Time estimate:** 4–6 hours. **Prerequisites:** guides 01–05 green (agent builder
done, at least one PUBLISHED agent, Dograh client + webhook receiver working).

**How routing works (confirmed against Dograh's OpenAPI spec):** Dograh binds a DID
directly to a workflow — each phone number in a telephony config has an
`inbound_workflow_id` field, set via
`PUT /api/v1/organizations/telephony-configs/{config_id}/phone-numbers/{phone_number_id}`
with body `{"inbound_workflow_id": <numeric workflow id>}` (or set in the Dograh UI).
Vobiz delivers inbound calls to Dograh's inbound handler, Dograh runs the bound
workflow. Our `PhoneNumber` table is the tenant-facing mirror of that binding. The
resolver endpoint (Step 6) doubles as Dograh's **Pre-Call Data Fetch** source
(greeting/context variables) and as an internal debug/fallback tool.

---

## Feature coverage map (spec → step)

| readme.md §5/§7 bullet | Step(s) |
|---|---|
| 24/7 answering on dedicated numbers (local/toll-free/mobile) | 1, 7, 8 |
| Smart greeting by context (business hours, returning caller, holidays) | 2, 3, 6 |
| Natural-language call routing (IVR replacement) | 6 (intent branch table) |
| Appointment booking/rescheduling/cancellation | 12 (tool node owned by guide 05; receptionist-side config + simulation here) |
| FAQ answering from knowledge base | guide 05 owns KB; consumed via workflow prompt (Step 1 note) |
| Lead capture → CRM | 13, 15 |
| Call forwarding to departments/humans | 5, 16, 19 |
| Message taking + staff notification | 11, 14, 15 |
| Spam & robocall filtering | 2, 4, 6 |
| Voicemail-to-text + routing | 14, 15 |
| Missed-call auto-callback | 9, 15 |
| Simultaneous calls (unlimited concurrency) | inherent to Dograh/Vobiz — note in Step 1 |
| After-call automation → CRM/webhook | 10, 13, 15 |
| Live call dashboard + real-time transcript | 17, 18 |
| Listen / Whisper / Barge / Takeover | 17, 18 |
| Human transfer queues (skills, context handoff) | 16, 19 |
| Web dialer for humans | 9, 20 |
| Fallback policies | 5, 15, 16 |

---

## Contracts this guide defines (other guides depend on these — do not rename)

1. **Queue job contracts (guide 07's worker MUST consume these on the
   `campaign-dialer` BullMQ queue):**
   - Job name `callback-dial`, data:
     `{ workspaceId: string, callbackTaskId: string, phone: string, note?: string, requestedBy: "system", enqueuedAt: string }`
     → worker dials `phone` with the workspace's inbound agent (or the campaign's
     agent if `campaignId` set on the CallbackTask), then marks the CallbackTask DONE.
   - Job name `manual-dial`, data:
     `{ workspaceId: string, userId: string, callId: string, fromNumber: string, toNumber: string, enqueuedAt: string }`
     → worker triggers an outbound call from `fromNumber` to `toNumber` and attaches
     events to the existing Call row `callId`.
2. **`emitWebhookEvent(workspaceId, event, payload)`** in `src/lib/webhooks.ts`
   (Step 10) — creates PENDING `WebhookDelivery` rows. Guide 08's delivery worker
   sends them (HMAC `X-Vaani-Signature` with the subscription's `secret`).
3. **Skills convention:** a human agent's skills are strings `skill:<name>` in
   `Membership.grantedPermissions` (e.g. `skill:sales`, `skill:hindi`). Availability
   is the string `availability:online` in the same array. No schema change.
4. **HUMAN_TRANSFER tool config JSON** (stored on `AgentToolConfig` where
   `tool = HUMAN_TRANSFER`; the editor UI is guide 05's job):
   ```json
   {
     "queue": "support",
     "skill": "hindi",
     "vipNumbers": ["+919812345678"],
     "queueDestinations": { "support": "+919800000001", "sales": "+919800000002" },
     "autoTransfer": { "onExplicitRequest": true, "onRepeatedMisunderstanding": true,
                       "onLowConfidence": false, "onVip": true },
     "maxMisunderstandings": 3
   }
   ```
   All fields optional; defaults in `src/lib/fallbackPolicy.ts`. **VIP callers are
   phone numbers in `vipNumbers`** (not a Contact flag — documented convention).
5. **WhatsApp contract (guide 04 owns the client — `src/lib/vobiz.ts`):**
   `sendWhatsAppTemplate({ to, templateName, languageCode?, components? })` where
   `components?: Array<Record<string, unknown>>` (WhatsApp Cloud-API component
   shape; body params are mapped like guide 05's `waComponents()`). It returns
   `WhatsAppSendResult` and **throws** `VobizError` on failure. We never
   re-implement it; `src/lib/notify.ts` (Step 11) wraps it in the
   `WHATSAPP_DRY_RUN` gate.

---

## Step 0: Install dependencies + document env vars

```bash
cd /root/vaani-ai
npm install nodemailer@6.9.16
npm install --save-dev @types/nodemailer@6.4.17
```

**Verify:**
```bash
npm ls nodemailer @types/nodemailer 2>&1 | tail -n 3
```
**Expected:** `nodemailer@6.9.16` and `@types/nodemailer@6.4.17` (no `UNMET`).

**Env vars.** `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` are already
in `.env` and `.env.example` from guide 01 — do NOT re-add them. Append ONLY the
vars this guide owns, using the grep-guarded form so re-runs stay idempotent:

```bash
cd /root/vaani-ai
for KV in \
  'STAFF_NOTIFICATION_EMAILS=' \
  'STAFF_NOTIFICATION_WHATSAPP=' \
  'WHATSAPP_DRY_RUN=true' \
  'CRM_PUSH_DRY_RUN=true' \
  'EXTRA_HOLIDAYS=' ; do
  KEY="${KV%%=*}"
  grep -q "^${KEY}=" .env || echo "${KV}  # guide 06" >> .env
  grep -q "^${KEY}=" .env.example || echo "${KV}  # guide 06" >> .env.example
done
```
(Var meanings: `STAFF_NOTIFICATION_EMAILS` = comma-separated staff emails for
message/voicemail alerts; `STAFF_NOTIFICATION_WHATSAPP` = comma-separated E.164
staff numbers; `WHATSAPP_DRY_RUN=true` → log instead of sending via guide 04's
Vobiz client; `CRM_PUSH_DRY_RUN=true` → log instead of pushing leads to the CRM;
`EXTRA_HOLIDAYS` = optional comma-separated YYYY-MM-DD merged into the holiday
calendar.)

**Verify:**
```bash
grep -c "WHATSAPP_DRY_RUN\|CRM_PUSH_DRY_RUN\|STAFF_NOTIFICATION_EMAILS\|STAFF_NOTIFICATION_WHATSAPP\|EXTRA_HOLIDAYS" .env .env.example
```
**Expected:** `.env:5` and `.env.example:5`. Re-run the append loop once and re-grep
— count must stay 5 (idempotent).

**Vitest path alias (one-time, additive):** this guide's modules import `@/…`;
vitest does not read `tsconfig` paths by itself, so add a config (skip if
`vitest.config.ts` already exists — check first: `test -f vitest.config.ts && echo EXISTS`).

**File `vitest.config.ts`** (full content — create only if missing):

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/money.test.ts 2>&1 | tail -n 3
```
**Expected:** the guide-02 money suite still passes (`Test Files  1 passed`).

---

## Step 1: Bind the DID to the workflow in Dograh (operator, 5 minutes per number)

The mechanism is confirmed (Dograh OpenAPI): a phone number's `inbound_workflow_id`
decides which workflow answers it. "Unlimited simultaneous calls" (spec §5) is
inherent — Dograh starts one workflow run per inbound call; nothing to build, just
do not bind two tenants' agents to the same DID.

**Path A — Dograh UI (recommended):** operator opens the Dograh UI → telephony config
→ phone numbers → edit the DID → set the inbound workflow to the workflow our app
published (guide 05 prints the Dograh workflow id on the agent page).

**Path B — API (Hermes, when ids are known):**
```bash
source /root/vaani-ai/.env
curl -s -X PUT \
  "$DOGRAH_BASE_URL/api/v1/organizations/telephony-configs/<CONFIG_ID>/phone-numbers/<PHONE_NUMBER_ID>" \
  -H "X-API-Key: $DOGRAH_API_KEY" -H "Content-Type: application/json" \
  -d '{"inbound_workflow_id": <NUMERIC_WORKFLOW_ID>}'
```
**Expected:** 200 JSON of the updated phone number. To find CONFIG_ID / PHONE_NUMBER_ID:
`curl -s -H "X-API-Key: $DOGRAH_API_KEY" "$DOGRAH_BASE_URL/api/v1/organizations/telephony-configs"`.

Record the binding in your report. This binding is what makes a real inbound call reach
the AI; Steps 2–20 build the tenant-facing mirror + all pre/post-call processing.

**FAQ answering (spec §5):** handled inside the Dograh workflow — guide 05 attaches
knowledge documents to the agent; the workflow's agentNode answers from them. Nothing
extra to build here.

---

## Step 2: Static configuration files (business hours, holidays, spam prefixes)

No schema changes — per-workspace business hours live in a typed config file keyed by
workspace slug. (A settings UI may come later; the resolver reads ONLY this file, so
there is one source of truth.)

**File `src/config/businessHours.ts`** (full content):

```ts
/**
 * Per-workspace business hours, keyed by workspace slug.
 * "default" applies to every workspace without an explicit entry.
 * days: 0 = Sunday ... 6 = Saturday. open/close: "HH:mm" 24h, in `timezone`.
 */
export type BusinessHoursEntry = {
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  days: number[];
  open: string; // "HH:mm"
  close: string; // "HH:mm"
  afterHoursMessage?: string; // overrides the default after-hours greeting
  holidayMessage?: string; // overrides the default holiday greeting
};

export const BUSINESS_HOURS: Record<string, BusinessHoursEntry> = {
  default: {
    timezone: "Asia/Kolkata",
    days: [1, 2, 3, 4, 5, 6],
    open: "09:00",
    close: "19:00",
  },
  "demo-clinic": {
    timezone: "Asia/Kolkata",
    days: [1, 2, 3, 4, 5, 6],
    open: "10:00",
    close: "20:00",
    afterHoursMessage:
      "Thank you for calling Demo Dental Clinic. We are closed right now; our hours are 10 AM to 8 PM, Monday to Saturday. I can still help you book an appointment or take a message.",
    holidayMessage:
      "Thank you for calling Demo Dental Clinic. We are closed today for a public holiday. I can still help you book an appointment or take a message.",
  },
};

export function getBusinessHours(workspaceSlug: string): BusinessHoursEntry {
  return BUSINESS_HOURS[workspaceSlug] ?? BUSINESS_HOURS.default;
}
```

**File `src/config/holidays.ts`** (full content):

```ts
/**
 * Static Indian public-holiday calendar (YYYY-MM-DD), merged with the optional
 * EXTRA_HOLIDAYS env var (comma-separated YYYY-MM-DD). Operator edits this file to
 * add workspace-relevant holidays; env var is the no-redeploy override.
 */
export const HOLIDAYS: string[] = [
  // 2025
  "2025-01-26", // Republic Day
  "2025-03-14", // Holi
  "2025-08-15", // Independence Day
  "2025-10-02", // Gandhi Jayanti
  "2025-10-20", // Diwali (approx — operator confirms per year)
  "2025-12-25", // Christmas
  // 2026
  "2026-01-26",
  "2026-08-15",
  "2026-10-02",
  "2026-12-25",
];

export function getHolidays(): string[] {
  const extra = (process.env.EXTRA_HOLIDAYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  return [...HOLIDAYS, ...extra];
}
```

**File `src/config/spamPrefixes.ts`** (full content):

```ts
/**
 * Known spam/robocall caller-id prefixes (E.164 prefix match). Empty by default —
 * add prefixes as the operator identifies spam sources, e.g. "+91140" for the TRAI
 * promotional series if the business does not expect legitimate 140-series calls.
 */
export const SPAM_PREFIXES: string[] = [];
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.

---

## Step 3: Smart greeting resolver (business hours + holidays + returning caller)

Pure, fully unit-tested module. The resolver route (Step 6) calls it and returns the
greeting + context variables to the voice stack.

**File `src/lib/greeting.ts`** (full content):

```ts
import { getBusinessHours, type BusinessHoursEntry } from "@/config/businessHours";
import { getHolidays } from "@/config/holidays";

export type BusinessStatus = "open" | "after-hours" | "holiday";

/** Local time parts of `now` in an IANA zone, computed with Intl (no date libs). */
export function timePartsInZone(
  now: Date,
  timeZone: string
): { date: string; day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: days[parts.weekday] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isOpenNow(entry: BusinessHoursEntry, now: Date): boolean {
  const t = timePartsInZone(now, entry.timezone);
  return entry.days.includes(t.day) && t.minutes >= toMinutes(entry.open) && t.minutes < toMinutes(entry.close);
}

export function isHolidayToday(now: Date, timeZone: string, holidays: string[]): boolean {
  return holidays.includes(timePartsInZone(now, timeZone).date);
}

export function businessStatus(entry: BusinessHoursEntry, now: Date, holidays: string[]): BusinessStatus {
  if (isHolidayToday(now, entry.timezone, holidays)) return "holiday";
  return isOpenNow(entry, now) ? "open" : "after-hours";
}

export type GreetingResult = {
  greeting: string;
  businessStatus: BusinessStatus;
  isReturning: boolean;
};

/**
 * Compose the greeting the AI should speak:
 *  - holiday → holiday message; after hours → after-hours message; else base greeting.
 *  - returning caller (Contact found with a name) → "Welcome back, <name>!" prepended.
 */
export function resolveGreeting(input: {
  workspaceSlug: string;
  baseGreeting: string;
  callerName?: string | null;
  now?: Date;
  holidays?: string[];
  /** Test seam: pass an explicit entry instead of the config-file lookup. */
  hoursEntry?: BusinessHoursEntry;
}): GreetingResult {
  const now = input.now ?? new Date();
  const entry = input.hoursEntry ?? getBusinessHours(input.workspaceSlug);
  const holidays = input.holidays ?? getHolidays();
  const status = businessStatus(entry, now, holidays);

  let core: string;
  if (status === "holiday") {
    core = entry.holidayMessage ?? `${input.baseGreeting} We are closed today for a public holiday, but I can still help you or take a message.`;
  } else if (status === "after-hours") {
    core = entry.afterHoursMessage ?? `${input.baseGreeting} We are currently outside business hours, but I can still help you or take a message.`;
  } else {
    core = input.baseGreeting;
  }

  const name = input.callerName?.trim();
  const isReturning = !!name;
  return {
    greeting: isReturning ? `Welcome back, ${name}! ${core}` : core,
    businessStatus: status,
    isReturning,
  };
}
```

**File `tests/greeting.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  businessStatus,
  isHolidayToday,
  isOpenNow,
  resolveGreeting,
  timePartsInZone,
} from "../src/lib/greeting";
import type { BusinessHoursEntry } from "../src/config/businessHours";

const ENTRY: BusinessHoursEntry = {
  timezone: "Asia/Kolkata",
  days: [1, 2, 3, 4, 5, 6],
  open: "10:00",
  close: "20:00",
  afterHoursMessage: "We are closed now.",
  holidayMessage: "Holiday today.",
};

// 2025-07-07 is a Monday. 12:00 UTC = 17:30 IST (open). 04:00 UTC = 09:30 IST (closed).
const MON_OPEN = new Date("2025-07-07T12:00:00Z");
const MON_EARLY = new Date("2025-07-07T04:00:00Z");
const SUN_NOON = new Date("2025-07-06T06:30:00Z"); // Sunday 12:00 IST
const HOLIDAY = new Date("2025-08-15T12:00:00Z"); // in the static calendar
const NO_HOLIDAYS: string[] = [];

describe("timePartsInZone", () => {
  it("converts UTC to IST parts", () => {
    const t = timePartsInZone(MON_OPEN, "Asia/Kolkata");
    expect(t.day).toBe(1); // Monday
    expect(t.minutes).toBe(17 * 60 + 30);
    expect(t.date).toBe("2025-07-07");
  });
});

describe("isOpenNow", () => {
  it("open during hours on a working day", () => {
    expect(isOpenNow(ENTRY, MON_OPEN)).toBe(true);
  });
  it("closed before opening", () => {
    expect(isOpenNow(ENTRY, MON_EARLY)).toBe(false);
  });
  it("closed on Sunday", () => {
    expect(isOpenNow(ENTRY, SUN_NOON)).toBe(false);
  });
  it("boundary: exactly at close is closed", () => {
    expect(isOpenNow(ENTRY, new Date("2025-07-07T14:30:00Z"))).toBe(false); // 20:00 IST
  });
});

describe("isHolidayToday / businessStatus", () => {
  it("detects a holiday from the list", () => {
    expect(isHolidayToday(HOLIDAY, "Asia/Kolkata", ["2025-08-15"])).toBe(true);
  });
  it("holiday beats open hours", () => {
    expect(businessStatus(ENTRY, HOLIDAY, ["2025-08-15"])).toBe("holiday");
  });
  it("after-hours when closed and not holiday", () => {
    expect(businessStatus(ENTRY, MON_EARLY, NO_HOLIDAYS)).toBe("after-hours");
  });
  it("open otherwise", () => {
    expect(businessStatus(ENTRY, MON_OPEN, NO_HOLIDAYS)).toBe("open");
  });
});

describe("resolveGreeting", () => {
  const base = "Namaste! Demo Dental Clinic. How may I help you?";
  it("returning caller during hours → Welcome back + base greeting", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, callerName: "Ramesh Test", now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.greeting).toBe(`Welcome back, Ramesh Test! ${base}`);
    expect(r.businessStatus).toBe("open");
    expect(r.isReturning).toBe(true);
  });
  it("new caller during hours → base greeting unchanged", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, callerName: null, now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.greeting).toBe(base);
    expect(r.isReturning).toBe(false);
  });
  it("after hours → after-hours message", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, now: MON_EARLY, holidays: NO_HOLIDAYS, hoursEntry: ENTRY });
    expect(r.greeting).toBe("We are closed now.");
    expect(r.businessStatus).toBe("after-hours");
  });
  it("holiday → holiday message beats business hours", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, now: HOLIDAY, holidays: ["2025-08-15"], hoursEntry: ENTRY });
    expect(r.greeting).toBe("Holiday today.");
    expect(r.businessStatus).toBe("holiday");
  });
  it("demo-clinic config: after-hours uses the configured clinic message", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, now: MON_EARLY, holidays: NO_HOLIDAYS });
    expect(r.businessStatus).toBe("after-hours");
    expect(r.greeting).toContain("Demo Dental Clinic");
  });
  it("unknown workspace slug falls back to default hours", () => {
    const r = resolveGreeting({ workspaceSlug: "no-such-ws", baseGreeting: base, now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.businessStatus).toBe("open"); // default 09:00-19:00 covers 17:30 IST
  });
  it("blank caller name is not treated as returning", () => {
    const r = resolveGreeting({ workspaceSlug: "demo-clinic", baseGreeting: base, callerName: "   ", now: MON_OPEN, holidays: NO_HOLIDAYS });
    expect(r.isReturning).toBe(false);
    expect(r.greeting).toBe(base);
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/greeting.test.ts
```
**Expected:** all tests pass (`Test Files  1 passed`). **If it fails:** re-copy both
files exactly; check `date` on the VPS is UTC (`timedatectl | grep "Time zone"`) — the
test dates are UTC-based and zone-independent.

---

## Step 4: Spam & robocall filter

Three signals, in priority order: (1) manual blocklist (`DncEntry` with
`source = MANUAL`), (2) known spam caller-id prefixes, (3) rapid-repeat detection
(more than N calls from the same number within a window).

**File `src/lib/spamFilter.ts`** (full content):

```ts
import { db } from "./db";
import { SPAM_PREFIXES } from "@/config/spamPrefixes";

export const RAPID_REPEAT_WINDOW_MIN = 10;
export const RAPID_REPEAT_MAX_CALLS = 3;

export type SpamReason = "manual-block" | "spam-prefix" | "rapid-repeat";
export type SpamVerdict = { spam: boolean; reason?: SpamReason };

/** Pure classifier — unit-tested directly. */
export function classifySpam(input: {
  phone: string;
  manualBlocked: boolean;
  recentCalls: number;
  maxCallsPerWindow: number;
  prefixes: string[];
}): SpamVerdict {
  if (input.manualBlocked) return { spam: true, reason: "manual-block" };
  if (input.prefixes.some((p) => p.length > 0 && input.phone.startsWith(p))) {
    return { spam: true, reason: "spam-prefix" };
  }
  if (input.recentCalls > input.maxCallsPerWindow) return { spam: true, reason: "rapid-repeat" };
  return { spam: false };
}

/** DB-backed check used by the resolver. Never throws — fail OPEN (do not block
 *  legitimate callers because of our own errors). */
export async function checkInboundSpam(workspaceId: string, phone: string): Promise<SpamVerdict> {
  try {
    const since = new Date(Date.now() - RAPID_REPEAT_WINDOW_MIN * 60_000);
    const [manual, recentCalls] = await Promise.all([
      db.dncEntry.findUnique({
        where: { workspaceId_phone: { workspaceId, phone } },
        select: { source: true },
      }),
      db.call.count({
        where: { workspaceId, fromNumber: phone, direction: "INBOUND", createdAt: { gte: since } },
      }),
    ]);
    return classifySpam({
      phone,
      manualBlocked: manual?.source === "MANUAL",
      recentCalls,
      maxCallsPerWindow: RAPID_REPEAT_MAX_CALLS,
      prefixes: SPAM_PREFIXES,
    });
  } catch (e) {
    console.error("spam check failed, failing open", e);
    return { spam: false };
  }
}
```

**File `tests/spamFilter.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { classifySpam, RAPID_REPEAT_MAX_CALLS } from "../src/lib/spamFilter";

const BASE = {
  phone: "+919812345678",
  manualBlocked: false,
  recentCalls: 0,
  maxCallsPerWindow: RAPID_REPEAT_MAX_CALLS,
  prefixes: [] as string[],
};

describe("classifySpam", () => {
  it("clean caller passes", () => {
    expect(classifySpam(BASE)).toEqual({ spam: false });
  });
  it("manual block wins over everything", () => {
    const v = classifySpam({ ...BASE, manualBlocked: true, recentCalls: 99, prefixes: ["+91"] });
    expect(v).toEqual({ spam: true, reason: "manual-block" });
  });
  it("spam prefix blocks", () => {
    const v = classifySpam({ ...BASE, phone: "+911401234567", prefixes: ["+91140"] });
    expect(v).toEqual({ spam: true, reason: "spam-prefix" });
  });
  it("non-matching prefix does not block", () => {
    const v = classifySpam({ ...BASE, phone: "+919812345678", prefixes: ["+91140"] });
    expect(v.spam).toBe(false);
  });
  it("empty prefix entries are ignored", () => {
    const v = classifySpam({ ...BASE, prefixes: [""] });
    expect(v.spam).toBe(false);
  });
  it("rapid repeat over the limit blocks", () => {
    const v = classifySpam({ ...BASE, recentCalls: RAPID_REPEAT_MAX_CALLS + 1 });
    expect(v).toEqual({ spam: true, reason: "rapid-repeat" });
  });
  it("exactly at the limit does NOT block", () => {
    const v = classifySpam({ ...BASE, recentCalls: RAPID_REPEAT_MAX_CALLS });
    expect(v.spam).toBe(false);
  });
  it("manual block takes priority over rapid-repeat", () => {
    const v = classifySpam({ ...BASE, manualBlocked: true, recentCalls: 99 });
    expect(v.reason).toBe("manual-block");
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/spamFilter.test.ts
```
**Expected:** all tests pass.

---

## Step 5: Fallback policy module (auto-transfer decider)

Pure decider + the zod schema for the HUMAN_TRANSFER tool config JSON (contract #4).
Used by the transfer-request route (Step 16), the post-call processor (Step 15), and
the resolver (Step 6).

**File `src/lib/fallbackPolicy.ts`** (full content):

```ts
import { z } from "zod";

/** Config stored on AgentToolConfig.config where tool = HUMAN_TRANSFER. */
export const humanTransferConfigSchema = z.object({
  queue: z.string().min(1).default("support"),
  skill: z.string().min(1).optional(),
  vipNumbers: z.array(z.string()).default([]),
  queueDestinations: z.record(z.string()).default({}),
  autoTransfer: z
    .object({
      onExplicitRequest: z.boolean().default(true),
      onRepeatedMisunderstanding: z.boolean().default(true),
      onLowConfidence: z.boolean().default(false),
      onVip: z.boolean().default(true),
    })
    .default({}),
  maxMisunderstandings: z.number().int().min(1).default(3),
});

export type HumanTransferConfig = z.infer<typeof humanTransferConfigSchema>;

/** Parse unknown JSON from the DB; invalid/missing → safe defaults. Never throws. */
export function parseHumanTransferConfig(raw: unknown): HumanTransferConfig {
  const parsed = humanTransferConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : humanTransferConfigSchema.parse({});
}

export type FallbackSignals = {
  callerPhone: string;
  explicitHumanRequest?: boolean;
  misunderstandingCount?: number;
  lowConfidence?: boolean;
};

export type TransferReason = "vip" | "explicit-request" | "repeated-misunderstanding" | "low-confidence";
export type TransferDecision = {
  transfer: boolean;
  reason?: TransferReason;
  queue: string;
  skill?: string;
};

/**
 * Decide whether a call should be transferred to a human.
 * Priority: VIP > explicit request > repeated misunderstanding > low confidence.
 */
export function decideTransfer(config: HumanTransferConfig, signals: FallbackSignals): TransferDecision {
  const base = { queue: config.queue, skill: config.skill };
  if (config.autoTransfer.onVip && config.vipNumbers.includes(signals.callerPhone)) {
    return { transfer: true, reason: "vip", ...base };
  }
  if (config.autoTransfer.onExplicitRequest && signals.explicitHumanRequest) {
    return { transfer: true, reason: "explicit-request", ...base };
  }
  if (
    config.autoTransfer.onRepeatedMisunderstanding &&
    (signals.misunderstandingCount ?? 0) >= config.maxMisunderstandings
  ) {
    return { transfer: true, reason: "repeated-misunderstanding", ...base };
  }
  if (config.autoTransfer.onLowConfidence && signals.lowConfidence) {
    return { transfer: true, reason: "low-confidence", ...base };
  }
  return { transfer: false, ...base };
}
```

**File `tests/fallbackPolicy.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  decideTransfer,
  parseHumanTransferConfig,
  type HumanTransferConfig,
} from "../src/lib/fallbackPolicy";

const CONFIG: HumanTransferConfig = {
  queue: "support",
  skill: "hindi",
  vipNumbers: ["+919812345678"],
  queueDestinations: { support: "+919800000001" },
  autoTransfer: {
    onExplicitRequest: true,
    onRepeatedMisunderstanding: true,
    onLowConfidence: false,
    onVip: true,
  },
  maxMisunderstandings: 3,
};

describe("parseHumanTransferConfig", () => {
  it("parses a full config", () => {
    const c = parseHumanTransferConfig(CONFIG);
    expect(c.queue).toBe("support");
    expect(c.maxMisunderstandings).toBe(3);
  });
  it("undefined/null/garbage → defaults, never throws", () => {
    for (const raw of [undefined, null, "garbage", 42, { autoTransfer: "nope" }]) {
      const c = parseHumanTransferConfig(raw);
      expect(c.queue).toBe("support");
      expect(c.vipNumbers).toEqual([]);
      expect(c.autoTransfer.onExplicitRequest).toBe(true);
      expect(c.autoTransfer.onLowConfidence).toBe(false);
    }
  });
  it("partial config fills defaults", () => {
    const c = parseHumanTransferConfig({ queue: "sales", vipNumbers: ["+91"] });
    expect(c.queue).toBe("sales");
    expect(c.autoTransfer.onVip).toBe(true);
  });
});

describe("decideTransfer", () => {
  it("VIP caller transfers with reason vip", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+919812345678" });
    expect(d).toEqual({ transfer: true, reason: "vip", queue: "support", skill: "hindi" });
  });
  it("explicit human request transfers", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", explicitHumanRequest: true });
    expect(d.reason).toBe("explicit-request");
  });
  it("repeated misunderstanding at threshold transfers", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", misunderstandingCount: 3 });
    expect(d.reason).toBe("repeated-misunderstanding");
  });
  it("below threshold does not transfer", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", misunderstandingCount: 2 });
    expect(d.transfer).toBe(false);
  });
  it("low confidence ignored when disabled", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+911", lowConfidence: true });
    expect(d.transfer).toBe(false);
  });
  it("low confidence transfers when enabled", () => {
    const c = { ...CONFIG, autoTransfer: { ...CONFIG.autoTransfer, onLowConfidence: true } };
    const d = decideTransfer(c, { callerPhone: "+911", lowConfidence: true });
    expect(d.reason).toBe("low-confidence");
  });
  it("VIP beats explicit request (priority order)", () => {
    const d = decideTransfer(CONFIG, { callerPhone: "+919812345678", explicitHumanRequest: true });
    expect(d.reason).toBe("vip");
  });
  it("disabled VIP flag stops VIP transfer", () => {
    const c = { ...CONFIG, autoTransfer: { ...CONFIG.autoTransfer, onVip: false } };
    const d = decideTransfer(c, { callerPhone: "+919812345678" });
    expect(d.transfer).toBe(false);
  });
  it("calm call does not transfer", () => {
    expect(decideTransfer(CONFIG, { callerPhone: "+911" }).transfer).toBe(false);
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/fallbackPolicy.test.ts
```
**Expected:** all tests pass.

---

## Step 6: Inbound resolver API route (extended: greeting + spam + caller context)

This endpoint answers: "for this called number, which Dograh workflow, what greeting,
and should we even answer?" It doubles as Dograh's **Pre-Call Data Fetch** endpoint
(documented Dograh feature: fetch customer data before the call starts so the agent
can greet by name — the returned `context` keys become template variables in the
Start Call node). **Overwrite the whole file** from guide 06's original version.

**File `src/app/api/v1/resolve-number/route.ts`** (full content):

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveGreeting } from "@/lib/greeting";
import { checkInboundSpam } from "@/lib/spamFilter";
import { parseHumanTransferConfig } from "@/lib/fallbackPolicy";

/**
 * Called by the voice stack at inbound call start (pre-call data fetch).
 * GET /api/v1/resolve-number?to=%2B918040001234&from=%2B919812345678
 * Secured by a shared secret header (same secret as the Dograh webhook).
 *
 * Response (200): { ok, workflowId, agentName, workspaceId, greeting, context, blocked }
 *  - greeting: the exact text the AI should speak (smart greeting by context, spec §5)
 *  - context:  template variables for the workflow (caller_name, is_returning_caller,
 *              business_status, transfer_queue, transfer_skill)
 *  - blocked:  true + blockReason when the spam filter rejects the caller
 */
export async function GET(req: NextRequest) {
  const secret = process.env.DOGRAH_WEBHOOK_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (secret && provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const to = req.nextUrl.searchParams.get("to");
  if (!to) return NextResponse.json({ ok: false, error: "missing ?to=" }, { status: 400 });
  const from = req.nextUrl.searchParams.get("from") ?? "";

  const phone = await db.phoneNumber.findFirst({
    where: { number: to },
    include: { agent: { include: { toolConfigs: true } }, workspace: { select: { slug: true } } },
  });
  if (!phone || !phone.agent || phone.agent.status !== "PUBLISHED" || !phone.agent.dograhWorkflowId) {
    return NextResponse.json({ ok: false, error: "no published agent for this number" }, { status: 404 });
  }

  // Spam & robocall filtering (spec §5) — checked before anything else.
  const spam = from ? await checkInboundSpam(phone.workspaceId, from) : { spam: false as const };
  if (spam.spam) {
    return NextResponse.json({ ok: true, blocked: true, blockReason: spam.reason, workspaceId: phone.workspaceId });
  }

  // Returning-caller detection: Contact lookup by caller number in this workspace.
  const contact = from
    ? await db.contact.findUnique({
        where: { workspaceId_phone: { workspaceId: phone.workspaceId, phone: from } },
        select: { name: true, dnc: true },
      })
    : null;

  const g = resolveGreeting({
    workspaceSlug: phone.workspace.slug,
    baseGreeting: phone.agent.greeting,
    callerName: contact?.name,
  });

  const transferConfig = parseHumanTransferConfig(
    phone.agent.toolConfigs.find((t) => t.tool === "HUMAN_TRANSFER")?.config
  );

  return NextResponse.json({
    ok: true,
    blocked: false,
    workflowId: phone.agent.dograhWorkflowId,
    agentName: phone.agent.name,
    workspaceId: phone.workspaceId,
    greeting: g.greeting,
    context: {
      caller_name: contact?.name ?? "",
      is_returning_caller: g.isReturning ? "true" : "false",
      business_status: g.businessStatus,
      transfer_queue: transferConfig.queue,
      transfer_skill: transferConfig.skill ?? "",
    },
  });
}
```

**Dograh wiring (operator, 2 minutes, OPERATOR GATE):** in the Dograh workflow's
configuration, set the **Pre-Call Data Fetch** URL to
`https://<app-domain>/api/v1/resolve-number?to={{to_number}}&from={{from_number}}`
with header `x-internal-secret: <DOGRAH_WEBHOOK_SECRET>`, map response fields
`greeting`, `context.caller_name` into the Start Call node greeting as template
variables, and honor `blocked: true` by ending the call immediately. The exact
response-mapping UI varies by Dograh version — the operator verifies the variable
names in the Dograh docs page "Pre-Call Data Fetch". **Gate:** until this is wired,
the resolver remains a verified internal API (Step 21 tests it end-to-end) and the
agent speaks its static greeting.

**Natural-language call routing (spec §5) — configuration, no code:** intent routing
is a workflow-design concern owned by guide 05's builder. The documented intents and
branch config for the receptionist workflow (configure in the Dograh workflow editor
as edges out of the main agentNode, each with a `condition`):

| Intent (edge label) | Condition (natural language, Dograh evaluates) | Target node |
|---|---|---|
| `booking` | "The caller wants to book, reschedule, or cancel an appointment" | booking agentNode (uses the calendar tool from guide 05) |
| `faq` | "The caller asks a question about hours, location, pricing, or policies" | FAQ agentNode (knowledge base attached) |
| `transfer` | "The caller explicitly asks for a human or a specific department/person" | Call Transfer tool node (Step 16 route as dynamic destination) |
| `message` | "The caller wants to leave a message for staff" | message-taking agentNode → voicemail flow (Step 14) |

Our resolver's `context.business_status` variable lets the greeting node say
"we're closed right now, but…" before routing. No executor decisions here — the table
above is the exact config to create.

**Verify (with dev server):**
```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15
SECRET=$(grep DOGRAH_WEBHOOK_SECRET .env | cut -d= -f2)

# no number registered → 404
curl -s -o /dev/null -w "%{http_code}\n" -H "x-internal-secret: $SECRET" \
  "http://localhost:3000/api/v1/resolve-number?to=%2B918040001234"

# no secret → 401
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/v1/resolve-number?to=%2B918040001234"
```
**Expected:** `404` then `401`. (The 200 path with greeting + context is tested in
Step 21.) Keep the dev server running for Step 21; stop it at the end of Step 21.
**If it fails:** `tail -n 40 /tmp/next-dev.log`; a Prisma error about `toolConfigs` or
`workspace` means the include names drifted — check `prisma/schema.prisma` relations
on `PhoneNumber`.

---

## Step 7: Server actions — register number (with type), assign agent

**File `src/server/actions/numbers.ts`** (full content — overwrites the original):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { NumberType } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ActionResult = { ok: boolean; error?: string };

const numberSchema = z.object({
  number: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +918040001234"),
  label: z.string().max(60).optional(),
  numberType: z.nativeEnum(NumberType).default("LOCAL"),
  monthlyRentPaise: z.coerce.number().int().min(0).default(0),
});

export async function registerNumberAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("numbers:write");
    const parsed = numberSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid number." };
    }
    await db.phoneNumber.create({
      data: { ...parsed.data, workspaceId: ctx.workspaceId },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "number.register", entity: "PhoneNumber",
      metadata: { number: parsed.data.number, numberType: parsed.data.numberType },
    });
    revalidatePath("/numbers");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return { ok: false, error: "This number is already registered in your workspace." };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function assignAgentAction(phoneNumberId: string, agentId: string | null): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("numbers:write");
    if (agentId) {
      // The agent must belong to the same workspace AND be published.
      const agent = await db.agent.findFirst({
        where: { id: agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
      });
      if (!agent) return { ok: false, error: "Agent not found or not published yet." };
    }
    const updated = await db.phoneNumber.updateMany({
      where: { id: phoneNumberId, workspaceId: ctx.workspaceId },
      data: { agentId },
    });
    if (updated.count === 0) return { ok: false, error: "Number not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: agentId ? "number.assign" : "number.unassign",
      entity: "PhoneNumber", entityId: phoneNumberId, metadata: { agentId },
    });
    revalidatePath("/numbers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function deleteNumberAction(phoneNumberId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("numbers:write");
    const deleted = await db.phoneNumber.deleteMany({
      where: { id: phoneNumberId, workspaceId: ctx.workspaceId },
    });
    if (deleted.count === 0) return { ok: false, error: "Number not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "number.delete", entity: "PhoneNumber", entityId: phoneNumberId,
    });
    revalidatePath("/numbers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

**Negative RBAC check (scripted):** a VIEWER must NOT hold `numbers:write`, so
`registerNumberAction` (which calls `requirePermission("numbers:write")` first)
rejects them before touching the DB.

**File `scripts/perm-check.ts`** (full content):

```ts
import { hasPermission } from "../src/lib/permissions";

const viewer = { role: "VIEWER" as const, grantedPermissions: [] as string[], revokedPermissions: [] as string[] };
const admin = { role: "ADMIN" as const, grantedPermissions: [] as string[], revokedPermissions: [] as string[] };
const agent = { role: "AGENT" as const, grantedPermissions: [] as string[], revokedPermissions: [] as string[] };

console.log("viewer numbers:write =", hasPermission(viewer, "numbers:write"));
console.log("admin numbers:write =", hasPermission(admin, "numbers:write"));
console.log("agent numbers:write =", hasPermission(agent, "numbers:write"));
console.log("agent live:whisper =", hasPermission(agent, "live:whisper"));
```

```bash
cd /root/vaani-ai && npx tsx scripts/perm-check.ts
```
**Expected:**
```
viewer numbers:write = false
admin numbers:write = true
agent numbers:write = false
agent live:whisper = true
```
(The thrown `FORBIDDEN` is caught by the action and returned as `{ ok: false }` —
the DB is never touched. Guide 11's Playwright suite covers the UI-level 403 path
with a real viewer session.)

---

## Step 8: Numbers page (with number type + test ids)

**File `src/app/(app)/numbers/page.tsx`** (full content — overwrites the original):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import {
  registerNumberAction, assignAgentAction, deleteNumberAction,
} from "@/server/actions/numbers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";

const NUMBER_TYPES = [
  { value: "LOCAL", label: "Local DID" },
  { value: "TOLLFREE", label: "Toll-free 1800" },
  { value: "MOBILE", label: "Mobile series" },
  { value: "SERIES_140", label: "140 (promotional)" },
  { value: "SERIES_1600", label: "1600 (service)" },
];

export default async function NumbersPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const [numbers, agents] = await Promise.all([
    db.phoneNumber.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.agent.findMany({
      where: { workspaceId: ctx.workspaceId, status: "PUBLISHED" },
      select: { id: true, name: true },
    }),
  ]);

  async function register(formData: FormData) {
    "use server";
    await registerNumberAction({
      number: formData.get("number"),
      label: formData.get("label") || undefined,
      numberType: formData.get("numberType") || "LOCAL",
      monthlyRentPaise: formData.get("rent") || 0,
    });
  }
  async function assign(formData: FormData) {
    "use server";
    const agentId = String(formData.get("agentId") ?? "");
    await assignAgentAction(String(formData.get("id")), agentId === "" ? null : agentId);
  }
  async function remove(formData: FormData) {
    "use server";
    await deleteNumberAction(String(formData.get("id")));
  }

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-bold">Phone Numbers</h1>

      <Card>
        <CardHeader><CardTitle>Register a number</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Enter the DID you rented from Vobiz (E.164 format). The same number must be
            pointed at this server in the Vobiz dashboard (guide 04) and bound to the
            published workflow in Dograh (Step 1).
          </p>
          <form action={register} className="flex flex-wrap gap-2">
            <Input name="number" placeholder="+918040001234" className="w-52" required
              data-testid="number-input" />
            <Input name="label" placeholder="Label (e.g. Main line)" className="w-48" />
            <select name="numberType" defaultValue="LOCAL" data-testid="number-type-select"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm">
              {NUMBER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <Input name="rent" type="number" placeholder="Rent ₹/mo" className="w-32" />
            <Button type="submit" data-testid="number-add-btn">Add number</Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {numbers.length === 0 && (
          <p className="text-muted-foreground">No numbers yet. Register your first DID above.</p>
        )}
        {numbers.map((n) => (
          <Card key={n.id} data-testid="number-row">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-44">
                <p className="font-mono font-semibold">{n.number}</p>
                <p className="text-xs text-muted-foreground">
                  {n.label ?? "—"} · {NUMBER_TYPES.find((t) => t.value === n.numberType)?.label ?? n.numberType}
                  {" "}· rent {formatINR(n.monthlyRentPaise)}/mo
                </p>
              </div>
              <form action={assign} className="flex items-center gap-2">
                <input type="hidden" name="id" value={n.id} />
                <select name="agentId" defaultValue={n.agentId ?? ""} data-testid="number-agent-select"
                  className="h-9 rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">— no agent (calls rejected) —</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <Button type="submit" size="sm" variant="outline" data-testid="number-assign-btn">Assign</Button>
              </form>
              <p className="text-xs text-muted-foreground">
                {n.agent ? `answering: ${n.agent.name}` : "unassigned"}
              </p>
              <form action={remove} className="ml-auto">
                <input type="hidden" name="id" value={n.id} />
                <Button type="submit" size="sm" variant="ghost" data-testid="number-delete-btn">Delete</Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/numbers` in build output.

---

## Step 9: Dial-job contracts (callback-dial + manual-dial) on the shared queue

One shared BullMQ queue named **`campaign-dialer`** (guide 07's worker consumes it).
This guide creates its own lightweight producer handle (BullMQ allows many `Queue`
instances per queue name) so it never imports guide 07's `lib/queue.ts` (which does
not exist yet at this phase).

**File `src/lib/dialJobs.ts`** (full content):

```ts
import { Queue } from "bullmq";

/**
 * Job contracts on the shared "campaign-dialer" queue.
 * GUIDE 07: your worker MUST handle job names "callback-dial" and "manual-dial"
 * with exactly these payload shapes (contract #1 at the top of guide 06).
 */
export const DIALER_QUEUE_NAME = "campaign-dialer";
export const CALLBACK_DIAL_JOB = "callback-dial";
export const MANUAL_DIAL_JOB = "manual-dial";

export type CallbackDialJobData = {
  workspaceId: string;
  callbackTaskId: string;
  phone: string; // E.164 to call back
  note?: string;
  requestedBy: "system";
  enqueuedAt: string; // ISO
};

export type ManualDialJobData = {
  workspaceId: string;
  userId: string;
  callId: string; // existing Call row (OUTBOUND/RINGING) the worker attaches to
  fromNumber: string; // workspace DID (E.164) to dial from
  toNumber: string; // destination (E.164)
  enqueuedAt: string; // ISO
};

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

/** Pure builders (unit-tested). */
export function buildCallbackDialJob(
  input: { workspaceId: string; callbackTaskId: string; phone: string; note?: string; dueAt: Date },
  now: Date = new Date()
): { name: typeof CALLBACK_DIAL_JOB; data: CallbackDialJobData; opts: typeof JOB_OPTS & { delay: number } } {
  return {
    name: CALLBACK_DIAL_JOB,
    data: {
      workspaceId: input.workspaceId,
      callbackTaskId: input.callbackTaskId,
      phone: input.phone,
      note: input.note,
      requestedBy: "system",
      enqueuedAt: now.toISOString(),
    },
    opts: { ...JOB_OPTS, delay: Math.max(0, input.dueAt.getTime() - now.getTime()) },
  };
}

export function buildManualDialJob(
  input: { workspaceId: string; userId: string; callId: string; fromNumber: string; toNumber: string },
  now: Date = new Date()
): { name: typeof MANUAL_DIAL_JOB; data: ManualDialJobData; opts: typeof JOB_OPTS } {
  return {
    name: MANUAL_DIAL_JOB,
    data: { ...input, enqueuedAt: now.toISOString() },
    opts: JOB_OPTS,
  };
}

// ---------- Producer handle (own Queue instance on the shared queue name) ----------

let queue: Queue | null = null;

function redisConnection(): { host: string; port: number; password?: string } {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

function getDialerQueue(): Queue {
  if (!queue) queue = new Queue(DIALER_QUEUE_NAME, { connection: redisConnection() });
  return queue;
}

export async function enqueueCallbackDial(
  input: { workspaceId: string; callbackTaskId: string; phone: string; note?: string; dueAt: Date }
): Promise<void> {
  const job = buildCallbackDialJob(input);
  await getDialerQueue().add(job.name, job.data, job.opts);
}

export async function enqueueManualDial(
  input: { workspaceId: string; userId: string; callId: string; fromNumber: string; toNumber: string }
): Promise<void> {
  const job = buildManualDialJob(input);
  await getDialerQueue().add(job.name, job.data, job.opts);
}
```

**File `tests/dialJobs.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  buildCallbackDialJob,
  buildManualDialJob,
  CALLBACK_DIAL_JOB,
  DIALER_QUEUE_NAME,
  MANUAL_DIAL_JOB,
} from "../src/lib/dialJobs";

const NOW = new Date("2025-07-07T12:00:00Z");

describe("queue name contract", () => {
  it("is the shared campaign-dialer queue (guide 07 consumes it)", () => {
    expect(DIALER_QUEUE_NAME).toBe("campaign-dialer");
  });
});

describe("buildCallbackDialJob", () => {
  it("builds the callback-dial payload with delay until dueAt", () => {
    const dueAt = new Date("2025-07-07T12:15:00Z");
    const job = buildCallbackDialJob(
      { workspaceId: "w1", callbackTaskId: "t1", phone: "+919812345678", note: "MISSED_CALL", dueAt },
      NOW
    );
    expect(job.name).toBe(CALLBACK_DIAL_JOB);
    expect(job.data).toEqual({
      workspaceId: "w1",
      callbackTaskId: "t1",
      phone: "+919812345678",
      note: "MISSED_CALL",
      requestedBy: "system",
      enqueuedAt: NOW.toISOString(),
    });
    expect(job.opts.delay).toBe(15 * 60_000);
    expect(job.opts.attempts).toBe(3);
  });
  it("past dueAt → zero delay, never negative", () => {
    const job = buildCallbackDialJob(
      { workspaceId: "w1", callbackTaskId: "t1", phone: "+919812345678", dueAt: new Date("2025-07-07T11:00:00Z") },
      NOW
    );
    expect(job.opts.delay).toBe(0);
  });
});

describe("buildManualDialJob", () => {
  it("builds the manual-dial payload with no delay", () => {
    const job = buildManualDialJob(
      { workspaceId: "w1", userId: "u1", callId: "c1", fromNumber: "+918040001234", toNumber: "+919812345678" },
      NOW
    );
    expect(job.name).toBe(MANUAL_DIAL_JOB);
    expect(job.data.callId).toBe("c1");
    expect(job.data.fromNumber).toBe("+918040001234");
    expect(job.data.enqueuedAt).toBe(NOW.toISOString());
    expect("delay" in job.opts).toBe(false);
    expect(job.opts.backoff).toEqual({ type: "exponential", delay: 60_000 });
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/dialJobs.test.ts && npm run typecheck
```
**Expected:** tests pass; typecheck exit 0.

---

## Step 10: Webhook event helper (`emitWebhookEvent`)

Creates PENDING `WebhookDelivery` rows for every active subscription that listens to
the event. Guide 08's delivery worker does the HTTP POST + HMAC signing + retries.

**File `src/lib/webhooks.ts`** (full content):

```ts
import { db } from "./db";

/**
 * Fan out a tenant event to webhook subscribers (spec §9 event subscriptions).
 * Returns the number of deliveries enqueued. Never throws — webhook fan-out must
 * not break call processing.
 *
 * Events emitted in this guide: "call.completed", "call.missed", "voicemail.received",
 * "transfer.requested". (Guide 08 delivers them; guide 07 emits campaign events.)
 */
export async function emitWebhookEvent(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<number> {
  try {
    const subs = await db.webhookSubscription.findMany({
      where: { workspaceId, active: true, events: { has: event } },
      select: { id: true },
    });
    if (subs.length === 0) return 0;
    await db.webhookDelivery.createMany({
      data: subs.map((s) => ({
        subscriptionId: s.id,
        event,
        payload: { ...payload, event, workspaceId, emittedAt: new Date().toISOString() },
        nextRetryAt: new Date(),
      })),
    });
    return subs.length;
  } catch (e) {
    console.error("emitWebhookEvent failed", event, e);
    return 0;
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 11: Staff notification helpers (email + WhatsApp, dry-run safe)

WhatsApp sending is guide 04's client: `sendWhatsAppTemplate` from
`src/lib/vobiz.ts` (object signature `{ to, templateName, languageCode?, components? }`).
Confirm it exists (it must — guide 04 ran before this one):

```bash
cd /root/vaani-ai
grep -n "export async function sendWhatsAppTemplate" src/lib/vobiz.ts
```
**Expected:** one match. **If it fails:** guide 04 was not fully executed — STOP and
report; do NOT create your own WhatsApp client.

**File `src/lib/notify.ts`** (full content):

```ts
import nodemailer from "nodemailer";
import { sendWhatsAppTemplate } from "./vobiz"; // guide 04's client

export function staffEmails(): string[] {
  return (process.env.STAFF_NOTIFICATION_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function staffWhatsAppNumbers(): string[] {
  return (process.env.STAFF_NOTIFICATION_WHATSAPP ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Email a summary to staff. Skips cleanly when SMTP is not configured. Never throws. */
export async function sendStaffEmail(
  subject: string,
  text: string
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const to = staffEmails();
  const host = process.env.SMTP_HOST;
  if (to.length === 0 || !host) {
    console.log(`[notify] email skipped (no SMTP_HOST or recipients): ${subject}`);
    return { ok: true, skipped: true };
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
        : {}),
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? "Vaani AI <no-reply@vaani.ai>",
      to: to.join(", "),
      subject,
      text,
    });
    return { ok: true };
  } catch (e) {
    console.error("sendStaffEmail failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

/** WhatsApp a summary to staff via guide 04's Vobiz client, behind the
 *  WHATSAPP_DRY_RUN gate (true = log only, the default). Never throws.
 *  Params are mapped to the WhatsApp Cloud-API body-component shape that
 *  guide 04's client expects (same shape as guide 05's waComponents helper). */
export async function sendStaffWhatsApp(
  templateName: string,
  params: string[]
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const numbers = staffWhatsAppNumbers();
  if (numbers.length === 0) return { ok: true, skipped: true };
  if (process.env.WHATSAPP_DRY_RUN !== "false") {
    console.log(
      `[notify] whatsapp DRY RUN template=${templateName} to=${numbers.join(",")} params=${JSON.stringify(params)}`
    );
    return { ok: true, skipped: true };
  }
  const components: Array<Record<string, unknown>> = params.length
    ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
    : [];
  let lastError: string | undefined;
  for (const to of numbers) {
    try {
      // guide 04's client returns WhatsAppSendResult and THROWS VobizError on failure.
      await sendWhatsAppTemplate({ to, templateName, components });
    } catch (e) {
      lastError = String(e).slice(0, 200);
    }
  }
  return lastError ? { ok: false, error: lastError } : { ok: true };
}

/** One-call helper for "message taken / voicemail received" notifications. */
export async function notifyStaffMessage(input: {
  fromNumber: string;
  summary: string;
  kind: "message" | "voicemail";
}): Promise<void> {
  const subject = `[Vaani] New ${input.kind} from ${input.fromNumber}`;
  await sendStaffEmail(subject, input.summary);
  await sendStaffWhatsApp("staff_message_alert", [input.fromNumber, input.summary.slice(0, 200)]);
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0. **If it fails** on the `sendWhatsAppTemplate` call → guide
04's real signature differs from the contract above (`components?:
Array<Record<string, unknown>>`, throws on failure); adapt ONLY the single call
inside `sendStaffWhatsApp` to the real signature and report the deviation. Do not
edit `src/lib/vobiz.ts`.

---

## Step 12: Appointment booking / rescheduling / cancellation (receptionist side)

Guide 05 owns the `book_appointment` tool node (calendar availability check + booking
via `CalendarConnection`). This step is the receptionist-side playbook: what to
configure, and a scripted simulation proving the branch works against a **mocked
calendar** (no real Google Calendar needed).

**Configuration (operator, in the Dograh workflow editor — OPERATOR GATE for live
telephony; fully testable in Step 21's simulation):**

1. On the `booking` intent branch (table in Step 6), the booking agentNode's prompt
   must instruct: collect (a) preferred date/time, (b) service, (c) caller name;
   confirm by reading back; then invoke the `book_appointment` tool.
2. **Rescheduling and cancellation require caller verification** (policy — build it
   into the prompt, exactly this rule): the caller's phone number (available as the
   `{{from_number}}` template variable) must match the number on the existing
   appointment AND the caller must state the name on the appointment. Only then may
   the agent reschedule/cancel via the calendar tool.
3. If no `CalendarConnection` exists for the workspace, the agent must say: "I'll
   have our staff confirm the appointment and call you back" and take a message
   instead (flows into Step 14).

**Scripted simulation (Hermes — fake calendar via a mock CalendarConnection):**

```bash
cd /root/vaani-ai
# 1. Mock a calendar connection for the seed workspace (accessToken is fake on purpose)
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"CalendarConnection\" (id, \"workspaceId\", provider, \"accessToken\", \"primaryCalendarId\", active, \"createdAt\", \"updatedAt\") \
  SELECT 'cal_sim', id, 'GOOGLE', 'fake-token-sim', 'primary', true, now(), now() FROM \"Workspace\" WHERE slug='demo-clinic' \
  ON CONFLICT (\"workspaceId\", provider) DO NOTHING;"

# 2. Verify the booking-branch data path: the resolver exposes everything the
#    booking branch needs (called number → agent + caller identity for verification).
SECRET=$(grep DOGRAH_WEBHOOK_SECRET .env | cut -d= -f2)
curl -s -H "x-internal-secret: $SECRET" \
  "http://localhost:3000/api/v1/resolve-number?to=%2B918040001234&from=%2B919812345678"
```
**Expected:** 200 JSON with `ok:true`, `context.caller_name:"Ramesh Test"` (seeded in
Step 22's Setup — if you have not run it yet, run that Setup block first) and
`is_returning_caller:"true"`. The agent answering this call can therefore verify the
caller (phone match + name) before rescheduling/cancelling.

```bash
# 3. Confirm the mock calendar connection is visible to the workspace
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT provider, active, \"primaryCalendarId\" FROM \"CalendarConnection\" WHERE id='cal_sim';"
```
**Expected:** one row `GOOGLE | t | primary`.

**Cleanup (after Step 22 — it is also done in Step 22's Cleanup block):**
```bash
docker exec vaani-db psql -U vaani -d vaani -c "DELETE FROM \"CalendarConnection\" WHERE id='cal_sim';"
```
**If it fails:** `ON CONFLICT` error → the unique key is `(workspaceId, provider)`;
re-copy the SQL exactly.

---

## Step 13: Lead extraction + CRM push (dry-run safe)

Post-call, one cheap LLM call extracts the caller's details into
`Call.extractedEntities`, upserts the `Contact`, and pushes to the connected CRM
behind a dry-run gate.

**File `src/lib/leadExtraction.ts`** (full content):

```ts
import type { Prisma } from "@prisma/client";

/** Flat lead fields extracted from the call. `name`/`email` are Contact columns;
 *  everything else (requirement, city, loan_id, …) lands in Contact.attributes. */
export type ExtractedEntities = Record<string, string | number | boolean>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize raw LLM JSON into safe entities, field by field (one bad field never
 *  nukes the rest). Non-object input → {}. Never throws. */
export function normalizeExtractedEntities(raw: unknown): ExtractedEntities {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: ExtractedEntities = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length === 0 || t.length > 200) continue;
      if (k === "email" && !EMAIL_RE.test(t)) continue;
      out[k] = t;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    // nested objects/arrays are dropped — flat entities only
  }
  return out;
}

/** Merge new entities into a Contact's existing attributes JSON (new keys win). */
export function mergeAttributes(existing: unknown, entities: ExtractedEntities): Prisma.InputJsonObject {
  const base: Prisma.InputJsonObject =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? (existing as Prisma.InputJsonObject)
      : {};
  const { name, email, ...rest } = entities; // name/email are Contact columns, not attributes
  return { ...base, ...rest };
}

/** Build the prisma upsert args for the lead-capture Contact write. */
export function buildContactUpsert(workspaceId: string, phone: string, entities: ExtractedEntities, existingAttributes: unknown) {
  const name = typeof entities.name === "string" ? entities.name : null;
  return {
    where: { workspaceId_phone: { workspaceId, phone } },
    create: {
      workspaceId,
      phone,
      name,
      attributes: mergeAttributes(null, entities),
    },
    update: {
      ...(name ? { name } : {}),
      attributes: mergeAttributes(existingAttributes, entities),
    },
  };
}
```

**File `src/lib/crmPush.ts`** (full content):

```ts
import { db } from "./db";
import type { ExtractedEntities } from "./leadExtraction";

/**
 * Push a captured lead to the workspace's connected CRM (spec §5 "Lead capture →
 * CRM", spec §9 CRM list). Dry-run by default (CRM_PUSH_DRY_RUN=true).
 * OPERATOR GATE: the real per-provider API mapping (HubSpot/Zoho/... field names)
 * is delivered with guide 05's CRM integration UI; this wrapper is the single call
 * site so only the provider-adapter internals change later.
 */
export async function pushLeadToCrm(input: {
  workspaceId: string;
  phone: string;
  entities: ExtractedEntities;
  callId: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  try {
    const conn = await db.crmConnection.findFirst({
      where: { workspaceId: input.workspaceId, active: true },
    });
    if (!conn) return { ok: true, skipped: true };
    if (process.env.CRM_PUSH_DRY_RUN !== "false") {
      console.log(
        `[crm] DRY RUN push to ${conn.provider} for ${input.phone}`,
        JSON.stringify(input.entities).slice(0, 200)
      );
      return { ok: true, skipped: true };
    }
    // Real push: provider adapter plugs in here (guide 05). Until then, fail safe.
    console.error(`[crm] real push requested but no provider adapter for ${conn.provider} yet`);
    return { ok: false, error: `CRM provider adapter for ${conn.provider} not installed (see guide 05)` };
  } catch (e) {
    console.error("pushLeadToCrm failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}
```

**File `tests/leadExtraction.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  buildContactUpsert,
  mergeAttributes,
  normalizeExtractedEntities,
} from "../src/lib/leadExtraction";

describe("normalizeExtractedEntities", () => {
  it("keeps known fields, trims strings", () => {
    const e = normalizeExtractedEntities({ name: "  Ramesh ", requirement: "root canal", city: "Pune" });
    expect(e).toEqual({ name: "Ramesh", requirement: "root canal", city: "Pune" });
  });
  it("preserves unknown flat keys (loan_id etc.)", () => {
    const e = normalizeExtractedEntities({ name: "A", loan_id: "LN123", score: 7 });
    expect(e.name).toBe("A");
    expect((e as Record<string, unknown>).loan_id).toBe("LN123");
    expect((e as Record<string, unknown>).score).toBe(7);
  });
  it("drops empty/oversized strings and nested objects", () => {
    const e = normalizeExtractedEntities({ name: "", big: "x".repeat(201), nested: { a: 1 }, ok: "yes" });
    expect(e).toEqual({ ok: "yes" });
  });
  it("garbage input → {}", () => {
    for (const raw of [null, undefined, "str", 42, [1, 2]]) {
      expect(normalizeExtractedEntities(raw)).toEqual({});
    }
  });
  it("invalid email is dropped", () => {
    const e = normalizeExtractedEntities({ email: "not-an-email" });
    expect(e.email).toBeUndefined();
  });
});

describe("mergeAttributes", () => {
  it("merges into existing attributes, new keys win", () => {
    const m = mergeAttributes({ city: "Mumbai", old: 1 }, { name: "R", requirement: "implant", city: "Pune" });
    expect(m).toEqual({ old: 1, city: "Pune", requirement: "implant" });
  });
  it("name/email never land in attributes", () => {
    const m = mergeAttributes(null, { name: "R", email: "r@x.com", requirement: "q" });
    expect(m).toEqual({ requirement: "q" });
  });
  it("garbage existing attributes → treated as empty", () => {
    expect(mergeAttributes("junk", { requirement: "q" })).toEqual({ requirement: "q" });
  });
});

describe("buildContactUpsert", () => {
  it("creates with name + attributes when entities present", () => {
    const u = buildContactUpsert("w1", "+919812345678", { name: "Ramesh", requirement: "checkup" }, null);
    expect(u.where).toEqual({ workspaceId_phone: { workspaceId: "w1", phone: "+919812345678" } });
    expect(u.create).toEqual({
      workspaceId: "w1",
      phone: "+919812345678",
      name: "Ramesh",
      attributes: { requirement: "checkup" },
    });
    expect(u.update).toEqual({ name: "Ramesh", attributes: { requirement: "checkup" } });
  });
  it("without a name, update does not overwrite the existing name", () => {
    const u = buildContactUpsert("w1", "+919812345678", { requirement: "checkup" }, { city: "Pune" });
    expect(u.create.name).toBeNull();
    expect("name" in u.update).toBe(false);
    expect(u.update.attributes).toEqual({ city: "Pune", requirement: "checkup" });
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/leadExtraction.test.ts && npm run typecheck
```
**Expected:** tests pass; typecheck exit 0.

---

## Step 14: Voicemail-to-text + routing

Voicemail capture happens two ways: (a) the workflow's message-taking branch ends the
call with outcome `message-taken` (post-call processor, Step 15, creates the
`VoicemailMessage` from the call transcript), and (b) a raw voicemail recording whose
audio we transcribe with Sarvam's batch STT.

**OPERATOR GATE (Sarvam batch STT):** transcription runs only when `SARVAM_API_KEY`
is set AND a directly-fetchable recording URL is available. Dograh's webhook already
carries `recording_url`/`transcript_url` (guide 04); when Dograh supplies the
transcript we store it directly and skip STT. Confirm the Sarvam model name
(`saarika:v2.5`) and quota in the Sarvam dashboard before relying on path (b).

**File `src/lib/voicemail.ts`** (full content):

```ts
import { db } from "./db";
import { notifyStaffMessage } from "./notify";
import { emitWebhookEvent } from "./webhooks";

/** Sarvam batch speech-to-text. Returns null on any failure (caller falls back). */
export async function transcribeVoicemail(recordingUrl: string): Promise<string | null> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return null;
  try {
    const audio = await fetch(recordingUrl);
    if (!audio.ok) return null;
    const form = new FormData();
    form.append("file", new Blob([await audio.arrayBuffer()]), "voicemail.wav");
    form.append("model", "saarika:v2.5");
    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { transcript?: string };
    return json.transcript?.trim() || null;
  } catch (e) {
    console.error("voicemail transcription failed", e);
    return null;
  }
}

/**
 * Create a VoicemailMessage, transcribe if needed, route to staff (email + WhatsApp),
 * and emit "voicemail.received" to webhook subscribers. Never throws.
 */
export async function recordVoicemailMessage(input: {
  workspaceId: string;
  callId?: string;
  phoneNumberId?: string;
  fromNumber: string;
  transcript?: string | null;
  recordingUrl?: string | null;
}): Promise<void> {
  try {
    let transcript = input.transcript ?? null;
    if (!transcript && input.recordingUrl) {
      transcript = await transcribeVoicemail(input.recordingUrl);
    }
    const vm = await db.voicemailMessage.create({
      data: {
        workspaceId: input.workspaceId,
        callId: input.callId ?? null,
        phoneNumberId: input.phoneNumberId ?? null,
        fromNumber: input.fromNumber,
        transcript,
        recordingKey: input.recordingUrl ? `pending:${input.recordingUrl}` : null,
      },
    });
    await notifyStaffMessage({
      fromNumber: input.fromNumber,
      summary: transcript ?? "(no transcript available — listen to the recording)",
      kind: "voicemail",
    });
    await emitWebhookEvent(input.workspaceId, "voicemail.received", {
      voicemailMessageId: vm.id,
      fromNumber: input.fromNumber,
      hasTranscript: transcript !== null,
    });
  } catch (e) {
    console.error("recordVoicemailMessage failed", e);
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 15: Post-call processor (outcome + entities + DNC + lead capture + voicemail + missed-call callback + webhook event)

This is the heart of after-call automation (spec §5). **Overwrite** the guide-06
original `src/lib/postcall.ts` with the full file below, then re-wire the webhook.

**File `src/lib/postcall.ts`** (full content):

```ts
import { db } from "./db";
import { normalizeExtractedEntities, buildContactUpsert } from "./leadExtraction";
import { pushLeadToCrm } from "./crmPush";
import { recordVoicemailMessage } from "./voicemail";
import { notifyStaffMessage } from "./notify";
import { emitWebhookEvent } from "./webhooks";
import { enqueueCallbackDial } from "./dialJobs";
import { parseHumanTransferConfig, decideTransfer } from "./fallbackPolicy";

const CHEAP_MODEL = "deepseek/deepseek-chat";
const MISSED_CALLBACK_DELAY_MIN = 15;

export type PostCallHints = {
  /** When the workflow already extracted an outcome (Dograh extraction_variables),
   *  pass it here to skip the LLM call (used by tests and by rich webhooks). */
  outcome?: string;
  messageTaken?: boolean;
  wantsHuman?: boolean;
  misunderstandingCount?: number;
};

type LlmResult = {
  outcome: string;
  sentiment: "positive" | "neutral" | "negative";
  dncRequested: boolean;
  entities: Record<string, unknown>;
  messageTaken: boolean;
  wantsHuman: boolean;
  misunderstandingCount: number;
};

const OUTCOMES = [
  "booked", "qualified", "not-interested", "message-taken",
  "payment-promised", "dispute", "dnc-requested", "other",
];

async function llmExtract(transcript: string): Promise<LlmResult> {
  const fallback: LlmResult = {
    outcome: "completed", sentiment: "neutral", dncRequested: false,
    entities: {}, messageTaken: false, wantsHuman: false, misunderstandingCount: 0,
  };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHEAP_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Analyze this phone call transcript. Reply with ONLY compact JSON: " +
              '{"outcome": one of "booked","qualified","not-interested","message-taken","payment-promised","dispute","dnc-requested","other",' +
              '"sentiment":"positive"|"neutral"|"negative",' +
              '"dncRequested":true if the caller asked to not be called again,' +
              '"entities":{"name":caller full name or null,"requirement":what they want or null,"city":city or null},' +
              '"messageTaken":true if the caller left a message for staff,' +
              '"wantsHuman":true if the caller asked to speak to a human,' +
              '"misunderstandingCount":number of times the AI clearly misunderstood the caller}',
          },
          { role: "user", content: transcript.slice(0, 4000) },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
    });
    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      outcome: OUTCOMES.includes(parsed.outcome) ? parsed.outcome : "other",
      sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
      dncRequested: parsed.dncRequested === true,
      entities: typeof parsed.entities === "object" && parsed.entities !== null ? parsed.entities : {},
      messageTaken: parsed.messageTaken === true,
      wantsHuman: parsed.wantsHuman === true,
      misunderstandingCount: Number.isInteger(parsed.misunderstandingCount) ? parsed.misunderstandingCount : 0,
    };
  } catch (e) {
    console.error("postcall LLM extraction failed, using defaults", e);
    return fallback;
  }
}

/** Missed call (spec §5): create a CallbackTask + enqueue the callback-dial job. */
export async function createMissedCallCallback(call: {
  id: string; workspaceId: string; fromNumber: string; toNumber: string;
}): Promise<void> {
  // Dedupe: one open missed-call task per caller per workspace.
  const existing = await db.callbackTask.findFirst({
    where: { workspaceId: call.workspaceId, phone: call.fromNumber, status: "PENDING", note: "MISSED_CALL" },
  });
  if (existing) return;
  const dueAt = new Date(Date.now() + MISSED_CALLBACK_DELAY_MIN * 60_000);
  const task = await db.callbackTask.create({
    data: {
      workspaceId: call.workspaceId,
      callId: call.id,
      phone: call.fromNumber,
      note: "MISSED_CALL",
      dueAt,
    },
  });
  await enqueueCallbackDial({
    workspaceId: call.workspaceId,
    callbackTaskId: task.id,
    phone: call.fromNumber,
    note: "MISSED_CALL",
    dueAt,
  });
  await emitWebhookEvent(call.workspaceId, "call.missed", {
    callId: call.id, fromNumber: call.fromNumber, toNumber: call.toNumber, callbackTaskId: task.id,
  });
}

/** After-call automation for one ended call. Fire-and-forget from the webhook. */
export async function processCompletedCall(callId: string, hints: PostCallHints = {}): Promise<void> {
  const call = await db.call.findUnique({
    where: { id: callId },
    include: { agent: { include: { toolConfigs: true } } },
  });
  if (!call) return;

  // --- Missed-call path: inbound call that never got answered -----------------
  if (
    call.direction === "INBOUND" &&
    (call.status === "NO_ANSWER" || call.status === "BUSY" || call.status === "FAILED")
  ) {
    await createMissedCallCallback(call);
    return;
  }

  if (!call.transcript) {
    await emitWebhookEvent(call.workspaceId, "call.completed", {
      callId: call.id, fromNumber: call.fromNumber, toNumber: call.toNumber,
      durationSec: call.durationSec, outcome: call.outcome ?? "completed",
    });
    return;
  }

  // --- Extraction (LLM, or hints when the workflow already extracted) ---------
  const llm = hints.outcome
    ? {
        outcome: OUTCOMES.includes(hints.outcome) ? hints.outcome : "other",
        sentiment: "neutral" as const,
        dncRequested: hints.outcome === "dnc-requested",
        entities: {},
        messageTaken: hints.messageTaken === true,
        wantsHuman: hints.wantsHuman === true,
        misunderstandingCount: hints.misunderstandingCount ?? 0,
      }
    : await llmExtract(call.transcript);

  const entities = normalizeExtractedEntities(llm.entities);
  const outcome = llm.messageTaken ? "message-taken" : llm.outcome;

  await db.call.update({
    where: { id: call.id },
    data: {
      outcome,
      sentiment: llm.sentiment,
      ...(Object.keys(entities).length > 0 ? { extractedEntities: entities } : {}),
    },
  });

  // --- DNC honored instantly (spec §11) ---------------------------------------
  if (llm.dncRequested) {
    await db.contact.updateMany({
      where: { workspaceId: call.workspaceId, phone: call.fromNumber },
      data: { dnc: true, optOutAt: new Date() },
    });
    await db.dncEntry.upsert({
      where: { workspaceId_phone: { workspaceId: call.workspaceId, phone: call.fromNumber } },
      create: { workspaceId: call.workspaceId, phone: call.fromNumber, source: "OPT_OUT", reason: "caller-request" },
      update: {},
    });
    await db.callEvent.create({
      data: { callId: call.id, type: "dnc", payload: { phone: call.fromNumber, source: "caller-request" } },
    });
  }

  // --- Lead capture → Contact upsert → CRM (spec §5) ---------------------------
  if (Object.keys(entities).length > 0) {
    const existing = await db.contact.findUnique({
      where: { workspaceId_phone: { workspaceId: call.workspaceId, phone: call.fromNumber } },
      select: { attributes: true },
    });
    const upsert = buildContactUpsert(call.workspaceId, call.fromNumber, entities, existing?.attributes);
    await db.contact.upsert(upsert);
    await pushLeadToCrm({ workspaceId: call.workspaceId, phone: call.fromNumber, entities, callId: call.id });
  }

  // --- Message taking + staff notification (spec §5) ---------------------------
  if (outcome === "message-taken") {
    const phoneNumber = await db.phoneNumber.findFirst({
      where: { workspaceId: call.workspaceId, number: call.toNumber },
      select: { id: true },
    });
    await recordVoicemailMessage({
      workspaceId: call.workspaceId,
      callId: call.id,
      phoneNumberId: phoneNumber?.id,
      fromNumber: call.fromNumber,
      transcript: call.transcript.slice(-1000),
    });
    await notifyStaffMessage({
      fromNumber: call.fromNumber,
      summary: call.summary ?? call.transcript.slice(-500),
      kind: "message",
    });
  }

  // --- Fallback policy: escalate to a human queue (spec §7) --------------------
  const transferConfig = parseHumanTransferConfig(
    call.agent?.toolConfigs.find((t) => t.tool === "HUMAN_TRANSFER")?.config
  );
  const decision = decideTransfer(transferConfig, {
    callerPhone: call.fromNumber,
    explicitHumanRequest: llm.wantsHuman,
    misunderstandingCount: llm.misunderstandingCount,
  });
  if (decision.transfer) {
    const open = await db.transferRequest.findFirst({
      where: { workspaceId: call.workspaceId, callId: call.id, status: { in: ["QUEUED", "RINGING"] } },
    });
    if (!open) {
      await db.transferRequest.create({
        data: {
          workspaceId: call.workspaceId,
          callId: call.id,
          queue: decision.queue,
          skill: decision.skill ?? null,
          reason: decision.reason,
          contextSnapshot: {
            summary: call.summary,
            transcriptTail: call.transcript.slice(-1500),
            fromNumber: call.fromNumber,
          },
        },
      });
      await emitWebhookEvent(call.workspaceId, "transfer.requested", {
        callId: call.id, queue: decision.queue, reason: decision.reason,
      });
    }
  }

  // --- After-call webhook fan-out (spec §5: pushed to CRM/webhook in seconds) --
  await emitWebhookEvent(call.workspaceId, "call.completed", {
    callId: call.id,
    fromNumber: call.fromNumber,
    toNumber: call.toNumber,
    durationSec: call.durationSec,
    outcome,
    sentiment: llm.sentiment,
    summary: call.summary,
    extractedEntities: entities,
  });
}
```

**Re-wire the webhook.** Edit `src/app/api/webhooks/dograh/route.ts`: find the
`if (ended) {` block (guide 04) and make sure it contains, after the call update:

```ts
  if (ended) {
    // Fire-and-forget post-call processing (outcome, entities, DNC, lead capture,
    // voicemail, missed-call callback, fallback transfer, webhook fan-out).
    processCompletedCall(call.id).catch((e) => console.error("postcall failed", e));
  }
```

And the import at the top:
```ts
import { processCompletedCall } from "@/lib/postcall";
```

(If guide 06 was previously executed, this wiring already exists — verify with grep,
do not add it twice.)

**Verify:**
```bash
grep -c "processCompletedCall" src/app/api/webhooks/dograh/route.ts
npm run typecheck
```
**Expected:** `2` (import + call); typecheck exit 0. **If the `if (ended)` block is
not found:** locate the block that runs when a `call.ended` event is processed
(`grep -n "ended" src/app/api/webhooks/dograh/route.ts`), add the same two lines
right after the Call row is updated to a terminal status, and report the deviation.

---

## Step 16: Transfer-request API route (Dograh Call Transfer tool target)

Dograh's **Call Transfer** tool can resolve the transfer destination **dynamically
during the call** via an HTTP call (documented Dograh capability). This route is the
target: it applies the fallback policy, creates the `TransferRequest` with a context
snapshot, and returns the destination number for the requested queue.

**File `src/app/api/v1/transfer-request/route.ts`** (full content):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseHumanTransferConfig, decideTransfer } from "@/lib/fallbackPolicy";
import { emitWebhookEvent } from "@/lib/webhooks";

const bodySchema = z.object({
  call_id: z.string().min(1), // Dograh call id (= Call.dograhCallId)
  reason: z.string().max(200).optional(),
  queue: z.string().max(60).optional(),
  skill: z.string().max(60).optional(),
  explicit: z.boolean().default(true), // the AI only calls this on transfer intent
});

/**
 * POST /api/v1/transfer-request — called by Dograh's Call Transfer tool (dynamic
 * destination) mid-call. Secured with the shared internal secret.
 * Response: { ok, transferRequestId, queue, destination } — destination is the
 * E.164 number Dograh should transfer the leg to, or null when no human number is
 * configured for the queue (the AI then takes a message instead).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.DOGRAH_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const body = parsed.data;

  const call = await db.call.findUnique({
    where: { dograhCallId: body.call_id },
    include: { agent: { include: { toolConfigs: true } } },
  });
  if (!call) return NextResponse.json({ ok: false, error: "unknown call_id" }, { status: 404 });

  const config = parseHumanTransferConfig(
    call.agent?.toolConfigs.find((t) => t.tool === "HUMAN_TRANSFER")?.config
  );
  const decision = decideTransfer(config, {
    callerPhone: call.fromNumber,
    explicitHumanRequest: body.explicit,
  });
  const queue = body.queue ?? decision.queue;
  const skill = body.skill ?? decision.skill ?? null;

  // Idempotent: reuse an already-open request for this call.
  const open = await db.transferRequest.findFirst({
    where: { workspaceId: call.workspaceId, callId: call.id, status: { in: ["QUEUED", "RINGING"] } },
  });
  const tr =
    open ??
    (await db.transferRequest.create({
      data: {
        workspaceId: call.workspaceId,
        callId: call.id,
        queue,
        skill,
        reason: body.reason ?? decision.reason ?? "explicit-request",
        contextSnapshot: {
          summary: call.summary,
          transcriptTail: (call.transcript ?? "").slice(-1500),
          fromNumber: call.fromNumber,
        },
      },
    }));

  await emitWebhookEvent(call.workspaceId, "transfer.requested", {
    callId: call.id, transferRequestId: tr.id, queue: tr.queue, reason: tr.reason,
  });

  const destination = config.queueDestinations[tr.queue ?? ""] ?? null;
  return NextResponse.json({
    ok: true,
    transferRequestId: tr.id,
    queue: tr.queue,
    skill: tr.skill,
    destination,
    note: destination
      ? "Transfer the call leg to this number."
      : "No human destination configured for this queue — take a message instead.",
  });
}
```

**Dograh wiring (operator, OPERATOR GATE):** in the workflow's Call Transfer tool,
choose *dynamic destination* and point it at
`POST https://<app-domain>/api/v1/transfer-request` with header
`x-internal-secret: <DOGRAH_WEBHOOK_SECRET>` and body
`{"call_id": "{{call_id}}", "reason": "caller requested human"}`. Map the response
field `destination` as the transfer target; when `destination` is null, route the
workflow to the message-taking branch instead. The exact UI labels vary by Dograh
version — verify against the Dograh docs page "Call Transfer". Until wired, the route
is fully verified by the Step 21 scripted test.

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 17: Live-state machine + supervisor server actions (Listen / Whisper / Barge / Takeover)

`LiveCallState` (schema from guide 02) is the source of truth for supervisor mode on
an active call. A small pure state machine guards transitions; server actions mutate
it. **OPERATOR GATE (Dograh-side):** Dograh has no documented mid-call context-
injection or audio-splice API (`dograh_api_docs.txt` — checked). Therefore: whisper
text and listen/barge modes are **recorded and displayed** (the human who takes over
sees the whisper context; the transfer-request context snapshot includes it), and any
Dograh-side whisper/audio injection is gated on Dograh support. Barge/takeover
additionally creates a `TransferRequest` so the human handoff path is real.

**File `src/lib/liveState.ts`** (full content):

```ts
export const LIVE_MODES = ["NONE", "LISTEN", "WHISPER", "BARGE", "TAKEOVER"] as const;
export type LiveModeName = (typeof LIVE_MODES)[number];

/** Allowed supervisor-mode transitions. Same→same is always allowed (idempotent). */
const ALLOWED: Record<LiveModeName, readonly LiveModeName[]> = {
  NONE: ["LISTEN", "WHISPER", "BARGE", "TAKEOVER"],
  LISTEN: ["NONE", "WHISPER", "BARGE", "TAKEOVER"],
  WHISPER: ["NONE", "BARGE", "TAKEOVER"],
  BARGE: ["NONE", "TAKEOVER"],
  TAKEOVER: ["NONE"], // release only
};

export function canTransitionLiveMode(from: LiveModeName, to: LiveModeName): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export const WHISPER_MAX_LEN = 500;

export function validateWhisperText(
  text: unknown
): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof text !== "string") return { ok: false, error: "Whisper text is required." };
  const t = text.trim();
  if (t.length === 0) return { ok: false, error: "Whisper text cannot be empty." };
  if (t.length > WHISPER_MAX_LEN) return { ok: false, error: `Keep it under ${WHISPER_MAX_LEN} characters.` };
  return { ok: true, text: t };
}
```

**File `tests/liveState.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { canTransitionLiveMode, validateWhisperText, WHISPER_MAX_LEN } from "../src/lib/liveState";

describe("canTransitionLiveMode", () => {
  it("NONE can go anywhere", () => {
    for (const to of ["LISTEN", "WHISPER", "BARGE", "TAKEOVER"] as const) {
      expect(canTransitionLiveMode("NONE", to)).toBe(true);
    }
  });
  it("WHISPER can escalate to BARGE/TAKEOVER or release", () => {
    expect(canTransitionLiveMode("WHISPER", "BARGE")).toBe(true);
    expect(canTransitionLiveMode("WHISPER", "TAKEOVER")).toBe(true);
    expect(canTransitionLiveMode("WHISPER", "NONE")).toBe(true);
  });
  it("WHISPER cannot go back to LISTEN", () => {
    expect(canTransitionLiveMode("WHISPER", "LISTEN")).toBe(false);
  });
  it("BARGE can only escalate to TAKEOVER or release", () => {
    expect(canTransitionLiveMode("BARGE", "TAKEOVER")).toBe(true);
    expect(canTransitionLiveMode("BARGE", "NONE")).toBe(true);
    expect(canTransitionLiveMode("BARGE", "WHISPER")).toBe(false);
    expect(canTransitionLiveMode("BARGE", "LISTEN")).toBe(false);
  });
  it("TAKEOVER can only release", () => {
    expect(canTransitionLiveMode("TAKEOVER", "NONE")).toBe(true);
    expect(canTransitionLiveMode("TAKEOVER", "LISTEN")).toBe(false);
  });
  it("same→same is idempotent", () => {
    expect(canTransitionLiveMode("LISTEN", "LISTEN")).toBe(true);
  });
});

describe("validateWhisperText", () => {
  it("accepts normal coaching text", () => {
    const r = validateWhisperText("Offer the 10% festival discount.");
    expect(r).toEqual({ ok: true, text: "Offer the 10% festival discount." });
  });
  it("trims whitespace", () => {
    const r = validateWhisperText("  hello  ");
    expect(r.ok && r.text).toBe("hello");
  });
  it("rejects empty/blank", () => {
    expect(validateWhisperText("   ").ok).toBe(false);
    expect(validateWhisperText("").ok).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(validateWhisperText(undefined).ok).toBe(false);
    expect(validateWhisperText(42).ok).toBe(false);
  });
  it(`rejects text over ${WHISPER_MAX_LEN} chars`, () => {
    expect(validateWhisperText("x".repeat(WHISPER_MAX_LEN + 1)).ok).toBe(false);
    expect(validateWhisperText("x".repeat(WHISPER_MAX_LEN)).ok).toBe(true);
  });
});
```

**File `src/server/actions/live.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { LiveMode } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import type { PermissionKey } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { canTransitionLiveMode, validateWhisperText, LIVE_MODES, type LiveModeName } from "@/lib/liveState";

export type ActionResult = { ok: boolean; error?: string };

const modeSchema = z.enum(LIVE_MODES);

/** RBAC: each supervisor mode is gated on its own permission key (guide 03). */
function permissionForMode(mode: LiveModeName): PermissionKey {
  if (mode === "WHISPER") return "live:whisper";
  if (mode === "BARGE" || mode === "TAKEOVER") return "live:barge";
  return "live:listen"; // NONE (release) and LISTEN need the base live key
}

async function loadActiveCall(callId: string, workspaceId: string) {
  const call = await db.call.findFirst({
    where: { id: callId, workspaceId },
    include: { liveState: true },
  });
  if (!call) return { error: "Call not found." as const };
  if (call.status !== "IN_PROGRESS" && call.status !== "RINGING") {
    return { error: "Call is not active anymore." as const };
  }
  return { call };
}

/** Set supervisor mode (LISTEN / WHISPER / BARGE / TAKEOVER / NONE). */
export async function setLiveModeAction(callId: string, mode: string): Promise<ActionResult> {
  try {
    const m = modeSchema.parse(mode) as LiveModeName;
    const ctx = await requirePermission(permissionForMode(m));
    const loaded = await loadActiveCall(callId, ctx.workspaceId);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    const { call } = loaded;

    const current = (call.liveState?.mode ?? "NONE") as LiveModeName;
    if (!canTransitionLiveMode(current, m)) {
      return { ok: false, error: `Cannot switch from ${current} to ${m}. Release first or escalate.` };
    }

    await db.liveCallState.upsert({
      where: { callId: call.id },
      create: {
        workspaceId: ctx.workspaceId, callId: call.id, status: call.status,
        mode: m as LiveMode, supervisorUserId: m === "NONE" ? null : ctx.user.id,
      },
      update: {
        mode: m as LiveMode,
        supervisorUserId: m === "NONE" ? null : ctx.user.id,
        ...(m === "NONE" ? { whisperContext: null } : {}),
      },
    });

    // Barge/takeover = human handoff: guarantee a TransferRequest exists so the
    // queue page shows it. OPERATOR GATE: instructing Dograh to splice the human
    // leg mid-call depends on Dograh support; until then the human joins via the
    // queue flow (accept → call the caller back / join per SOP).
    if (m === "BARGE" || m === "TAKEOVER") {
      const open = await db.transferRequest.findFirst({
        where: { workspaceId: ctx.workspaceId, callId: call.id, status: { in: ["QUEUED", "RINGING"] } },
      });
      if (!open) {
        await db.transferRequest.create({
          data: {
            workspaceId: ctx.workspaceId,
            callId: call.id,
            queue: "supervisor",
            reason: `supervisor-${m.toLowerCase()}`,
            status: m === "TAKEOVER" ? "ACCEPTED" : "QUEUED",
            acceptedByUserId: m === "TAKEOVER" ? ctx.user.id : null,
            acceptedAt: m === "TAKEOVER" ? new Date() : null,
            contextSnapshot: {
              summary: call.summary,
              transcriptTail: (call.transcript ?? "").slice(-1500),
              fromNumber: call.fromNumber,
              whisperContext: call.liveState?.whisperContext ?? null,
            },
          },
        });
      }
    }

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: `live.mode.${m.toLowerCase()}`, entity: "Call", entityId: call.id,
    });
    revalidatePath("/live");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Save whisper coaching text (also flips the call into WHISPER mode). */
export async function setWhisperAction(callId: string, text: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:whisper");
    const v = validateWhisperText(text);
    if (!v.ok) return { ok: false, error: v.error };
    const loaded = await loadActiveCall(callId, ctx.workspaceId);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    const { call } = loaded;

    const current = (call.liveState?.mode ?? "NONE") as LiveModeName;
    if (!canTransitionLiveMode(current, "WHISPER")) {
      return { ok: false, error: `Cannot whisper while in ${current} mode.` };
    }

    await db.liveCallState.upsert({
      where: { callId: call.id },
      create: {
        workspaceId: ctx.workspaceId, callId: call.id, status: call.status,
        mode: "WHISPER", supervisorUserId: ctx.user.id, whisperContext: v.text,
      },
      update: { mode: "WHISPER", supervisorUserId: ctx.user.id, whisperContext: v.text },
    });
    // OPERATOR GATE: no documented Dograh mid-call context-injection API. The text
    // is stored on LiveCallState.whisperContext and shown to the human on takeover.
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "live.whisper", entity: "Call", entityId: call.id,
      metadata: { length: v.text.length },
    });
    revalidatePath("/live");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Release supervisor control back to NONE. */
export async function releaseLiveAction(callId: string): Promise<ActionResult> {
  return setLiveModeAction(callId, "NONE");
}
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/liveState.test.ts && npm run typecheck
```
**Expected:** tests pass; typecheck exit 0.

---

## Step 18: Live call dashboard (`/live`) — polling, transcript viewer, supervisor controls

Polling every 5 seconds via a tiny JSON route (no websockets — deliberately simple).

**File `src/app/api/v1/live/calls/route.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

/** GET /api/v1/live/calls — active calls + live state + transcript tail for /live.
 *  Gated on the live:listen permission (guide 03). */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("live:listen");
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const calls = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, status: { in: ["RINGING", "IN_PROGRESS"] } },
    include: {
      liveState: true,
      agent: { select: { name: true } },
      transcriptEntries: { orderBy: { timestampMs: "asc" }, take: 50 },
    },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    ok: true,
    calls: calls.map((c) => ({
      id: c.id,
      fromNumber: c.fromNumber,
      toNumber: c.toNumber,
      status: c.status,
      direction: c.direction,
      agentName: c.agent?.name ?? "—",
      startedAt: c.startedAt.toISOString(),
      mode: c.liveState?.mode ?? "NONE",
      whisperContext: c.liveState?.whisperContext ?? null,
      transcript: c.transcriptEntries.map((t) => ({ speaker: t.speaker, text: t.text })),
    })),
  });
}
```

**File `src/app/(app)/live/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { LiveDashboard } from "@/components/live-dashboard";

export default async function LivePage() {
  try {
    await requireRole("AGENT");
  } catch {
    redirect("/login");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Live Calls</h1>
        <p className="text-sm text-muted-foreground">
          Active calls refresh every 5 seconds. Supervisor modes (listen / whisper /
          barge / takeover) are recorded and surfaced to the human on handoff.
        </p>
      </div>
      <LiveDashboard />
    </div>
  );
}
```

**File `src/components/live-dashboard.tsx`** (full content):

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setLiveModeAction,
  setWhisperAction,
  releaseLiveAction,
} from "@/server/actions/live";

type LiveCall = {
  id: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  direction: string;
  agentName: string;
  startedAt: string;
  mode: string;
  whisperContext: string | null;
  transcript: { speaker: string; text: string }[];
};

const POLL_MS = 5000;

export function LiveDashboard() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [whisperDrafts, setWhisperDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/live/calls", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setCalls(json.calls);
      else setError(json.error ?? "failed to load");
    } catch {
      setError("network error");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  async function act(callId: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    const r = await fn();
    if (!r.ok) setError(r.error ?? "action failed");
    else setError(null);
    await refresh();
  }

  return (
    <div className="space-y-4" data-testid="live-dashboard">
      {error && <p className="text-sm text-red-500" data-testid="live-error">{error}</p>}
      {calls.length === 0 && (
        <p className="text-muted-foreground" data-testid="live-empty">
          No active calls right now.
        </p>
      )}
      {calls.map((c) => (
        <Card key={c.id} data-testid="live-call-row">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono font-semibold">{c.fromNumber}</span>
              <span className="text-sm text-muted-foreground">→ {c.toNumber}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{c.status}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">mode: {c.mode}</span>
              <span className="text-xs text-muted-foreground">{c.agentName}</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" data-testid="live-listen-btn"
                  onClick={() => act(c.id, () => setLiveModeAction(c.id, "LISTEN"))}>
                  Listen
                </Button>
                <Button size="sm" variant="outline" data-testid="live-barge-btn"
                  onClick={() => act(c.id, () => setLiveModeAction(c.id, "BARGE"))}>
                  Barge
                </Button>
                <Button size="sm" variant="outline" data-testid="live-takeover-btn"
                  onClick={() => act(c.id, () => setLiveModeAction(c.id, "TAKEOVER"))}>
                  Take over
                </Button>
                <Button size="sm" variant="ghost" data-testid="live-release-btn"
                  onClick={() => act(c.id, () => releaseLiveAction(c.id))}>
                  Release
                </Button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto rounded border border-border bg-card p-3"
              data-testid="live-transcript-viewer">
              {c.transcript.length === 0 && (
                <p className="text-xs text-muted-foreground">Waiting for transcript…</p>
              )}
              {c.transcript.map((t, i) => (
                <p key={i} className="text-sm">
                  <span className="font-semibold">{t.speaker === "AGENT" ? "AI" : t.speaker}:</span> {t.text}
                </p>
              ))}
            </div>

            {c.whisperContext && (
              <p className="text-xs text-amber-500" data-testid="live-whisper-active">
                Whisper active: {c.whisperContext}
              </p>
            )}

            <div className="flex gap-2">
              <Input
                placeholder="Whisper coaching text (shown to human on takeover)"
                value={whisperDrafts[c.id] ?? ""}
                onChange={(e) => setWhisperDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                data-testid="live-whisper-input"
              />
              <Button size="sm" data-testid="live-whisper-send"
                onClick={() =>
                  act(c.id, () => setWhisperAction(c.id, whisperDrafts[c.id] ?? ""))
                }>
                Whisper
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; routes `/live` and `/api/v1/live/calls` in build output.
**If it fails** with auth import errors: `requireRole`/`requirePermission` live in
`src/lib/auth.ts` and `PermissionKey` in `src/lib/permissions.ts` (guide 03) —
confirm with `grep -n "export async function requirePermission" src/lib/auth.ts`.

---

## Step 19: Human transfer queue (`/transfers`) — skills routing, context handoff, availability

Conventions (contract #3): skills are `skill:<name>` strings in
`Membership.grantedPermissions`; availability is `availability:online` in the same
array. A transfer tagged with a skill is visible to members holding that skill;
members with **no** skill tags see everything (default-queue behavior). The context
snapshot (summary + transcript tail) is always shown **before** accept.

**File `src/lib/transfers.ts`** (full content):

```ts
import { db } from "./db";

export const SKILL_PREFIX = "skill:";
export const AVAILABLE_KEY = "availability:online";

/** "skill:sales" → "sales". Everything else is ignored. */
export function userSkills(grantedPermissions: string[]): string[] {
  return grantedPermissions
    .filter((p) => p.startsWith(SKILL_PREFIX) && p.length > SKILL_PREFIX.length)
    .map((p) => p.slice(SKILL_PREFIX.length));
}

export function isAvailable(grantedPermissions: string[]): boolean {
  return grantedPermissions.includes(AVAILABLE_KEY);
}

/** Visibility rule: untagged transfers are visible to all; tagged transfers are
 *  visible to members with the skill OR to members with no skills (fallback pool). */
export function canSeeTransfer(
  tr: { skill: string | null },
  skills: string[]
): boolean {
  if (!tr.skill) return true;
  return skills.length === 0 || skills.includes(tr.skill);
}

/** Atomic accept: only one agent can win a QUEUED/RINGING request. */
export async function acceptTransfer(
  workspaceId: string,
  userId: string,
  transferRequestId: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await db.transferRequest.updateMany({
    where: { id: transferRequestId, workspaceId, status: { in: ["QUEUED", "RINGING"] } },
    data: { status: "ACCEPTED", acceptedByUserId: userId, acceptedAt: new Date() },
  });
  return r.count === 1 ? { ok: true } : { ok: false, error: "Already handled." };
}

export async function declineTransfer(
  workspaceId: string,
  userId: string,
  transferRequestId: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await db.transferRequest.updateMany({
    where: { id: transferRequestId, workspaceId, status: { in: ["QUEUED", "RINGING"] } },
    data: { status: "CANCELLED" },
  });
  return r.count === 1 ? { ok: true } : { ok: false, error: "Already handled." };
}
```

**File `src/server/actions/transfers.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { acceptTransfer, declineTransfer, isAvailable, AVAILABLE_KEY } from "@/lib/transfers";

export type ActionResult = { ok: boolean; error?: string };

export async function acceptTransferAction(transferRequestId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:barge");
    const r = await acceptTransfer(ctx.workspaceId, ctx.user.id, transferRequestId);
    if (!r.ok) return { ok: false, error: r.error };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "transfer.accept", entity: "TransferRequest", entityId: transferRequestId,
    });
    revalidatePath("/transfers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function declineTransferAction(transferRequestId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:barge");
    const r = await declineTransfer(ctx.workspaceId, ctx.user.id, transferRequestId);
    if (!r.ok) return { ok: false, error: r.error };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "transfer.decline", entity: "TransferRequest", entityId: transferRequestId,
    });
    revalidatePath("/transfers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Flip the availability:online tag on the current membership. */
export async function toggleAvailabilityAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:listen");
    const current = ctx.membership.grantedPermissions;
    const next = isAvailable(current)
      ? current.filter((p) => p !== AVAILABLE_KEY)
      : [...current, AVAILABLE_KEY];
    await db.membership.update({
      where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: ctx.workspaceId } },
      data: { grantedPermissions: next },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: isAvailable(current) ? "agent.unavailable" : "agent.available",
      entity: "Membership", entityId: ctx.membership.id,
    });
    revalidatePath("/transfers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
```

**File `src/app/(app)/transfers/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  acceptTransferAction, declineTransferAction, toggleAvailabilityAction,
} from "@/server/actions/transfers";
import { canSeeTransfer, isAvailable, userSkills } from "@/lib/transfers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Snapshot = { summary?: string; transcriptTail?: string; fromNumber?: string; whisperContext?: string };

export default async function TransfersPage() {
  let ctx;
  try {
    ctx = await requireRole("AGENT");
  } catch {
    redirect("/login");
  }
  const skills = userSkills(ctx.membership.grantedPermissions);
  const available = isAvailable(ctx.membership.grantedPermissions);

  const [pending, mine] = await Promise.all([
    db.transferRequest.findMany({
      where: { workspaceId: ctx.workspaceId, status: { in: ["QUEUED", "RINGING"] } },
      include: { call: { select: { fromNumber: true, toNumber: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    db.transferRequest.findMany({
      where: { workspaceId: ctx.workspaceId, acceptedByUserId: ctx.user.id, status: "ACCEPTED" },
      orderBy: { acceptedAt: "desc" },
      take: 10,
    }),
  ]);
  const visible = pending.filter((t) => canSeeTransfer(t, skills));

  async function accept(formData: FormData) {
    "use server";
    await acceptTransferAction(String(formData.get("id")));
  }
  async function decline(formData: FormData) {
    "use server";
    await declineTransferAction(String(formData.get("id")));
  }
  async function toggle() {
    "use server";
    await toggleAvailabilityAction();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transfer Queue</h1>
          <p className="text-sm text-muted-foreground">
            Your skills: {skills.length > 0 ? skills.join(", ") : "all queues (no skill tags)"}
          </p>
        </div>
        <form action={toggle}>
          <Button type="submit" variant={available ? "default" : "outline"} data-testid="availability-toggle">
            {available ? "Available" : "Unavailable"}
          </Button>
        </form>
      </div>

      {visible.length === 0 && (
        <p className="text-muted-foreground" data-testid="transfer-empty">No pending transfers.</p>
      )}
      {visible.map((t) => {
        const snap = (t.contextSnapshot ?? {}) as Snapshot;
        return (
          <Card key={t.id} data-testid="transfer-queue-row">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{t.call.fromNumber}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs">queue: {t.queue ?? "—"}</span>
                {t.skill && <span className="rounded bg-muted px-2 py-0.5 text-xs">skill: {t.skill}</span>}
                {t.reason && <span className="rounded bg-muted px-2 py-0.5 text-xs">reason: {t.reason}</span>}
                <span className="text-xs text-muted-foreground">{t.createdAt.toLocaleString()}</span>
              </div>

              <div className="rounded border border-border bg-card p-3" data-testid="transfer-context">
                <p className="text-sm font-semibold">Context (read before accepting)</p>
                <p className="text-sm">{snap.summary ?? "No summary yet."}</p>
                {snap.whisperContext && (
                  <p className="text-xs text-amber-500">Supervisor whisper: {snap.whisperContext}</p>
                )}
                {snap.transcriptTail && (
                  <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {snap.transcriptTail}
                  </pre>
                )}
              </div>

              <div className="flex gap-2">
                <form action={accept}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" size="sm" data-testid="transfer-accept-btn">Accept</Button>
                </form>
                <form action={decline}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" size="sm" variant="outline" data-testid="transfer-decline-btn">
                    Decline
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {mine.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Accepted by you</h2>
          {mine.map((t) => (
            <p key={t.id} className="text-sm text-muted-foreground" data-testid="transfer-accepted-row">
              #{t.id.slice(-6)} · queue {t.queue ?? "—"} · accepted {t.acceptedAt?.toLocaleString()}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/transfers` in build output.

---

## Step 20: Web dialer (`/dialer`) — click-to-call from workspace numbers

v1 dial flow: the dial pad creates an OUTBOUND `Call` row (RINGING) and enqueues a
`manual-dial` job (Step 9 contract). Guide 07's worker picks it up and triggers the
call via Dograh — the human talks on their own phone/softphone when the leg arrives.
**OPERATOR GATE (in-browser WebRTC softphone):** browser audio depends on
Dograh/Vobiz web-call support ("Web Calls" exist in Dograh for agent testing);
wiring a tenant softphone to it is gated on that capability. The dialer UI, DNC
guard, job contract, and call history below are fully built and tested regardless.

**File `src/server/actions/dialer.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { enqueueManualDial } from "@/lib/dialJobs";

export type ActionResult = { ok: boolean; error?: string; callId?: string };

const dialSchema = z.object({
  toNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +919812345678"),
  fromPhoneNumberId: z.string().min(1),
});

export async function startManualCallAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("calls:read");
    const parsed = dialSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid number." };
    }
    const { toNumber, fromPhoneNumberId } = parsed.data;

    const from = await db.phoneNumber.findFirst({
      where: { id: fromPhoneNumberId, workspaceId: ctx.workspaceId },
    });
    if (!from) return { ok: false, error: "From-number not found in your workspace." };

    // DNC guard: never dial a number on the workspace DNC list.
    const dnc = await db.dncEntry.findUnique({
      where: { workspaceId_phone: { workspaceId: ctx.workspaceId, phone: toNumber } },
    });
    if (dnc) return { ok: false, error: "This number is on your DNC list — cannot dial." };

    const call = await db.call.create({
      data: {
        workspaceId: ctx.workspaceId,
        direction: "OUTBOUND",
        status: "RINGING",
        fromNumber: from.number,
        toNumber,
        extractedEntities: { source: "manual-dial", initiatedBy: ctx.user.id },
      },
    });
    await enqueueManualDial({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      callId: call.id,
      fromNumber: from.number,
      toNumber,
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "dialer.manual_call", entity: "Call", entityId: call.id,
      metadata: { toNumber, fromNumber: from.number },
    });
    revalidatePath("/dialer");
    return { ok: true, callId: call.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
```

**File `src/components/dial-pad.tsx`** (full content):

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startManualCallAction } from "@/server/actions/dialer";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "#"];

export function DialPad({ numbers }: { numbers: { id: string; number: string; label: string | null }[] }) {
  const [toNumber, setToNumber] = useState("");
  const [fromId, setFromId] = useState(numbers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call() {
    setBusy(true);
    setMessage(null);
    const r = await startManualCallAction({ toNumber, fromPhoneNumberId: fromId });
    setMessage(r.ok ? `Call initiated (${r.callId?.slice(-6)}) — the worker is dialing.` : r.error ?? "Failed.");
    setBusy(false);
  }

  return (
    <div className="space-y-4" data-testid="dialer-pad">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground">From:</label>
        <select value={fromId} onChange={(e) => setFromId(e.target.value)} data-testid="dialer-from-select"
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>{n.number}{n.label ? ` (${n.label})` : ""}</option>
          ))}
        </select>
      </div>
      <Input value={toNumber} onChange={(e) => setToNumber(e.target.value)}
        placeholder="+919812345678" className="w-64 font-mono" data-testid="dialer-number-input" />
      <div className="grid w-64 grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <Button key={k} variant="outline" data-testid={`dialer-digit-${k === "+" ? "plus" : k === "#" ? "hash" : k}`}
            onClick={() => setToNumber((v) => (v + k).slice(0, 16))}>
            {k}
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" data-testid="dialer-backspace-btn"
          onClick={() => setToNumber((v) => v.slice(0, -1))}>
          ⌫
        </Button>
        <Button onClick={call} disabled={busy || !fromId} data-testid="dialer-call-btn">
          {busy ? "Dialing…" : "Call"}
        </Button>
      </div>
      {message && <p className="text-sm" data-testid="dialer-message">{message}</p>}
      <p className="text-xs text-muted-foreground">
        In-browser audio (softphone) is operator-gated on Dograh web-call support;
        v1 dials out via the campaign worker and the call events appear in Calls.
      </p>
    </div>
  );
}
```

**File `src/app/(app)/dialer/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { DialPad } from "@/components/dial-pad";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DialerPage() {
  let ctx;
  try {
    ctx = await requireRole("AGENT");
  } catch {
    redirect("/login");
  }
  const [numbers, history] = await Promise.all([
    db.phoneNumber.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, number: true, label: true },
      orderBy: { createdAt: "asc" },
    }),
    db.call.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        direction: "OUTBOUND",
        extractedEntities: { path: ["source"], equals: "manual-dial" },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Web Dialer</h1>
      <Card>
        <CardHeader><CardTitle>Make a call</CardTitle></CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Register a number first (Numbers page) before using the dialer.
            </p>
          ) : (
            <DialPad numbers={numbers} />
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Manual call history</h2>
        {history.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="dialer-history-empty">No manual calls yet.</p>
        )}
        {history.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded border border-border p-3 text-sm"
            data-testid="dialer-history-row">
            <span className="font-mono">{c.toNumber}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">{c.status}</span>
            <span className="text-xs text-muted-foreground">
              from {c.fromNumber} · {c.createdAt.toLocaleString()} · {c.durationSec}s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/dialer` in build output.

---

## Step 21: Sidebar navigation links

Edit `src/app/(app)/layout.tsx` (created in guide 05). In the `NAV` array, directly
after the line `{ href: "/calls", label: "Calls", icon: PhoneCall },` add:

```tsx
  { href: "/live", label: "Live", icon: Radio },
  { href: "/transfers", label: "Transfers", icon: ArrowRightLeft },
  { href: "/dialer", label: "Dialer", icon: PhoneForwarded },
```

Then extend the `lucide-react` import — **MERGE, do not remove any existing icon
imports** (guide 05's NAV also uses `Store` for Marketplace and `BookOpen` for
Knowledge — dropping them breaks the build). The final import must contain every
icon that was already there PLUS the three new ones, e.g.:

```tsx
import {
  LayoutDashboard, Bot, PhoneOutgoing, Users, PhoneCall, Phone, BarChart3, Wallet, Settings,
  Store, BookOpen,
  Radio, ArrowRightLeft, PhoneForwarded,
} from "lucide-react";
```

If the existing import line differs from the example above, keep ALL of its names
verbatim and only append `Radio, ArrowRightLeft, PhoneForwarded`. Cross-check that
every icon used in the NAV also appears in the lucide-react import:
```bash
grep -o "icon: [A-Za-z]*" "src/app/(app)/layout.tsx" | awk '{print $2}' | sort -u > /tmp/icons-used.txt
cat /tmp/icons-used.txt
for I in $(cat /tmp/icons-used.txt); do
  grep -Eq "(^|,| )\s*$I(,| |$)" <(tr '\n' ' ' < "src/app/(app)/layout.tsx" | grep -o "import {[^}]*} from \"lucide-react\"") \
    || echo "MISSING IMPORT: $I"
done
```
**Expected:** the used-icon list prints, and NO `MISSING IMPORT:` lines.

**Verify:**
```bash
grep -c '"/live"\|"/transfers"\|"/dialer"' "src/app/(app)/layout.tsx"
npm run typecheck
```
**Expected:** `3`; typecheck exit 0. **If typecheck fails** with `Store`/`BookOpen`
(or any other icon) not found → you removed existing imports; restore them per the
merge rule above.

---

## Step 22: End-to-end inbound simulation (no real telephony needed)

Rehearses the FULL inbound + live-ops path: number registered → agent published →
resolver answers with smart greeting → spam blocked → call events arrive → outcome
extracted → DNC honored → missed call → CallbackTask + `callback-dial` job →
transfer request → queue → accept → webhook events enqueued → voicemail row.

**Setup (Hermes):**
```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15

# 1. Published seed agent with a fake workflow id (idempotent)
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"Agent\" SET status='PUBLISHED', \"dograhWorkflowId\"='12', \"dograhWorkflowUuid\"='uuid-sim-1' WHERE name LIKE 'Front Desk%';"

# 2. Test DID + returning caller contact
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"PhoneNumber\" (id, \"workspaceId\", number, label, \"agentId\") SELECT 'pn_sim', w.id, '+918040001234', 'Main line', a.id FROM \"Workspace\" w, \"Agent\" a WHERE w.slug='demo-clinic' AND a.\"workspaceId\"=w.id LIMIT 1 ON CONFLICT DO NOTHING;"
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Contact\" (id, \"workspaceId\", phone, name) SELECT 'c_sim', id, '+919812345678', 'Ramesh Test' FROM \"Workspace\" WHERE slug='demo-clinic' ON CONFLICT DO NOTHING;"

# 3. HUMAN_TRANSFER tool config on the seed agent (fallback policy + queue destination + VIP)
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"AgentToolConfig\" (id, \"agentId\", tool, enabled, config, \"createdAt\", \"updatedAt\") \
  SELECT 'atc_sim', a.id, 'HUMAN_TRANSFER', true, '{\"queue\":\"support\",\"vipNumbers\":[\"+919812345678\"],\"queueDestinations\":{\"support\":\"+919800000001\"}}'::jsonb, now(), now() \
  FROM \"Agent\" a WHERE a.name LIKE 'Front Desk%' ON CONFLICT (\"agentId\", tool) DO UPDATE SET config = EXCLUDED.config;"

# 4. Webhook subscriber for event fan-out assertions
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"WebhookSubscription\" (id, \"workspaceId\", url, events, secret) \
  SELECT 'wh_sim', id, 'https://example.com/hook', '{call.completed,call.missed,voicemail.received,transfer.requested}', 'sim-secret' \
  FROM \"Workspace\" WHERE slug='demo-clinic' ON CONFLICT DO NOTHING;"
```

**Helper scripts (create once — used by T4–T7 below):**

**File `scripts/sim-postcall.ts`** (full content):

```ts
/**
 * Run the real post-call processor for one call, with optional deterministic hints
 * (skips the LLM so the test never depends on OPENROUTER_API_KEY).
 * Usage: npx tsx scripts/sim-postcall.ts <callId> [hintsJson]
 */
import { processCompletedCall } from "../src/lib/postcall";

async function main() {
  const [callId, hintsJson] = process.argv.slice(2);
  if (!callId) {
    console.error("usage: npx tsx scripts/sim-postcall.ts <callId> [hintsJson]");
    process.exit(1);
  }
  const hints = hintsJson ? JSON.parse(hintsJson) : {};
  await processCompletedCall(callId, hints);
  console.log("postcall done for", callId);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**File `scripts/sim-transfer-accept.ts`** (full content):

```ts
/**
 * Accept the newest QUEUED transfer request for the demo workspace through the
 * exact lib function the server action uses, and prove the accept is atomic.
 * Usage: npx tsx scripts/sim-transfer-accept.ts
 */
import { acceptTransfer } from "../src/lib/transfers";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const u = await db.user.findUnique({ where: { email: "demo@vaani.ai" } });
  if (!u) throw new Error("demo user missing (guide 02 seed)");
  const w = await db.workspace.findUnique({ where: { slug: "demo-clinic" } });
  if (!w) throw new Error("demo workspace missing (guide 02 seed)");
  const req = await db.transferRequest.findFirst({
    where: { workspaceId: w.id, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  if (!req) throw new Error("no QUEUED transfer request found");
  console.log("queue entry:", req.queue, req.reason);
  const r = await acceptTransfer(w.id, u.id, req.id);
  console.log("accept:", JSON.stringify(r));
  const again = await acceptTransfer(w.id, u.id, req.id);
  console.log("double-accept blocked:", JSON.stringify(again));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**T1 — resolver returns workflow + smart greeting for a returning caller:**
```bash
SECRET=$(grep DOGRAH_WEBHOOK_SECRET .env | cut -d= -f2)
curl -s -H "x-internal-secret: $SECRET" \
  "http://localhost:3000/api/v1/resolve-number?to=%2B918040001234&from=%2B919812345678"
```
**Expected:** JSON with `"ok":true`, `"workflowId":"12"`, `"blocked":false`,
`"is_returning_caller":"true"`, `"caller_name":"Ramesh Test"`, and `"greeting"`
starting with `Welcome back, Ramesh Test!`.

**T2 — resolver with unknown caller → base greeting:**
```bash
curl -s -H "x-internal-secret: $SECRET" \
  "http://localhost:3000/api/v1/resolve-number?to=%2B918040001234&from=%2B919999988877"
```
**Expected:** `"is_returning_caller":"false"`, greeting does NOT contain `Welcome back`.

**T3 — spam filter blocks a manual-blocklist number:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"DncEntry\" (id, \"workspaceId\", phone, source, reason) SELECT 'dnc_sim', id, '+919999900001', 'MANUAL', 'spam' FROM \"Workspace\" WHERE slug='demo-clinic' ON CONFLICT DO NOTHING;"
curl -s -H "x-internal-secret: $SECRET" \
  "http://localhost:3000/api/v1/resolve-number?to=%2B918040001234&from=%2B919999900001"
```
**Expected:** `"blocked":true`, `"blockReason":"manual-block"`.

**T4 — full call lifecycle via webhooks (outcome extraction + DNC):**
```bash
SECRET=$(grep DOGRAH_WEBHOOK_SECRET .env | cut -d= -f2)
post() {
  BODY="$1"
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
  curl -s -X POST http://localhost:3000/api/webhooks/dograh \
    -H "Content-Type: application/json" -H "x-dograh-signature: $SIG" -d "$BODY"
  echo
}
post '{"event":"call.started","data":{"call_id":"dograh_sim_1","from_number":"+919812345678","to_number":"+918040001234"}}'
post '{"event":"call.ended","data":{"call_id":"dograh_sim_1","duration_seconds":61,"summary":"Caller asked about timings, then said stop calling me.","transcript":"AI: Namaste! Demo Dental Clinic.\nCaller: What time do you open?\nAI: 10am to 8pm, Monday to Saturday.\nCaller: Theek hai. Aur mujhe dobara call mat karna."}}'
sleep 3
```
**Expected:** both posts `{"ok":true}`. Then:
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, \"durationSec\", outcome, sentiment FROM \"Call\" WHERE \"dograhCallId\"='dograh_sim_1';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT dnc, \"optOutAt\" IS NOT NULL AS opted_out FROM \"Contact\" WHERE phone='+919812345678';"
```
**Expected:** Call `COMPLETED | 61 | dnc-requested/other | ...`. If `OPENROUTER_API_KEY`
is set: Contact `t | t` (DNC + optOutAt). Without the key: defaults — then verify the
DNC write path deterministically with hints (helper script above):
```bash
CALL_ID=$(docker exec vaani-db psql -U vaani -d vaani -tAc \
 "SELECT id FROM \"Call\" WHERE \"dograhCallId\"='dograh_sim_1';")
npx tsx scripts/sim-postcall.ts "$CALL_ID" '{"outcome":"dnc-requested"}'
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT dnc FROM \"Contact\" WHERE phone='+919812345678';"
```
**Expected:** `postcall done for <id>` then Contact `dnc = t`.

**T5 — missed call → CallbackTask + `callback-dial` job + `call.missed` event:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Call\" (id, \"workspaceId\", \"dograhCallId\", direction, status, \"fromNumber\", \"toNumber\") \
  SELECT 'call_sim_missed', id, 'dograh_sim_missed', 'INBOUND', 'NO_ANSWER', '+919876500001', '+918040001234' FROM \"Workspace\" WHERE slug='demo-clinic';"
npx tsx scripts/sim-postcall.ts call_sim_missed
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, note, \"dueAt\" FROM \"CallbackTask\" WHERE note='MISSED_CALL' AND phone='+919876500001';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT event, status FROM \"WebhookDelivery\" d JOIN \"WebhookSubscription\" s ON s.id=d.\"subscriptionId\" WHERE s.id='wh_sim' AND event='call.missed';"
```
**Expected:** `postcall done for call_sim_missed`; CallbackTask
`PENDING | MISSED_CALL | <dueAt ~15 min from now>`; one `call.missed | PENDING`
delivery row. Verify the job landed on the shared queue:
```bash
JOB_ID=$(docker exec vaani-redis redis-cli ZRANGE bull:campaign-dialer:delayed 0 -1 | tail -1)
echo "job id: $JOB_ID"
docker exec vaani-redis redis-cli HGET "bull:campaign-dialer:$JOB_ID" name
docker exec vaani-redis redis-cli HGET "bull:campaign-dialer:$JOB_ID" data | grep -o '"phone":"+919876500001"'
```
**Expected:** `callback-dial` and the phone number match. **If delayed set is empty:**
the job may already be waiting (past-due) — check
`docker exec vaani-redis redis-cli LRANGE bull:campaign-dialer:wait 0 -1` the same way.

**T6 — transfer request → queue → accept (with VIP caller):**
```bash
SECRET=$(grep DOGRAH_WEBHOOK_SECRET .env | cut -d= -f2)
# live call from the VIP number (+919812345678 is in the tool config's vipNumbers)
BODY='{"event":"call.started","data":{"call_id":"dograh_sim_2","from_number":"+919812345678","to_number":"+918040001234"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST http://localhost:3000/api/webhooks/dograh -H "Content-Type: application/json" -H "x-dograh-signature: $SIG" -d "$BODY"; echo

curl -s -X POST http://localhost:3000/api/v1/transfer-request \
  -H "Content-Type: application/json" -H "x-internal-secret: $SECRET" \
  -d '{"call_id":"dograh_sim_2","reason":"caller asked for a human"}'
echo
# negative: no secret → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/v1/transfer-request \
  -H "Content-Type: application/json" -d '{"call_id":"dograh_sim_2"}'
# negative: unknown call → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/v1/transfer-request \
  -H "Content-Type: application/json" -H "x-internal-secret: $SECRET" -d '{"call_id":"nope"}'
```
**Expected:** first POST → `{"ok":true,...,"queue":"support","destination":"+919800000001"}`;
then `401`; then `404`. Accept it through the same lib the server action uses
(helper script above):
```bash
npx tsx scripts/sim-transfer-accept.ts
```
**Expected:** `queue entry: support explicit-request` (or `vip`), `accept: {"ok":true}`,
`double-accept blocked: {"ok":false,...}` (atomic accept).

**T7 — message-taken → VoicemailMessage + staff notify (dry-run) + event:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Call\" (id, \"workspaceId\", \"dograhCallId\", direction, status, \"fromNumber\", \"toNumber\", transcript, summary) \
  SELECT 'call_sim_vm', id, 'dograh_sim_vm', 'INBOUND', 'COMPLETED', '+919876500002', '+918040001234', 'AI: ...\nCaller: Please tell Dr. Priya that my crown is loose. Call me back tomorrow.', 'Caller left a message for Dr. Priya.' FROM \"Workspace\" WHERE slug='demo-clinic';"
npx tsx scripts/sim-postcall.ts call_sim_vm '{"outcome":"message-taken","messageTaken":true}'
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, transcript IS NOT NULL AS has_transcript FROM \"VoicemailMessage\" WHERE \"fromNumber\"='+919876500002';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT event FROM \"WebhookDelivery\" d JOIN \"WebhookSubscription\" s ON s.id=d.\"subscriptionId\" WHERE s.id='wh_sim' AND event='voicemail.received';"
```
**Expected:** `postcall done for call_sim_vm`; VoicemailMessage `NEW | t`; one
`voicemail.received` row. (Email skipped — no SMTP_HOST; WhatsApp dry-run — both
logged in `/tmp/next-dev.log`.)

**T8 — after-call `call.completed` fan-out happened for T4:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT event, status, attempts FROM \"WebhookDelivery\" d JOIN \"WebhookSubscription\" s ON s.id=d.\"subscriptionId\" WHERE s.id='wh_sim' ORDER BY d.\"createdAt\"; SELECT event, count(*) FROM \"WebhookDelivery\" d JOIN \"WebhookSubscription\" s ON s.id=d.\"subscriptionId\" WHERE s.id='wh_sim' GROUP BY event;"
```
**Expected:** rows for `call.missed`, `voicemail.received`, `transfer.requested`, and
at least one `call.completed`, all `PENDING` with `attempts=0` (guide 08's worker
delivers them).

**T9 — live dashboard API auth guard (negative):**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/live/calls
```
**Expected:** `401`. (The authenticated 200 path + polling UI is covered by the
Playwright suite in guide 11 — selectors listed in the data-testid inventory below.)

**Cleanup:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"WebhookDelivery\" WHERE \"subscriptionId\"='wh_sim';
  DELETE FROM \"WebhookSubscription\" WHERE id='wh_sim';
  DELETE FROM \"VoicemailMessage\" WHERE \"fromNumber\" LIKE '+9198765%';
  DELETE FROM \"CallbackTask\" WHERE note='MISSED_CALL' AND phone='+919876500001';
  DELETE FROM \"TransferRequest\" WHERE \"workspaceId\" IN (SELECT id FROM \"Workspace\" WHERE slug='demo-clinic');
  DELETE FROM \"CallEvent\" WHERE \"callId\" IN (SELECT id FROM \"Call\" WHERE \"dograhCallId\" LIKE 'dograh_sim%');
  DELETE FROM \"TranscriptEntry\" WHERE \"callId\" IN (SELECT id FROM \"Call\" WHERE \"dograhCallId\" LIKE 'dograh_sim%');
  DELETE FROM \"LiveCallState\" WHERE \"callId\" IN ('call_sim_missed','call_sim_vm');
  DELETE FROM \"Call\" WHERE \"dograhCallId\" LIKE 'dograh_sim%';
  DELETE FROM \"PhoneNumber\" WHERE id='pn_sim';
  DELETE FROM \"DncEntry\" WHERE id='dnc_sim';
  DELETE FROM \"AgentToolConfig\" WHERE id='atc_sim';
  DELETE FROM \"CalendarConnection\" WHERE id='cal_sim';
  UPDATE \"Contact\" SET dnc=false, \"optOutAt\"=NULL WHERE id='c_sim';"
docker exec vaani-redis redis-cli DEL bull:campaign-dialer:delayed bull:campaign-dialer:wait > /dev/null || true
pkill -f "next dev" || true
```

**If it fails:** `tail -n 40 /tmp/next-dev.log` and report. Resolver 404 on T1 → the
agent UPDATE didn't match (`SELECT name FROM "Agent";` — needs a `Front Desk%` agent).
Webhook 401 on T4 → wrong `DOGRAH_WEBHOOK_SECRET` extraction (`grep DOGRAH_WEBHOOK_SECRET .env`).

---

## Step 23: Full test suite + build gate

```bash
cd /root/vaani-ai
npm test
npm run typecheck && npm run build
```
**Expected:** vitest passes ALL suites (money from guide 02 + greeting, spamFilter,
fallbackPolicy, leadExtraction, dialJobs, liveState from this guide); typecheck and
build exit 0. **If a suite fails:** re-copy that test + module exactly from this
guide; do not edit assertions to make them pass.

---

## Step 24: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 06: inbound receptionist + live ops — smart greeting, spam filter, fallback policies, lead capture, voicemail, missed-call callback, live dashboard, transfer queue, web dialer"
```

---

## OPERATOR GATES summary (human verifies with the provider)

| Gate | What to verify | Where |
|---|---|---|
| DID binding | DID → workflow `inbound_workflow_id` set in Dograh | Step 1 |
| Pre-call data fetch | Dograh workflow calls our resolver and maps `greeting`/`context.*` into the Start Call node | Step 6 |
| Dograh Call Transfer tool | dynamic destination → `/api/v1/transfer-request`; null destination → message branch | Step 16 |
| Whisper mid-call injection | NOT available in documented Dograh API — whisper is recorded + shown on takeover; revisit when Dograh adds context injection | Steps 17–18 |
| In-browser softphone audio | gated on Dograh web-call support for tenant dial-out; v1 dials via worker | Step 20 |
| Sarvam batch STT for voicemails | model `saarika:v2.5`, quota, reachable recording URL | Step 14 |
| Real CRM push | provider adapters land with guide 05's CRM UI; `CRM_PUSH_DRY_RUN=false` only after | Step 13 |
| Real WhatsApp/email staff alerts | set `WHATSAPP_DRY_RUN=false` + Vobiz creds; configure `SMTP_*` | Steps 0, 11 |

---

## data-testid inventory (guide 11 builds Playwright from this)

| Selector | Element |
|---|---|
| `number-input`, `number-type-select`, `number-add-btn`, `number-row`, `number-agent-select`, `number-assign-btn`, `number-delete-btn` | /numbers |
| `live-dashboard`, `live-error`, `live-empty`, `live-call-row`, `live-transcript-viewer`, `live-listen-btn`, `live-barge-btn`, `live-takeover-btn`, `live-release-btn`, `live-whisper-input`, `live-whisper-send`, `live-whisper-active` | /live |
| `availability-toggle`, `transfer-empty`, `transfer-queue-row`, `transfer-context`, `transfer-accept-btn`, `transfer-decline-btn`, `transfer-accepted-row` | /transfers |
| `dialer-pad`, `dialer-from-select`, `dialer-number-input`, `dialer-digit-0..9`, `dialer-digit-plus`, `dialer-digit-hash`, `dialer-backspace-btn`, `dialer-call-btn`, `dialer-message`, `dialer-history-empty`, `dialer-history-row` | /dialer |

**Critical user flows for Playwright:**
1. Register number → assign published agent → row shows "answering: <agent>".
2. Seed an in-progress call (psql) → /live shows `live-call-row` within 5s → type
   whisper → `live-whisper-send` → `live-whisper-active` appears → Barge →
   /transfers shows the new `transfer-queue-row` → Accept → row leaves the queue and
   appears under "Accepted by you".
3. Seed a QUEUED TransferRequest with a context snapshot → /transfers shows
   `transfer-context` (summary + transcript) BEFORE accepting → Decline → row gone.
4. /dialer: type a number via pad digits → Call → `dialer-message` confirms →
   `dialer-history-row` appears. Negative: dial the DNC-seeded number → error message.
5. Toggle `availability-toggle` → label flips Available/Unavailable.
6. Missed call → (worker not required) `callback-dial` job visible in Redis; covered
   by script, Playwright only needs the CallbackTask visible in DB/calls UI.

---

## Acceptance Checklist

- [ ] `/numbers`: register DID with type (LOCAL/TOLLFREE/MOBILE/140/1600), assign published agent, unassign, delete
- [ ] Resolver: 401 without secret, 404 unknown number, 200 with `greeting` + `context` for assigned number; returning caller gets "Welcome back, <name>"; spam number → `blocked:true`
- [ ] Unit tests green: greeting (hours/holiday/returning), spamFilter, fallbackPolicy, leadExtraction, dialJobs payloads, liveState transitions + whisper validation
- [ ] Webhook simulation: call.started creates INBOUND row; call.ended completes it; outcome + sentiment extracted (with OpenRouter key) or defaults (without); DNC flips contact + DncEntry(OPT_OUT)
- [ ] Missed call → CallbackTask(MISSED_CALL) + `callback-dial` job on `campaign-dialer` queue + `call.missed` delivery row
- [ ] Transfer-request route: 200 + queue destination, 401 no secret, 404 unknown call; accept is atomic (double-accept fails)
- [ ] Message-taken → VoicemailMessage(NEW) + staff notify (dry-run logs) + `voicemail.received` delivery row
- [ ] `call.completed` WebhookDelivery rows enqueued for subscribers (PENDING, attempts 0)
- [ ] `/live`, `/transfers`, `/dialer` routes build; live API 401 without session
- [ ] `npm test` + `npm run typecheck` + `npm run build` all exit 0
- [ ] Git commit `phase 06: ...` exists

## FINAL REPORT format

```
STEP 0..24: PASS/FAIL/GATED — <one line of evidence each>
RESOLVER: greeting=OK/FAIL spam-block=OK/FAIL
POSTCALL: LIVE-LLM / FALLBACK-DEFAULTS
MISSED-CALL: callback-dial job seen in redis = YES/NO
TRANSFER: route=OK/FAIL accept-atomic=OK/FAIL
WEBHOOK EVENTS ENQUEUED: <list of events seen>
OPERATOR GATES: <which gates remain open>
ACCEPTANCE: n/11 checked
NOTES: <deviations>
```
