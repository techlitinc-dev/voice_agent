# 07 — Outbound Campaign Engine (AI Telecaller)

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/07_outbound_campaign_engine.md` exactly. Create files with the
> EXACT contents shown. Run every Verify, compare with Expected, max 2 fix attempts,
> then STOP and report. Tenant rule: every query through `requireWorkspace()` /
> `requirePermission()` (guide 03's RBAC — FIRST call in every server action). Never spend real telephony money in tests — use the DRY_RUN path
> exactly as described (`CAMPAIGN_DRY_RUN=true`, `WHATSAPP_DRY_RUN=true`). Never change
> pinned versions. Steps marked **OPERATOR GATE** are verified by the human with the
> provider, not by you — mark them `GATED` in your report. End with the FINAL REPORT.
> ---

---

## Goal

The complete **AI telecaller** (readme §6), plus WhatsApp campaigns (§9), TCPA/TRAI
consent & opt-out controls (§11) and predictive dialing (§15):

Upload contacts (CSV with dedupe, E.164 validation, **DNC scrubbing**, consent flags,
per-contact timezones — or pull from the connected CRM) → create a campaign from one of
**8 type presets** (pick agent + list + number pool + pacing + retry policy + calling
windows + opening hook + objection playbook) → **Start** (TRAI series/consent enforced)
→ a background worker dials contacts through Dograh/Vobiz with **progressive ramp-up,
answer-rate adaptive pacing, timezone-aware windows, per-disposition retries with smart
spacing, number-pool rotation with daily/lifetime caps, and optional predictive
dial-ahead** → live per-contact status, **pause/resume, edit script mid-flight, add
contacts to a running campaign** → post-call intelligence: **interest scoring
(hot/warm/cold), callback scheduling ("call me tomorrow at 5"), AMD/voicemail policy,
opt-out cascade ("stop calling me" → DNC everywhere), sentiment escalation to a human**
→ WhatsApp template campaigns + **call-to-WhatsApp fallback** on final no-answer →
campaign auto-completes.

**Safety design (do not change):** the worker supports `CAMPAIGN_DRY_RUN=true` (default
in `.env.example` for dev) which simulates dial results AND post-call LLM results —
no Dograh, no OpenRouter, no cost. WhatsApp sends are separately gated by
`WHATSAPP_DRY_RUN=true` (guide 06). ALL tests in this guide run fully dry. Real
dialing is env flips, done by the operator in production (guide 12).

**Time estimate:** 6–8 hours. **Prerequisites:** guides 01–06 green, Redis container
up, at least one PUBLISHED agent (guide 05).

---

## Architecture (context — do not code from this section)

Three BullMQ queues on Redis + three node-cron timers, all inside the worker process
(`npm run worker`):

- `campaign-scheduler` — one repeatable job per RUNNING campaign (every 30s): reads the
  campaign **fresh** (mid-flight edits apply), finds due contacts (PENDING, or
  RETRY_SCHEDULED with `nextAttemptAt <= now`), enforces per-contact timezone windows +
  TRAI hours + consent + DNC, computes the batch from ramp-up/adaptive pacing and the
  concurrency/predictive slot budget, picks a pool number (round-robin, caps enforced),
  and enqueues `dial` jobs.
- `campaign-dialer` — job names: **`dial`** (one campaign contact attempt: DNC
  re-check, Dograh trigger or dry-run simulate, retry scheduling, WhatsApp fallback on
  final no-answer), **`callback-dial`** and **`manual-dial`** (contracts owned by guide
  06 — exact payloads in Step 7).
- `whatsapp-send` — one job per recipient of a WhatsApp campaign, throttled
  (5 msgs/sec), dry-run gated.

node-cron timers (worker process):
- `* * * * *` — **callback sweep**: PENDING CallbackTasks with `dueAt <= now` → enqueue
  `callback-dial` (safety net for tasks created without a delayed job).
- `* * * * *` — **post-call sweep**: completed campaign calls with a transcript but no
  `interestScore` → LLM interest scoring, callback-request extraction (→ CallbackTask +
  `callback-dial`), opt-out cascade (→ DncEntry + remove from all active campaigns),
  sentiment escalation (→ TransferRequest), AMD/voicemail reconciliation, and retry
  reconciliation for real calls whose webhook outcome was no-answer/busy/voicemail.
- `0 3 * * *` — **nightly reset**: `PhoneNumber.dailyCallsUsed = 0` for all pools.

**Why our own engine when Dograh has a campaigns API?** Dograh campaigns dial a CSV
for one org. We need per-tenant pacing, DNC/consent enforcement at dial time, retry
policies, number-pool caps, live per-contact state in OUR dashboard, and per-call
wallet billing (guide 09 debits from the Call rows this engine creates) — none of which
Dograh's engine knows about. So our worker owns campaign state and places individual
calls through Dograh's exact trigger contract (guide 04):
`dograhTriggerCall(workflowUuid, { phoneNumber, initialContext })`.

**Vobiz "1,000 destinations per request" note (readme §6.1):** Vobiz's bulk API can
accept up to 1,000 destinations in one request. We deliberately dial 1-by-1 through
Dograh's trigger endpoint because each call needs its own workflow run (per-contact
context, per-call CDR/billing, mid-flight script edits). OPERATOR NOTE: if a future
high-volume tenant needs raw blast dialing without per-call AI context, add a Vobiz
batch sender behind the same scheduler — do NOT replace this engine.

**Predictive dialing honesty note (readme §15):** classic predictive dialing over-dials
because *human* agents might be busy, at the cost of abandoned calls. Our "agents" are
AI workflows that pick up instantly — abandonment is ~0 by construction. So
`predictiveDialing=true` is a **concurrency booster**: it lets the scheduler over-book
dial jobs at `DIAL_AHEAD_RATIO` (1.5×) the free slots, absorbing setup latency. There is
no "no agent free → drop call" path; the guardrail is the AI answering immediately.

Campaign state machine: DRAFT → RUNNING ⇄ PAUSED → COMPLETED / CANCELLED
(SCHEDULED reserved for future timed starts). The worker only processes RUNNING
campaigns. Campaign completes when no PENDING/RETRY_SCHEDULED/DIALING contacts remain.

---

## Feature coverage map (readme → step)

| readme.md bullet | Step(s) |
|---|---|
| §6.1 contact list management: CSV upload, dedupe, validation, DNC scrubbing | 6a (actions), 11 (UI), 14.0–14.1 (tests) |
| §6.1 CRM import / API sync | 6a (CRM import, dry-run safe; API sync = guide 08's public API — note in 6a) |
| §6.1 bulk dialing: CPS + concurrency | 7 (scheduler honors both; Vobiz batch note above) |
| §6.1 scheduling: timezone-aware windows, day-of-week, business hours, TRAI 9–21 | 3b (`windows.ts`), 7 |
| §6.1 retry logic per disposition + smart spacing | 3c (`retry.ts`), 8, 14.2 |
| §6.1 number pool rotation + daily/lifetime caps | 3e (`pool.ts`), 6c + 11 (editor), 7 (rotation), 9 (nightly reset), 14.1 |
| §6.1 TRAI 140/1600 series + DLT guidance | 3f (`compliance.ts`), 6b (enforced at start), 13 (DLT checklist) |
| §6.1 campaign types ×8 | 5 (`presets.ts`), 10 (preset cards) |
| §6.1 throttling: progressive ramp-up + answer-rate adaptive pacing | 3d (`pacing.ts`), 7 |
| §6.1 live control: pause/resume/edit script mid-flight/add contacts | 6b (actions), 10 (UI), 14.3/14.7 |
| §6.2 opening hooks + identity disclosure | 5 (preset hooks), 6b, 8 (injected into `initial_context`) |
| §6.2 objection playbook | 5, 6b, 8 (injected) |
| §6.2 interest scoring hot/warm/cold + reasons | 4 (`scoring.ts`), 9 (post-call sweep), 14.6 |
| §6.2 callback scheduling ("call me tomorrow at 5") | 4 (`scoring.ts`), 8–9 (CallbackTask + `callback-dial`), 14.4/14.6 |
| §6.2 voicemail/AMD policy | 6b (`amdPolicy`), 8 (injected), 9 (MACHINE → voicemail reconciliation) |
| §6.2 sentiment-aware escalation → polite exit + human flag | 4 (`scoring.ts`), 9 (TransferRequest), 14.6 |
| §7/06 contracts: `callback-dial`, `manual-dial` jobs | 2 (payloads), 8 (processors), 14.4 |
| §9 WhatsApp template campaigns + call-to-WhatsApp fallback | 3g/9 (`fallback.ts`), 6d + 11 (templates + send), 8 (fallback send), 14.5 |
| §11 consent flags (TCPA), instant opt-out → DNC | 3f (`compliance.ts`), 6a/6b (enforcement), 9 (cascade), 14.6 |
| §15 predictive dialing | 3d (`pacing.ts` slots), 7 (slot budget), honesty note above |

---

## Step 1: Dependencies + env vars

```bash
cd /root/vaani-ai
npm install node-cron@3.0.3
npm install --save-dev @types/node-cron@3.0.11
```

**Verify:**
```bash
npm ls node-cron @types/node-cron 2>&1 | tail -n 3
```
**Expected:** `node-cron@3.0.3` and `@types/node-cron@3.0.11` (no `UNMET`).
**If it fails:** npm registry hiccup — run the two install commands once more. Still
failing → STOP and report the exact npm error.

**Edit `.env` — append this block** (defaults are safe; everything dry-run):

```bash
# --- Guide 07: outbound campaign engine ---
CAMPAIGN_DRY_RUN=true            # true = simulate dials + post-call LLM (no Dograh, no OpenRouter, no cost)
CAMPAIGN_DRY_RUN_RESULT=         # optional: force simulated outcome: completed | no-answer | busy | voicemail (empty = random mix)
CAMPAIGN_RAMP_START_CPM=2        # progressive ramp-up: starting calls/minute when a campaign starts
CAMPAIGN_RAMP_DOUBLE_MINUTES=10  # ramp-up: double CPS every N minutes until callsPerMinute cap
CAMPAIGN_ANSWER_RATE_THRESHOLD=0.2  # adaptive pacing: below this rolling answer rate, halve CPS
TRAI_HOURS_ENFORCE=true          # hard guardrail: SERIES_140 promotional pools only dial 09:00-21:00 contact-local
REQUIRE_CONSENT_FOR_PROMOTIONAL=false  # true = promotional campaigns skip contacts without consentAt (TCPA-style)
OPENROUTER_SCORING_MODEL=meta-llama/llama-3.1-8b-instruct  # cheap model for interest scoring / callback extraction
CRM_IMPORT_DRY_RUN=true          # true = CRM import returns fixture rows instead of calling the CRM API
```

Also append the same block (with comments) to `.env.example`.

`OPENROUTER_API_KEY` already exists from guide 04 — do NOT add it again. Verify:
```bash
grep -c "OPENROUTER_API_KEY" .env
```
**Expected:** `1` (or more). If `0`: append `OPENROUTER_API_KEY=` (empty is fine for
dry-run; the operator fills it for production) and note it in your report.

**Verify:**
```bash
grep -c "CAMPAIGN_DRY_RUN\|TRAI_HOURS_ENFORCE\|OPENROUTER_SCORING_MODEL" .env .env.example
```
**Expected:** `.env:3` and `.env.example:3`.

---

## Step 2: Queue infrastructure

Extends guide 07's original `src/lib/queue.ts`: the dialer queue now carries THREE job
names (`dial`, `callback-dial`, `manual-dial` — the last two are guide 06's contract,
payloads re-declared here for the worker's types; guide 06's `src/lib/dialJobs.ts` is
the producer side, do not modify it) and a new `whatsapp-send` queue is added.

**File `src/lib/queue.ts`** (full content — overwrite the old file):

```ts
import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export function createRedisConnection() {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
}

export const QUEUES = {
  scheduler: "campaign-scheduler",
  dialer: "campaign-dialer", // shared with guide 06 (callback-dial / manual-dial producers)
  whatsapp: "whatsapp-send",
} as const;

// ---------- Job names + payloads (contract — do not rename) ----------

export const DIAL_JOB = "dial";
export const CALLBACK_DIAL_JOB = "callback-dial"; // guide 06 contract
export const MANUAL_DIAL_JOB = "manual-dial"; // guide 06 contract
export const WHATSAPP_SEND_JOB = "whatsapp-send";

export type SchedulerJobData = { campaignId: string };

export type DialJobData = {
  campaignId: string;
  campaignContactId: string;
  workspaceId: string;
  phoneNumberId?: string; // pool number claimed by the scheduler (caps already incremented)
};

/** Guide 06 contract — superset of src/lib/dialJobs.ts CallbackDialJobData.
 *  Tolerant consumer: producers today send {workspaceId, callbackTaskId, phone,
 *  note ("MISSED_CALL" for missed calls), requestedBy, enqueuedAt} with a 15-min
 *  delay; producers MAY also set agentId/reason — both are honored when present. */
export type CallbackDialJobData = {
  workspaceId: string;
  callbackTaskId: string;
  phone: string; // E.164 to call back
  note?: string; // e.g. "MISSED_CALL"
  requestedBy: "system";
  enqueuedAt: string; // ISO
  agentId?: string; // optional: force a specific agent for the callback
  reason?: string; // optional structured reason (supersedes note)
};

/** Guide 06 contract — identical shape to src/lib/dialJobs.ts ManualDialJobData. */
export type ManualDialJobData = {
  workspaceId: string;
  userId: string;
  callId: string; // existing Call row (OUTBOUND/RINGING) the worker attaches to
  fromNumber: string; // workspace DID (E.164) to dial from
  toNumber: string; // destination (E.164)
  enqueuedAt: string; // ISO
};

export type WhatsAppSendJobData = {
  workspaceId: string;
  whatsAppCampaignId: string;
  phone: string;
  templateName: string;
  params: string[];
  index: number; // 0-based recipient index
  total: number; // total recipients (last job marks the campaign COMPLETED)
};

// ---------- Queue singletons ----------

let schedulerQueue: Queue<SchedulerJobData> | null = null;
let dialerQueue: Queue | null = null;
let whatsappQueue: Queue<WhatsAppSendJobData> | null = null;

export function getSchedulerQueue() {
  if (!schedulerQueue) {
    schedulerQueue = new Queue<SchedulerJobData>(QUEUES.scheduler, {
      connection: createRedisConnection(),
    });
  }
  return schedulerQueue;
}

export function getDialerQueue() {
  if (!dialerQueue) {
    dialerQueue = new Queue(QUEUES.dialer, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 2, // job-level retry (infra failures), NOT contact retries
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return dialerQueue;
}

export function getWhatsAppQueue() {
  if (!whatsappQueue) {
    whatsappQueue = new Queue<WhatsAppSendJobData>(QUEUES.whatsapp, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return whatsappQueue;
}

/** Start a 30s repeatable scheduler tick for a campaign. Idempotent. */
export async function ensureCampaignScheduler(campaignId: string) {
  await getSchedulerQueue().add(
    `tick-${campaignId}`,
    { campaignId },
    {
      repeat: { every: 30_000 },
      jobId: `scheduler-${campaignId}`, // dedupe key
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function stopCampaignScheduler(campaignId: string) {
  const q = getSchedulerQueue();
  const repeatable = await q.getRepeatableJobs();
  for (const job of repeatable) {
    if (job.name === `tick-${campaignId}`) {
      await q.removeRepeatableByKey(job.key);
    }
  }
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.
**If it fails:** `Cannot find module 'bullmq'` → guide 01 not complete; run
`npm install bullmq@5.25.1 ioredis@5.4.1` once, re-typecheck, else STOP and report.

---

## Step 3: Pure campaign libraries (the testable core)

All campaign math lives in pure, dependency-free functions under
`src/lib/campaign/` so Vitest can pin every rule (money-adjacent logic is never inline
in the worker). Create each file EXACTLY as shown, then the test files, then run the
suite once at the end of this step.

### 3a — `src/lib/campaign/phone.ts` (phone validation + India series rules)

```ts
/**
 * Phone normalization + validation (readme §6.1 "validation").
 * Contacts: E.164, with Indian 10-digit mobiles auto-prefixed +91.
 * Pool DIDs: India series rules — SERIES_140 numbers start +91140,
 * SERIES_1600 numbers start +911600 (TRAI allocation).
 */

const E164 = /^\+[1-9]\d{7,14}$/;
const IN_MOBILE_10 = /^[6-9]\d{9}$/;
const IN_MOBILE_12 = /^91[6-9]\d{9}$/;

export function isValidE164(phone: string): boolean {
  return E164.test(phone);
}

/** Normalize common Indian formats to E.164: 9876543210 → +919876543210. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (E164.test(digits)) return digits;
  const onlyDigits = digits.replace(/\D/g, "");
  if (IN_MOBILE_10.test(onlyDigits)) return `+91${onlyDigits}`;
  if (IN_MOBILE_12.test(onlyDigits)) return `+${onlyDigits}`;
  return null;
}

/** +91 mobile (contact-reachable Indian wireless number). */
export function isIndianMobile(phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(phone);
}

export type IndianDidSeries = "140" | "1600" | "other";

/** Classify an Indian DID we OWN (pool number) by TRAI series. */
export function classifyIndianDid(phone: string): IndianDidSeries {
  if (/^\+91140\d{7}$/.test(phone)) return "140";
  if (/^\+911600\d{6}$/.test(phone)) return "1600";
  return "other";
}

/** Validate a pool DID against its declared NumberType (only 140/1600 are rule-bound). */
export function isValidDidForType(phone: string, numberType: string): boolean {
  if (!isValidE164(phone)) return false;
  if (numberType === "SERIES_140") return classifyIndianDid(phone) === "140";
  if (numberType === "SERIES_1600") return classifyIndianDid(phone) === "1600";
  return true; // LOCAL / TOLLFREE / MOBILE: any valid E.164
}
```

### 3b — `src/lib/campaign/windows.ts` (timezone windows + day-of-week + TRAI hours)

```ts
/**
 * Timezone-aware calling windows (readme §6.1 "scheduling") + TRAI permitted-hours
 * guardrail (readme §11: 09:00–21:00 contact-local for promotional/SERIES_140).
 * Pure functions; `now` is always injected so tests use fixed clocks.
 */

export const TRAI_START = "09:00";
export const TRAI_END = "21:00"; // exclusive
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type TimezoneWindows = {
  timezone?: string; // IANA, campaign default when the contact has none
  days?: number[]; // 0=Sunday … 6=Saturday; empty/undefined = every day
  windows?: [string, string][]; // HH:mm pairs; overrides windowStart/windowEnd when present
};

/** Tolerant parser for Campaign.timezoneWindows JSON. Returns null when unusable. */
export function parseTimezoneWindows(json: unknown): TimezoneWindows | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const out: TimezoneWindows = {};
  if (typeof o.timezone === "string" && o.timezone.length > 0) out.timezone = o.timezone;
  if (Array.isArray(o.days)) {
    const days = o.days.filter((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) as number[];
    if (days.length > 0) out.days = days;
  }
  if (Array.isArray(o.windows)) {
    const wins: [string, string][] = [];
    for (const w of o.windows) {
      if (
        Array.isArray(w) && w.length === 2 &&
        typeof w[0] === "string" && /^\d{2}:\d{2}$/.test(w[0]) &&
        typeof w[1] === "string" && /^\d{2}:\d{2}$/.test(w[1])
      ) wins.push([w[0], w[1]]);
    }
    if (wins.length > 0) out.windows = wins;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** "HH:mm" in a timezone. Invalid timezone → DEFAULT_TIMEZONE (never throws). */
export function localHHMM(now: Date, timeZone?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone ?? DEFAULT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h === "24" ? "00" : h}:${m}`;
  } catch {
    return localHHMM(now, DEFAULT_TIMEZONE);
  }
}

/** Day of week (0=Sunday) in a timezone. Invalid timezone → DEFAULT_TIMEZONE. */
export function localDay(now: Date, timeZone?: string | null): number {
  try {
    const w = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone ?? DEFAULT_TIMEZONE,
      weekday: "short",
    }).format(now);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
  } catch {
    return localDay(now, DEFAULT_TIMEZONE);
  }
}

export type WindowInput = {
  now: Date;
  contactTimezone?: string | null; // Contact.timezone wins when set
  windowStart: string; // campaign fallback "HH:mm"
  windowEnd: string;
  timezoneWindows?: TimezoneWindows | null; // parsed Campaign.timezoneWindows
};

/** Effective timezone for a dial: contact → campaign JSON → default. */
export function effectiveTimezone(input: WindowInput): string {
  return input.contactTimezone ?? input.timezoneWindows?.timezone ?? DEFAULT_TIMEZONE;
}

/** Is `now` inside ANY permitted window for this contact (day-of-week + windows)? */
export function isWithinCallingWindows(input: WindowInput): boolean {
  const tz = effectiveTimezone(input);
  if (input.timezoneWindows?.days && !input.timezoneWindows.days.includes(localDay(input.now, tz))) {
    return false;
  }
  const hhmm = localHHMM(input.now, tz);
  const wins = input.timezoneWindows?.windows ?? [[input.windowStart, input.windowEnd] as [string, string]];
  return wins.some(([s, e]) => hhmm >= s && hhmm <= e);
}

/** TRAI/TCCCPR: promotional (SERIES_140) calls only 09:00–21:00 contact-local. */
export function isWithinTraiHours(now: Date, timeZone?: string | null): boolean {
  const hhmm = localHHMM(now, timeZone ?? DEFAULT_TIMEZONE);
  return hhmm >= TRAI_START && hhmm < TRAI_END;
}
```

### 3c — `src/lib/campaign/retry.ts` (per-disposition retries + smart spacing)

```ts
/**
 * Retry policy (readme §6.1 "configurable attempts per disposition, smart spacing").
 * Campaign.retryPolicy JSON overrides per disposition; scalar maxAttempts/retryDelayMin
 * are the fallback. Spacing = exponential backoff (×2 per attempt, capped 24h) + ±20%
 * jitter so retries don't thunder-herd.
 */

export const DISPOSITIONS = ["busy", "no-answer", "failed", "voicemail"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type RetryRule = { attempts: number; delayMin: number };
export type RetryPolicy = Partial<Record<Disposition, RetryRule>>;

export type CampaignExtras = {
  /** readme §9 call-to-WhatsApp fallback: send this template after final no-answer. */
  whatsappFallbackTemplateId?: string;
};

const MAX_DELAY_MIN = 24 * 60;

export function isDisposition(s: string): s is Disposition {
  return (DISPOSITIONS as readonly string[]).includes(s);
}

/** Tolerant parser for Campaign.retryPolicy JSON (ignores unknown keys, keeps extras). */
export function parseRetryPolicy(json: unknown): RetryPolicy {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  const out: RetryPolicy = {};
  for (const d of DISPOSITIONS) {
    const v = o[d];
    if (v && typeof v === "object") {
      const r = v as Record<string, unknown>;
      const attempts = Number(r.attempts);
      const delayMin = Number(r.delayMin);
      if (Number.isInteger(attempts) && attempts >= 1 && attempts <= 10 &&
          Number.isFinite(delayMin) && delayMin >= 5 && delayMin <= MAX_DELAY_MIN) {
        out[d] = { attempts, delayMin };
      }
    }
  }
  return out;
}

/** Non-disposition extras stored in the same JSON column. */
export function parseCampaignExtras(json: unknown): CampaignExtras {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  const out: CampaignExtras = {};
  if (typeof o.whatsappFallbackTemplateId === "string" && o.whatsappFallbackTemplateId.length > 0) {
    out.whatsappFallbackTemplateId = o.whatsappFallbackTemplateId;
  }
  return out;
}

/** Effective rule for a disposition: policy override → campaign defaults. */
export function resolveRetryRule(
  policy: RetryPolicy,
  disposition: Disposition,
  defaults: { maxAttempts: number; retryDelayMin: number }
): RetryRule {
  return policy[disposition] ?? { attempts: defaults.maxAttempts, delayMin: defaults.retryDelayMin };
}

/** Should this contact be retried after `attemptsSoFar` attempts at `disposition`? */
export function shouldRetry(
  policy: RetryPolicy,
  disposition: Disposition,
  attemptsSoFar: number,
  defaults: { maxAttempts: number; retryDelayMin: number }
): boolean {
  return attemptsSoFar < resolveRetryRule(policy, disposition, defaults).attempts;
}

/**
 * Smart spacing: base × 2^(attemptsSoFar-1), capped at 24h, ±20% jitter.
 * `rand` is injected (Math.random in prod, fixed in tests) → deterministic tests.
 */
export function computeRetryDelayMs(baseDelayMin: number, attemptsSoFar: number, rand: () => number): number {
  const exp = Math.min(baseDelayMin * 2 ** Math.max(0, attemptsSoFar - 1), MAX_DELAY_MIN);
  const jitter = 0.8 + rand() * 0.4; // 0.8 … 1.2
  return Math.round(exp * jitter * 60_000);
}

/** Full decision: retry (and when) or final failure. */
export function computeNextRetry(
  policy: RetryPolicy,
  disposition: Disposition,
  attemptsSoFar: number,
  defaults: { maxAttempts: number; retryDelayMin: number },
  now: Date,
  rand: () => number
): { retry: boolean; nextAttemptAt: Date | null } {
  if (!shouldRetry(policy, disposition, attemptsSoFar, defaults)) {
    return { retry: false, nextAttemptAt: null };
  }
  const rule = resolveRetryRule(policy, disposition, defaults);
  return {
    retry: true,
    nextAttemptAt: new Date(now.getTime() + computeRetryDelayMs(rule.delayMin, attemptsSoFar, rand)),
  };
}
```

### 3d — `src/lib/campaign/pacing.ts` (ramp-up + adaptive pacing + predictive slots)

```ts
/**
 * Throttling & pacing (readme §6.1) + predictive dial-ahead slots (readme §15).
 * - Progressive ramp-up: a campaign starts at `startCpm` and doubles every
 *   `doubleEveryMin` until it reaches its callsPerMinute cap (protects new DIDs
 *   from instant spam-flagging).
 * - Answer-rate adaptive pacing: below `threshold` rolling answer rate, CPS halves
 *   (floor 1); too few samples → no change.
 * - Predictive slots: over-book dial jobs at ratio × free slots (AI pickup ⇒ no
 *   abandonment; see the guide's honesty note).
 */

export const DIAL_AHEAD_RATIO = 1.5; // readme §15 — fixed, documented
export const MIN_ANSWER_SAMPLES = 10; // need this many recent calls before adapting

export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Current calls/minute after ramp-up. */
export function rampCpm(input: {
  capCpm: number;
  startedAt: Date;
  now: Date;
  startCpm?: number; // default CAMPAIGN_RAMP_START_CPM (2)
  doubleEveryMin?: number; // default CAMPAIGN_RAMP_DOUBLE_MINUTES (10)
}): number {
  const start = Math.max(1, input.startCpm ?? envInt("CAMPAIGN_RAMP_START_CPM", 2));
  const every = Math.max(1, input.doubleEveryMin ?? envInt("CAMPAIGN_RAMP_DOUBLE_MINUTES", 10));
  const elapsedMin = Math.max(0, (input.now.getTime() - input.startedAt.getTime()) / 60_000);
  const doublings = Math.floor(elapsedMin / every);
  return Math.min(input.capCpm, start * 2 ** doublings);
}

/** Rolling answer rate from recent calls; null when too few samples. */
export function answerRateFromCalls(calls: { answeredAt: Date | null }[]): number | null {
  if (calls.length < MIN_ANSWER_SAMPLES) return null;
  const answered = calls.filter((c) => c.answeredAt !== null).length;
  return answered / calls.length;
}

/** Adaptive pacing: below threshold → halve (floor 1); null rate → unchanged. */
export function adaptiveCpm(cpm: number, answerRate: number | null, threshold?: number): number {
  if (answerRate === null) return cpm;
  const t = threshold ?? Number(process.env.CAMPAIGN_ANSWER_RATE_THRESHOLD ?? "0.2");
  if (answerRate < t) return Math.max(1, Math.floor(cpm / 2));
  return cpm;
}

/** How many dials to enqueue per scheduler tick of `tickSeconds`. */
export function tickBatchSize(cpm: number, tickSeconds = 30): number {
  return Math.max(1, Math.floor((cpm * tickSeconds) / 60));
}

/**
 * Predictive dial-ahead slots (readme §15): how many NEW dial jobs may be in flight.
 * Normal mode: free slots = concurrency − inFlight (never negative).
 * Predictive mode: floor(concurrency × ratio) − inFlight — over-books because the AI
 * always picks up (abandonment ≈ 0; see the guide note).
 */
export function predictiveSlots(input: {
  concurrency: number;
  inFlight: number;
  predictive: boolean;
  ratio?: number;
}): number {
  const budget = input.predictive
    ? Math.max(input.concurrency, Math.floor(input.concurrency * (input.ratio ?? DIAL_AHEAD_RATIO)))
    : input.concurrency;
  return Math.max(0, budget - input.inFlight);
}
```

### 3e — `src/lib/campaign/pool.ts` (number pool rotation + caps)

```ts
/**
 * Number pool rotation (readme §6.1): round-robin across pool DIDs, skipping
 * numbers that hit their daily/lifetime cap (spam-flag protection).
 * The scheduler keeps the last-used number id per pool in memory; this module is pure.
 */

export type PoolNumber = {
  id: string;
  number: string;
  numberType: string; // NumberType enum value
  dailyCallCap: number | null;
  lifetimeCallCap: number | null;
  dailyCallsUsed: number;
  lifetimeCallsUsed: number;
};

export function isDailyCapped(n: PoolNumber): boolean {
  return n.dailyCallCap !== null && n.dailyCallsUsed >= n.dailyCallCap;
}

export function isLifetimeCapped(n: PoolNumber): boolean {
  return n.lifetimeCallCap !== null && n.lifetimeCallsUsed >= n.lifetimeCallCap;
}

export function isCapped(n: PoolNumber): boolean {
  return isDailyCapped(n) || isLifetimeCapped(n);
}

/**
 * Pick the next uncapped number strictly AFTER `lastUsedId` in list order
 * (wraps around). null when every number is capped or the pool is empty.
 */
export function pickNumberRoundRobin(numbers: PoolNumber[], lastUsedId: string | null): PoolNumber | null {
  if (numbers.length === 0) return null;
  const lastIdx = lastUsedId === null ? -1 : numbers.findIndex((n) => n.id === lastUsedId);
  for (let i = 1; i <= numbers.length; i++) {
    const candidate = numbers[(lastIdx + i) % numbers.length];
    if (!isCapped(candidate)) return candidate;
  }
  return null;
}
```

### 3f — `src/lib/campaign/compliance.ts` (TRAI series mapping + consent + DNC helpers)

```ts
/**
 * TRAI/TCPA compliance (readme §6.1 + §11):
 * - Campaign type → required number series. 140 = promotional, 1600 = service/
 *   transactional. Enforced at campaign start (Step 6) against the pool's numbers.
 * - TCPA-style consent: promotional campaigns may require Contact.consentAt
 *   (env REQUIRE_CONSENT_FOR_PROMOTIONAL).
 * - DNC scrub helper (pure part of import/dial-time scrubbing).
 */

export type SeriesClass = "PROMOTIONAL" | "SERVICE";

export const CAMPAIGN_TYPE_SERIES: Record<string, SeriesClass> = {
  LEAD_QUALIFICATION: "PROMOTIONAL", // cold/warm outreach
  APPOINTMENT_REMINDER: "SERVICE", // existing relationship
  PAYMENT_REMINDER: "SERVICE", // transactional (EMI/dues)
  FEEDBACK_SURVEY: "SERVICE", // post-transaction
  ORDER_CONFIRMATION: "SERVICE", // transactional
  REACTIVATION: "PROMOTIONAL", // win-back marketing
  EVENT_INVITE: "PROMOTIONAL", // marketing invite
  POLITICAL_SURVEY: "PROMOTIONAL", // outreach
};

/** NumberType values allowed for a campaign type. Non-India types are always allowed
 *  (international DIDs are not TRAI-regulated; tenant is responsible for local law). */
export function allowedNumberTypes(campaignType: string): string[] {
  const cls = CAMPAIGN_TYPE_SERIES[campaignType] ?? "PROMOTIONAL";
  const india = cls === "PROMOTIONAL" ? ["SERIES_140"] : ["SERIES_1600"];
  return [...india, "LOCAL", "TOLLFREE", "MOBILE"];
}

export function isNumberTypeAllowed(campaignType: string, numberType: string): boolean {
  return allowedNumberTypes(campaignType).includes(numberType);
}

/** Promotional campaigns are the consent-gated ones (TCPA-style, readme §11). */
export function requiresConsent(campaignType: string): boolean {
  return CAMPAIGN_TYPE_SERIES[campaignType] === "PROMOTIONAL";
}

export function hasValidConsent(contact: { consentAt: Date | null }): boolean {
  return contact.consentAt !== null;
}

/** Should this contact be blocked for missing consent right now? */
export function consentBlocks(contact: { consentAt: Date | null }, campaignType: string, enforcementOn: boolean): boolean {
  return enforcementOn && requiresConsent(campaignType) && !hasValidConsent(contact);
}

/** Pure DNC scrub: partition phones into dialable / blocked by a DNC set. */
export function scrubAgainstDnc<T extends { phone: string }>(
  rows: T[],
  dncPhones: ReadonlySet<string>
): { dialable: T[]; blocked: T[] } {
  const dialable: T[] = [];
  const blocked: T[] = [];
  for (const r of rows) (dncPhones.has(r.phone) ? blocked : dialable).push(r);
  return { dialable, blocked };
}

/** True when the pool uses the promotional series (drives the TRAI-hours guardrail). */
export function poolUsesPromotionalSeries(numbers: { numberType: string }[]): boolean {
  return numbers.some((n) => n.numberType === "SERIES_140");
}
```

### 3g — Unit tests for 3a–3f

**File `tests/campaign-phone.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  classifyIndianDid,
  isIndianMobile,
  isValidDidForType,
  isValidE164,
  normalizePhone,
} from "../src/lib/campaign/phone";

describe("normalizePhone", () => {
  it("keeps valid E.164", () => {
    expect(normalizePhone("+919812345678")).toBe("+919812345678");
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });
  it("converts Indian 10-digit mobiles to +91", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
  });
  it("rejects junk and landlines", () => {
    expect(normalizePhone("bad-row")).toBeNull();
    expect(normalizePhone("08023456789")).toBeNull(); // landline: not a mobile series
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("isValidE164 / isIndianMobile", () => {
  it("validates", () => {
    expect(isValidE164("+919812345678")).toBe(true);
    expect(isValidE164("9812345678")).toBe(false);
    expect(isValidE164("+0123")).toBe(false);
    expect(isIndianMobile("+919812345678")).toBe(true);
    expect(isIndianMobile("+911401234567")).toBe(false); // DID series, not mobile
    expect(isIndianMobile("+14155552671")).toBe(false);
  });
});

describe("classifyIndianDid / isValidDidForType", () => {
  it("classifies TRAI series", () => {
    expect(classifyIndianDid("+911401234567")).toBe("140");
    expect(classifyIndianDid("+911600123456")).toBe("1600");
    expect(classifyIndianDid("+918040001234")).toBe("other");
  });
  it("enforces series rules on pool DIDs", () => {
    expect(isValidDidForType("+911401234567", "SERIES_140")).toBe(true);
    expect(isValidDidForType("+911600123456", "SERIES_140")).toBe(false);
    expect(isValidDidForType("+911600123456", "SERIES_1600")).toBe(true);
    expect(isValidDidForType("+918040001234", "LOCAL")).toBe(true);
    expect(isValidDidForType("not-a-number", "LOCAL")).toBe(false);
  });
});
```

**File `tests/campaign-windows.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  effectiveTimezone,
  isWithinCallingWindows,
  isWithinTraiHours,
  localDay,
  localHHMM,
  parseTimezoneWindows,
} from "../src/lib/campaign/windows";

// Fixed clock: 2025-07-07 is a Monday. 10:00 UTC = 15:30 IST = 08:30 San Francisco (PDT).
const MON_1000_UTC = new Date("2025-07-07T10:00:00Z");
// 2025-07-12 is a Saturday.
const SAT_1000_UTC = new Date("2025-07-12T10:00:00Z");

describe("localHHMM / localDay", () => {
  it("formats in the requested timezone", () => {
    expect(localHHMM(MON_1000_UTC, "Asia/Kolkata")).toBe("15:30");
    expect(localHHMM(MON_1000_UTC, "America/Los_Angeles")).toBe("03:00");
    expect(localDay(MON_1000_UTC, "Asia/Kolkata")).toBe(1); // Monday
    expect(localDay(SAT_1000_UTC, "Asia/Kolkata")).toBe(6); // Saturday
  });
  it("falls back to Asia/Kolkata on a bogus timezone (never throws)", () => {
    expect(localHHMM(MON_1000_UTC, "Mars/Olympus")).toBe("15:30");
    expect(localDay(MON_1000_UTC, "Mars/Olympus")).toBe(1);
  });
});

describe("parseTimezoneWindows", () => {
  it("parses a full JSON config", () => {
    const tw = parseTimezoneWindows({
      timezone: "Asia/Kolkata",
      days: [1, 2, 3, 4, 5],
      windows: [["09:00", "13:00"], ["16:00", "19:00"]],
    });
    expect(tw).toEqual({ timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5], windows: [["09:00", "13:00"], ["16:00", "19:00"]] });
  });
  it("drops garbage entries and returns null for unusable input", () => {
    expect(parseTimezoneWindows(null)).toBeNull();
    expect(parseTimezoneWindows("x")).toBeNull();
    expect(parseTimezoneWindows({ days: ["Mon"] })).toBeNull();
    expect(parseTimezoneWindows({ days: [1, 99], windows: [["9am", "5pm"]] })).toEqual({ days: [1] });
  });
});

describe("isWithinCallingWindows", () => {
  const base = { windowStart: "09:00", windowEnd: "19:00" };
  it("honors campaign window in contact timezone", () => {
    // 15:30 IST inside 09–19
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: "Asia/Kolkata", ...base })).toBe(true);
    // 03:00 in LA outside 09–19 (contact in LA)
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: "America/Los_Angeles", ...base })).toBe(false);
  });
  it("falls back to the campaign JSON timezone, then Asia/Kolkata", () => {
    const tw = parseTimezoneWindows({ timezone: "America/Los_Angeles" });
    expect(effectiveTimezone({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: tw })).toBe("America/Los_Angeles");
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: tw })).toBe(false);
    expect(effectiveTimezone({ now: MON_1000_UTC, contactTimezone: null, ...base })).toBe("Asia/Kolkata");
  });
  it("enforces day-of-week rules", () => {
    const weekdays = parseTimezoneWindows({ timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5] });
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: weekdays })).toBe(true);
    expect(isWithinCallingWindows({ now: SAT_1000_UTC, contactTimezone: null, ...base, timezoneWindows: weekdays })).toBe(false);
  });
  it("honors split windows", () => {
    const split = parseTimezoneWindows({ timezone: "Asia/Kolkata", windows: [["09:00", "13:00"], ["16:00", "19:00"]] });
    // 15:30 IST is in the lunch gap
    expect(isWithinCallingWindows({ now: MON_1000_UTC, contactTimezone: null, ...base, timezoneWindows: split })).toBe(false);
    // 11:30 UTC = 17:00 IST → inside evening window
    expect(isWithinCallingWindows({ now: new Date("2025-07-07T11:30:00Z"), contactTimezone: null, ...base, timezoneWindows: split })).toBe(true);
  });
});

describe("isWithinTraiHours (09:00–21:00 contact-local)", () => {
  it("allows inside, blocks outside", () => {
    expect(isWithinTraiHours(MON_1000_UTC, "Asia/Kolkata")).toBe(true); // 15:30
    expect(isWithinTraiHours(new Date("2025-07-07T02:30:00Z"), "Asia/Kolkata")).toBe(false); // 08:00
    expect(isWithinTraiHours(new Date("2025-07-07T16:00:00Z"), "Asia/Kolkata")).toBe(false); // 21:30
  });
  it("boundary: 09:00 allowed, 21:00 blocked", () => {
    expect(isWithinTraiHours(new Date("2025-07-07T03:30:00Z"), "Asia/Kolkata")).toBe(true); // 09:00
    expect(isWithinTraiHours(new Date("2025-07-07T15:30:00Z"), "Asia/Kolkata")).toBe(false); // 21:00
  });
});
```

**File `tests/campaign-retry.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  computeNextRetry,
  computeRetryDelayMs,
  isDisposition,
  parseCampaignExtras,
  parseRetryPolicy,
  resolveRetryRule,
  shouldRetry,
} from "../src/lib/campaign/retry";

const DEFAULTS = { maxAttempts: 2, retryDelayMin: 60 };
const NO_JITTER = () => 0.5; // jitter factor exactly 1.0

describe("parseRetryPolicy", () => {
  it("parses per-disposition overrides and keeps extras separate", () => {
    const p = parseRetryPolicy({
      busy: { attempts: 3, delayMin: 30 },
      "no-answer": { attempts: 2, delayMin: 120 },
      voicemail: { attempts: 1, delayMin: 1440 },
      whatsappFallbackTemplateId: "tpl_1",
    });
    expect(p.busy).toEqual({ attempts: 3, delayMin: 30 });
    expect(p["no-answer"]).toEqual({ attempts: 2, delayMin: 120 });
    expect(p.voicemail).toEqual({ attempts: 1, delayMin: 1440 });
    expect(p.failed).toBeUndefined();
  });
  it("rejects invalid rules and junk input", () => {
    expect(parseRetryPolicy(null)).toEqual({});
    expect(parseRetryPolicy({ busy: { attempts: 0, delayMin: 30 } })).toEqual({});
    expect(parseRetryPolicy({ busy: { attempts: 3, delayMin: 1 } })).toEqual({}); // below 5 min
    expect(parseRetryPolicy({ nope: { attempts: 3, delayMin: 30 } })).toEqual({});
  });
  it("parseCampaignExtras reads the WhatsApp fallback template", () => {
    expect(parseCampaignExtras({ whatsappFallbackTemplateId: "tpl_1" })).toEqual({ whatsappFallbackTemplateId: "tpl_1" });
    expect(parseCampaignExtras({})).toEqual({});
    expect(parseCampaignExtras(null)).toEqual({});
  });
});

describe("isDisposition / resolveRetryRule / shouldRetry", () => {
  const policy = parseRetryPolicy({ busy: { attempts: 3, delayMin: 30 } });
  it("validates dispositions", () => {
    expect(isDisposition("busy")).toBe(true);
    expect(isDisposition("voicemail")).toBe(true);
    expect(isDisposition("completed")).toBe(false);
  });
  it("override wins; fallback uses campaign defaults", () => {
    expect(resolveRetryRule(policy, "busy", DEFAULTS)).toEqual({ attempts: 3, delayMin: 30 });
    expect(resolveRetryRule(policy, "no-answer", DEFAULTS)).toEqual({ attempts: 2, delayMin: 60 });
  });
  it("shouldRetry respects per-disposition attempts", () => {
    expect(shouldRetry(policy, "busy", 2, DEFAULTS)).toBe(true); // 2 < 3
    expect(shouldRetry(policy, "busy", 3, DEFAULTS)).toBe(false);
    expect(shouldRetry(policy, "no-answer", 1, DEFAULTS)).toBe(true); // 1 < 2 (default)
    expect(shouldRetry(policy, "no-answer", 2, DEFAULTS)).toBe(false);
  });
});

describe("computeRetryDelayMs (exponential + jitter)", () => {
  it("doubles per attempt, no jitter when rand=0.5", () => {
    expect(computeRetryDelayMs(30, 1, NO_JITTER)).toBe(30 * 60_000);
    expect(computeRetryDelayMs(30, 2, NO_JITTER)).toBe(60 * 60_000);
    expect(computeRetryDelayMs(30, 3, NO_JITTER)).toBe(120 * 60_000);
  });
  it("caps at 24h", () => {
    expect(computeRetryDelayMs(1440, 5, NO_JITTER)).toBe(1440 * 60_000);
  });
  it("jitter stays within ±20%", () => {
    const lo = computeRetryDelayMs(60, 1, () => 0);
    const hi = computeRetryDelayMs(60, 1, () => 0.999);
    expect(lo).toBe(Math.round(60 * 0.8 * 60_000));
    expect(hi).toBeLessThanOrEqual(Math.round(60 * 1.2 * 60_000));
  });
});

describe("computeNextRetry", () => {
  const now = new Date("2025-07-07T10:00:00Z");
  it("schedules the next attempt with the override delay", () => {
    const policy = parseRetryPolicy({ busy: { attempts: 3, delayMin: 30 } });
    const r = computeNextRetry(policy, "busy", 1, DEFAULTS, now, NO_JITTER);
    expect(r.retry).toBe(true);
    expect(r.nextAttemptAt?.toISOString()).toBe("2025-07-07T10:30:00.000Z");
  });
  it("final attempt → no retry", () => {
    const r = computeNextRetry({}, "no-answer", 2, DEFAULTS, now, NO_JITTER);
    expect(r).toEqual({ retry: false, nextAttemptAt: null });
  });
});
```

**File `tests/campaign-pacing.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  adaptiveCpm,
  answerRateFromCalls,
  DIAL_AHEAD_RATIO,
  predictiveSlots,
  rampCpm,
  tickBatchSize,
} from "../src/lib/campaign/pacing";

const T0 = new Date("2025-07-07T10:00:00Z");
const after = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("rampCpm (progressive ramp-up)", () => {
  const opts = { capCpm: 32, startedAt: T0, startCpm: 2, doubleEveryMin: 10 };
  it("starts low, doubles every N minutes, stops at the cap", () => {
    expect(rampCpm({ ...opts, now: T0 })).toBe(2);
    expect(rampCpm({ ...opts, now: after(9) })).toBe(2);
    expect(rampCpm({ ...opts, now: after(10) })).toBe(4);
    expect(rampCpm({ ...opts, now: after(20) })).toBe(8);
    expect(rampCpm({ ...opts, now: after(30) })).toBe(16);
    expect(rampCpm({ ...opts, now: after(40) })).toBe(32); // cap reached
    expect(rampCpm({ ...opts, now: after(400) })).toBe(32); // stays at cap
  });
  it("never exceeds the cap even with a high start", () => {
    expect(rampCpm({ capCpm: 5, startedAt: T0, now: after(60), startCpm: 4, doubleEveryMin: 10 })).toBe(5);
  });
});

describe("answerRateFromCalls + adaptiveCpm", () => {
  const calls = (answered: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ answeredAt: i < answered ? new Date() : null }));
  it("returns null below the sample threshold", () => {
    expect(answerRateFromCalls(calls(3, 9))).toBeNull();
    expect(answerRateFromCalls([])).toBeNull();
  });
  it("computes the rolling rate", () => {
    expect(answerRateFromCalls(calls(3, 10))).toBe(0.3);
    expect(answerRateFromCalls(calls(0, 50))).toBe(0);
  });
  it("halves CPS below the threshold, floors at 1, unchanged otherwise", () => {
    expect(adaptiveCpm(20, 0.1, 0.2)).toBe(10);
    expect(adaptiveCpm(1, 0.1, 0.2)).toBe(1);
    expect(adaptiveCpm(20, 0.5, 0.2)).toBe(20);
    expect(adaptiveCpm(20, null, 0.2)).toBe(20); // not enough data → no change
  });
});

describe("tickBatchSize", () => {
  it("scales the 30s tick with CPS, minimum 1", () => {
    expect(tickBatchSize(60)).toBe(30);
    expect(tickBatchSize(10)).toBe(5);
    expect(tickBatchSize(1)).toBe(1);
  });
});

describe("predictiveSlots (readme §15)", () => {
  it("normal mode: free slots = concurrency − inFlight, never negative", () => {
    expect(predictiveSlots({ concurrency: 4, inFlight: 1, predictive: false })).toBe(3);
    expect(predictiveSlots({ concurrency: 4, inFlight: 4, predictive: false })).toBe(0);
    expect(predictiveSlots({ concurrency: 4, inFlight: 9, predictive: false })).toBe(0);
  });
  it("predictive mode over-books at the dial-ahead ratio", () => {
    expect(DIAL_AHEAD_RATIO).toBe(1.5);
    expect(predictiveSlots({ concurrency: 4, inFlight: 0, predictive: true })).toBe(6); // floor(4×1.5)
    expect(predictiveSlots({ concurrency: 4, inFlight: 5, predictive: true })).toBe(1);
    expect(predictiveSlots({ concurrency: 4, inFlight: 6, predictive: true })).toBe(0);
  });
  it("predictive with concurrency 1 still allows at least the base slot", () => {
    expect(predictiveSlots({ concurrency: 1, inFlight: 0, predictive: true })).toBe(1);
  });
});
```

**File `tests/campaign-pool-compliance.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { isCapped, pickNumberRoundRobin, type PoolNumber } from "../src/lib/campaign/pool";
import {
  allowedNumberTypes,
  CAMPAIGN_TYPE_SERIES,
  consentBlocks,
  isNumberTypeAllowed,
  poolUsesPromotionalSeries,
  requiresConsent,
  scrubAgainstDnc,
} from "../src/lib/campaign/compliance";

const num = (id: string, over: Partial<PoolNumber> = {}): PoolNumber => ({
  id,
  number: `+9114000000${id}`,
  numberType: "SERIES_140",
  dailyCallCap: null,
  lifetimeCallCap: null,
  dailyCallsUsed: 0,
  lifetimeCallsUsed: 0,
  ...over,
});

describe("pool caps + round-robin", () => {
  it("detects capped numbers", () => {
    expect(isCapped(num("a", { dailyCallCap: 100, dailyCallsUsed: 100 }))).toBe(true);
    expect(isCapped(num("a", { dailyCallCap: 100, dailyCallsUsed: 99 }))).toBe(false);
    expect(isCapped(num("a", { lifetimeCallCap: 5000, lifetimeCallsUsed: 5000 }))).toBe(true);
    expect(isCapped(num("a"))).toBe(false); // no caps = never capped
  });
  it("rotates strictly after lastUsedId and skips capped numbers", () => {
    const a = num("a");
    const b = num("b", { dailyCallCap: 1, dailyCallsUsed: 1 }); // capped
    const c = num("c");
    expect(pickNumberRoundRobin([a, b, c], null)?.id).toBe("a");
    expect(pickNumberRoundRobin([a, b, c], "a")?.id).toBe("c"); // b skipped
    expect(pickNumberRoundRobin([a, b, c], "c")?.id).toBe("a"); // wraps
  });
  it("returns null when the pool is exhausted or empty", () => {
    expect(pickNumberRoundRobin([], null)).toBeNull();
    expect(pickNumberRoundRobin([num("a", { dailyCallCap: 1, dailyCallsUsed: 1 })], null)).toBeNull();
  });
});

describe("campaign type → TRAI series mapping", () => {
  it("maps all 8 types", () => {
    expect(Object.keys(CAMPAIGN_TYPE_SERIES).sort()).toEqual([
      "APPOINTMENT_REMINDER", "EVENT_INVITE", "FEEDBACK_SURVEY", "LEAD_QUALIFICATION",
      "ORDER_CONFIRMATION", "PAYMENT_REMINDER", "POLITICAL_SURVEY", "REACTIVATION",
    ].sort());
    expect(CAMPAIGN_TYPE_SERIES.PAYMENT_REMINDER).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.APPOINTMENT_REMINDER).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.ORDER_CONFIRMATION).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.FEEDBACK_SURVEY).toBe("SERVICE");
    expect(CAMPAIGN_TYPE_SERIES.LEAD_QUALIFICATION).toBe("PROMOTIONAL");
    expect(CAMPAIGN_TYPE_SERIES.REACTIVATION).toBe("PROMOTIONAL");
    expect(CAMPAIGN_TYPE_SERIES.EVENT_INVITE).toBe("PROMOTIONAL");
    expect(CAMPAIGN_TYPE_SERIES.POLITICAL_SURVEY).toBe("PROMOTIONAL");
  });
  it("allows 140 for promotional, 1600 for service, international DIDs for both", () => {
    expect(allowedNumberTypes("PAYMENT_REMINDER")).toContain("SERIES_1600");
    expect(allowedNumberTypes("PAYMENT_REMINDER")).not.toContain("SERIES_140");
    expect(isNumberTypeAllowed("LEAD_QUALIFICATION", "SERIES_140")).toBe(true);
    expect(isNumberTypeAllowed("LEAD_QUALIFICATION", "SERIES_1600")).toBe(false);
    expect(isNumberTypeAllowed("LEAD_QUALIFICATION", "LOCAL")).toBe(true); // non-India ok
  });
});

describe("consent (TCPA-style)", () => {
  it("only promotional types require consent", () => {
    expect(requiresConsent("LEAD_QUALIFICATION")).toBe(true);
    expect(requiresConsent("PAYMENT_REMINDER")).toBe(false);
  });
  it("blocks only when enforcement is on, type is promotional, consent missing", () => {
    const noConsent = { consentAt: null };
    const withConsent = { consentAt: new Date() };
    expect(consentBlocks(noConsent, "LEAD_QUALIFICATION", true)).toBe(true);
    expect(consentBlocks(withConsent, "LEAD_QUALIFICATION", true)).toBe(false);
    expect(consentBlocks(noConsent, "LEAD_QUALIFICATION", false)).toBe(false); // enforcement off
    expect(consentBlocks(noConsent, "PAYMENT_REMINDER", true)).toBe(false); // service type
  });
});

describe("scrubAgainstDnc", () => {
  it("partitions dialable vs blocked", () => {
    const rows = [{ phone: "+911" }, { phone: "+912" }, { phone: "+913" }];
    const { dialable, blocked } = scrubAgainstDnc(rows, new Set(["+912"]));
    expect(dialable.map((r) => r.phone)).toEqual(["+911", "+913"]);
    expect(blocked.map((r) => r.phone)).toEqual(["+912"]);
  });
});

describe("poolUsesPromotionalSeries", () => {
  it("drives the TRAI-hours guardrail", () => {
    expect(poolUsesPromotionalSeries([{ numberType: "SERIES_140" }])).toBe(true);
    expect(poolUsesPromotionalSeries([{ numberType: "SERIES_1600" }, { numberType: "LOCAL" }])).toBe(false);
  });
});
```

**Verify (run the whole new suite):**
```bash
cd /root/vaani-ai && npx vitest run tests/campaign-phone.test.ts tests/campaign-windows.test.ts tests/campaign-retry.test.ts tests/campaign-pacing.test.ts tests/campaign-pool-compliance.test.ts
```
**Expected:** 5 files pass, ~45 tests, 0 failures.
**If it fails:** read the first failing assertion; the functions are copied wrong
(diff against the guide). Fix by re-creating the library file EXACTLY, once. A
timezone failure (`localHHMM` wrong) means the VPS `tzdata` is missing →
`sudo apt-get install -y tzdata` then re-run once. Still failing → STOP and report.

---

## Step 4: Conversation intelligence libraries (scoring, callbacks, opt-out, sentiment)

The post-call sweep (Step 10) uses an LLM (OpenRouter direct, cheap model) for
interest scoring and callback-time extraction; opt-out and anger detection are
deterministic (regex + structured call fields — no LLM needed, no hallucination risk
on a compliance path). Prompt builders and response parsers are pure and unit-tested
with mocked LLM outputs.

**File `src/lib/openrouter.ts`** (full content):

```ts
/**
 * Minimal OpenRouter chat-completions client for post-call intelligence
 * (interest scoring, callback extraction). Direct fetch — no SDK.
 * Key: OPENROUTER_API_KEY (guide 04). Model: OPENROUTER_SCORING_MODEL
 * (default meta-llama/llama-3.1-8b-instruct — cheap classification).
 */

export class OpenRouterError extends Error {
  constructor(public status: number, message: string) {
    super(`OpenRouter ${status}: ${message}`);
  }
}

export async function callOpenRouterJson(input: {
  system: string;
  user: string;
  model?: string;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) throw new OpenRouterError(0, "OPENROUTER_API_KEY not set");
  const model = input.model ?? process.env.OPENROUTER_SCORING_MODEL ?? "meta-llama/llama-3.1-8b-instruct";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
      "X-Title": "Vaani AI post-call intelligence",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 300,
    }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new OpenRouterError(res.status, text.slice(0, 500));
  const parsed = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new OpenRouterError(0, "empty completion");
  return content;
}
```

**File `src/lib/campaign/scoring.ts`** (full content):

```ts
/**
 * Post-call conversation intelligence (readme §6.2):
 * - Interest scoring: hot/warm/cold + reason (LLM, parser is pure).
 * - Callback scheduling: "call me tomorrow at 5" → absolute dueAt (LLM resolves the
 *   natural-language hint to ISO using the contact's timezone; parser validates).
 * - Opt-out detection: deterministic on Call.outcome + transcript phrases (§11:
 *   "stop calling me" honored instantly).
 * - Sentiment escalation: negative sentiment / abuse → human flag.
 */

export type InterestScoreValue = "HOT" | "WARM" | "COLD";

// ---------- Interest scoring ----------

export function buildInterestPrompt(input: { transcript: string; campaignType: string }): {
  system: string;
  user: string;
} {
  return {
    system:
      "You classify outbound sales/service calls. Reply with ONLY a JSON object " +
      '{"score":"HOT"|"WARM"|"COLD","reason":"one short sentence"}. ' +
      "HOT = caller explicitly agreed to next step (booking, payment, demo, callback with intent). " +
      "WARM = caller engaged, asked questions, no commitment. " +
      "COLD = refusal, disinterest, wrong number, or no conversation.",
    user: `Campaign type: ${input.campaignType}\n\nTranscript:\n${input.transcript.slice(0, 4000)}`,
  };
}

/** Parse the LLM JSON. null on any deviation (caller treats null as "skip scoring"). */
export function parseInterestScore(text: string): { score: InterestScoreValue; reason: string } | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const score = o.score;
    const reason = o.reason;
    if (score !== "HOT" && score !== "WARM" && score !== "COLD") return null;
    if (typeof reason !== "string" || reason.length === 0) return null;
    return { score, reason: reason.slice(0, 300) };
  } catch {
    return null;
  }
}

// ---------- Callback scheduling ----------

export function buildCallbackPrompt(input: {
  transcript: string;
  nowIso: string;
  timezone: string;
}): { system: string; user: string } {
  return {
    system:
      "You detect callback requests in phone call transcripts. Reply with ONLY a JSON object " +
      '{"callbackRequested":boolean,"dueAt":"ISO 8601 timestamp or null","note":"short reason or null"}. ' +
      "Resolve relative hints (\"tomorrow at 5\", \"Monday morning\") against the provided current time " +
      "and caller timezone. Morning = 10:00, afternoon = 14:00, evening = 17:00 local. " +
      "dueAt must be in the future and within 30 days. If no callback was requested, dueAt is null.",
    user:
      `Current time: ${input.nowIso}\nCaller timezone: ${input.timezone}\n\n` +
      `Transcript:\n${input.transcript.slice(0, 4000)}`,
  };
}

export type CallbackExtraction = { requested: boolean; dueAt?: Date; note?: string };

/**
 * Parse + validate the LLM JSON. `now` injected. Rejects past dates, dates >30 days
 * out, and malformed payloads (returns { requested: false } — safe default).
 */
export function parseCallbackRequest(text: string, now: Date): CallbackExtraction {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (o.callbackRequested !== true) return { requested: false };
    if (typeof o.dueAt !== "string") return { requested: false };
    const dueAt = new Date(o.dueAt);
    if (Number.isNaN(dueAt.getTime())) return { requested: false };
    if (dueAt.getTime() <= now.getTime()) return { requested: false };
    const maxFuture = now.getTime() + 30 * 24 * 60 * 60_000;
    if (dueAt.getTime() > maxFuture) return { requested: false };
    return {
      requested: true,
      dueAt,
      note: typeof o.note === "string" && o.note.length > 0 ? o.note.slice(0, 200) : undefined,
    };
  } catch {
    return { requested: false };
  }
}

// ---------- Opt-out detection (deterministic — compliance path, no LLM) ----------

const OPT_OUT_PATTERNS = [
  /stop calling/i,
  /don'?t call/i,
  /do not call/i,
  /remove (me|my number)/i,
  /opt[ -]?out/i,
  /unsubscribe/i,
  /never call/i,
  /मुझे कॉल मत करो/,
  /मुझे फोन मत करो/,
];

/** True when the caller opted out. Structured outcome wins; else transcript phrases. */
export function detectOptOut(input: { outcome?: string | null; transcript?: string | null }): boolean {
  if (input.outcome === "opt-out") return true;
  const t = input.transcript ?? "";
  return OPT_OUT_PATTERNS.some((p) => p.test(t));
}

// ---------- Sentiment escalation (deterministic) ----------

const ABUSE_PATTERNS = [
  /\b(bloody|damn|hell|stupid|idiot|shut up|fraud|cheat|scam)\b/i,
  /बकवास|धोखा/,
];

/** True when the call should be flagged for a human (polite exit already happened
 *  mid-call via the agent's playbook; this creates the TransferRequest after). */
export function needsHumanEscalation(input: {
  sentiment?: string | null;
  outcome?: string | null;
  transcript?: string | null;
}): boolean {
  if (input.outcome === "escalate-to-human") return true;
  if (input.sentiment === "negative") return true;
  const t = input.transcript ?? "";
  return ABUSE_PATTERNS.some((p) => p.test(t));
}
```

**File `tests/campaign-scoring.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  buildCallbackPrompt,
  buildInterestPrompt,
  detectOptOut,
  needsHumanEscalation,
  parseCallbackRequest,
  parseInterestScore,
} from "../src/lib/campaign/scoring";

const NOW = new Date("2025-07-07T10:00:00Z"); // Monday 15:30 IST

describe("interest scoring", () => {
  it("prompt carries the campaign type and transcript", () => {
    const p = buildInterestPrompt({ transcript: "caller: yes book it", campaignType: "LEAD_QUALIFICATION" });
    expect(p.system).toContain("HOT");
    expect(p.user).toContain("LEAD_QUALIFICATION");
    expect(p.user).toContain("yes book it");
  });
  it("parses valid LLM JSON (mock)", () => {
    expect(parseInterestScore('{"score":"HOT","reason":"agreed to a demo on Friday"}'))
      .toEqual({ score: "HOT", reason: "agreed to a demo on Friday" });
    expect(parseInterestScore('{"score":"COLD","reason":"said not interested"}')?.score).toBe("COLD");
  });
  it("rejects malformed LLM output safely", () => {
    expect(parseInterestScore("not json")).toBeNull();
    expect(parseInterestScore('{"score":"LUKEWARM","reason":"x"}')).toBeNull();
    expect(parseInterestScore('{"score":"HOT"}')).toBeNull();
    expect(parseInterestScore("{}")).toBeNull();
  });
});

describe("callback extraction (mock LLM)", () => {
  it("prompt pins current time + timezone for absolute resolution", () => {
    const p = buildCallbackPrompt({ transcript: "call me tomorrow at 5", nowIso: NOW.toISOString(), timezone: "Asia/Kolkata" });
    expect(p.user).toContain("2025-07-07T10:00:00.000Z");
    expect(p.user).toContain("Asia/Kolkata");
    expect(p.system).toContain("ISO 8601");
  });
  it("accepts a valid future dueAt ('tomorrow at 5pm IST' resolved by the LLM)", () => {
    const r = parseCallbackRequest(
      '{"callbackRequested":true,"dueAt":"2025-07-08T17:00:00+05:30","note":"call me tomorrow at 5"}',
      NOW
    );
    expect(r.requested).toBe(true);
    expect(r.dueAt?.toISOString()).toBe("2025-07-08T11:30:00.000Z");
    expect(r.note).toBe("call me tomorrow at 5");
  });
  it("no callback → requested:false", () => {
    expect(parseCallbackRequest('{"callbackRequested":false,"dueAt":null,"note":null}', NOW))
      .toEqual({ requested: false });
  });
  it("rejects past dates, far-future dates, and garbage (safe default)", () => {
    expect(parseCallbackRequest('{"callbackRequested":true,"dueAt":"2025-07-06T17:00:00Z"}', NOW).requested).toBe(false);
    expect(parseCallbackRequest('{"callbackRequested":true,"dueAt":"2026-01-01T00:00:00Z"}', NOW).requested).toBe(false);
    expect(parseCallbackRequest('{"callbackRequested":true,"dueAt":"next tuesday lol"}', NOW).requested).toBe(false);
    expect(parseCallbackRequest("garbage", NOW).requested).toBe(false);
    expect(parseCallbackRequest('{"callbackRequested":true}', NOW).requested).toBe(false);
  });
});

describe("opt-out detection (§11 instant opt-out)", () => {
  it("structured outcome wins", () => {
    expect(detectOptOut({ outcome: "opt-out", transcript: null })).toBe(true);
  });
  it("catches English + Hindi phrases", () => {
    expect(detectOptOut({ transcript: "please stop calling me" })).toBe(true);
    expect(detectOptOut({ transcript: "Don't call this number again" })).toBe(true);
    expect(detectOptOut({ transcript: "मुझे कॉल मत करो" })).toBe(true);
    expect(detectOptOut({ transcript: "I want to unsubscribe from these calls" })).toBe(true);
  });
  it("does not false-positive on normal speech", () => {
    expect(detectOptOut({ transcript: "yes, tell me more about the plan" })).toBe(false);
    expect(detectOptOut({ transcript: "call me tomorrow at 5" })).toBe(false);
    expect(detectOptOut({ transcript: null, outcome: "booked" })).toBe(false);
  });
});

describe("sentiment escalation", () => {
  it("flags negative sentiment, explicit escalation, and abuse", () => {
    expect(needsHumanEscalation({ sentiment: "negative" })).toBe(true);
    expect(needsHumanEscalation({ outcome: "escalate-to-human" })).toBe(true);
    expect(needsHumanEscalation({ transcript: "this is a scam, you people are frauds" })).toBe(true);
    expect(needsHumanEscalation({ sentiment: "positive", transcript: "great, thanks" })).toBe(false);
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/campaign-scoring.test.ts && npm run typecheck
```
**Expected:** tests pass; typecheck exit 0.

---

## Step 5: Campaign type presets (all 8, readme §6.1)

Each preset bundles: default retry policy, calling window, day-of-week rule, series
class (drives the pool check + consent gate), an opening hook, an objection playbook,
and a reference to the guide-05 template library (`src/lib/templates.ts`,
`AGENT_TEMPLATES`) the operator should base the agent on. Presets are defaults only —
every field stays editable in the new-campaign form.

**File `src/lib/campaign/presets.ts`** (full content):

```ts
/**
 * Campaign type presets (readme §6.1 "campaign types").
 * templateCode references AGENT_TEMPLATES in src/lib/templates.ts (guide 05).
 * openingHook / objectionPlaybook are injected into the Dograh call's
 * initial_context at dial time (Step 9) so the workflow prompt can use them.
 */

export type CampaignPreset = {
  type: string; // CampaignType enum value
  label: string;
  description: string;
  templateCode: string; // guide 05 AGENT_TEMPLATES code (agent starting point)
  retryPolicy: Record<string, { attempts: number; delayMin: number }>;
  windowStart: string;
  windowEnd: string;
  days: number[]; // 0=Sun
  openingHook: string;
  objectionPlaybook: string;
};

const IDENTITY =
  "Namaste, this is an automated call from {{business_name}}. " +
  "You are speaking with Vaani, our AI assistant, and this call may be recorded.";

export const CAMPAIGN_PRESETS: Record<string, CampaignPreset> = {
  LEAD_QUALIFICATION: {
    type: "LEAD_QUALIFICATION",
    label: "Lead qualification",
    description: "Call fresh leads, qualify interest, book the next step.",
    templateCode: "real-estate-qualifier",
    retryPolicy: { "no-answer": { attempts: 3, delayMin: 240 }, busy: { attempts: 3, delayMin: 60 }, voicemail: { attempts: 1, delayMin: 1440 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6],
    openingHook: `${IDENTITY} I'm calling about the enquiry you made — this takes under two minutes and could save you real money. Is now an okay time?`,
    objectionPlaybook:
      "If 'not interested': acknowledge, give ONE concrete benefit tied to their enquiry, ask a softer question. " +
      "If 'busy': offer to schedule a callback at their preferred time. " +
      "Never argue; two objections maximum, then close politely.",
  },
  APPOINTMENT_REMINDER: {
    type: "APPOINTMENT_REMINDER",
    label: "Appointment reminder",
    description: "Remind customers of upcoming appointments; offer reschedule.",
    templateCode: "clinic-receptionist",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 180 }, busy: { attempts: 2, delayMin: 45 } },
    windowStart: "09:00",
    windowEnd: "20:00",
    days: [1, 2, 3, 4, 5, 6, 0],
    openingHook: `${IDENTITY} This is a friendly reminder about your appointment on {{appointment_time}}. Are you able to make it?`,
    objectionPlaybook:
      "If they can't make it: offer the two nearest alternative slots. " +
      "If unsure: confirm you'll send a WhatsApp reminder with details. Keep it under 60 seconds.",
  },
  PAYMENT_REMINDER: {
    type: "PAYMENT_REMINDER",
    label: "Payment / EMI reminder",
    description: "Remind about due payments; share the payment link.",
    templateCode: "emi-reminder",
    retryPolicy: { "no-answer": { attempts: 3, delayMin: 360 }, busy: { attempts: 3, delayMin: 90 }, failed: { attempts: 2, delayMin: 240 } },
    windowStart: "09:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5],
    openingHook: `${IDENTITY} This is a courtesy reminder that your payment of {{amount_due}} is due on {{due_date}}. Would you like the payment link on WhatsApp?`,
    objectionPlaybook:
      "If 'already paid': apologize, confirm we'll verify and update records. " +
      "If financial difficulty: express understanding, note it, and offer a callback from the accounts team. " +
      "Never threaten; stay courteous per fair-practice norms.",
  },
  FEEDBACK_SURVEY: {
    type: "FEEDBACK_SURVEY",
    label: "Feedback / NPS survey",
    description: "Post-service feedback and NPS score collection.",
    templateCode: "nps-survey",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 480 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6],
    openingHook: `${IDENTITY} You recently used our service — could I take 60 seconds for two quick feedback questions? It genuinely improves our service.`,
    objectionPlaybook:
      "If rushed: ask for just the 0–10 score and skip the rest. " +
      "If unhappy: thank them sincerely, capture the reason verbatim, and flag for a human follow-up.",
  },
  ORDER_CONFIRMATION: {
    type: "ORDER_CONFIRMATION",
    label: "Order / delivery confirmation",
    description: "Confirm orders, COD verification, delivery preferences.",
    templateCode: "delivery-confirmation",
    retryPolicy: { "no-answer": { attempts: 3, delayMin: 240 }, busy: { attempts: 3, delayMin: 60 }, failed: { attempts: 2, delayMin: 120 } },
    windowStart: "09:00",
    windowEnd: "20:00",
    days: [1, 2, 3, 4, 5, 6, 0],
    openingHook: `${IDENTITY} I'm calling to confirm your order {{order_id}} before we ship it. Can you confirm your delivery address?`,
    objectionPlaybook:
      "If they didn't order: apologize, cancel the order flag, and note possible fraud. " +
      "If address confusion: read it back slowly, confirm pincode.",
  },
  REACTIVATION: {
    type: "REACTIVATION",
    label: "Reactivation / win-back",
    description: "Win back lapsed customers with an offer.",
    templateCode: "real-estate-qualifier",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 720 }, busy: { attempts: 2, delayMin: 240 } },
    windowStart: "11:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6],
    openingHook: `${IDENTITY} It's been a while since we served you, and we'd love to have you back — I have a special returning-customer offer. Got a minute?`,
    objectionPlaybook:
      "If 'why did I leave': acknowledge past issues honestly, state what's improved. " +
      "One offer only; if declined, ask if they'd like to stay on the list for future offers — a 'no' here is an opt-out, honor it.",
  },
  EVENT_INVITE: {
    type: "EVENT_INVITE",
    label: "Event invite",
    description: "Invite customers/prospects to events, webinars, launches.",
    templateCode: "restaurant-reservations",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 480 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5],
    openingHook: `${IDENTITY} You're invited to {{event_name}} on {{event_date}} — I can reserve your spot in 30 seconds. Interested?`,
    objectionPlaybook:
      "If tentative: offer to WhatsApp the invite link so they can decide later. " +
      "If declined: one gentle benefit line, then close warmly.",
  },
  POLITICAL_SURVEY: {
    type: "POLITICAL_SURVEY",
    label: "Political / survey campaign",
    description: "Opinion polls and survey outreach.",
    templateCode: "nps-survey",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 720 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6, 0],
    openingHook: `${IDENTITY} We're running a short public opinion survey in your area — three questions, two minutes, fully anonymous. Willing to participate?`,
    objectionPlaybook:
      "Neutrality is mandatory: never argue politics, never advocate. " +
      "If they decline: thank them and end immediately — surveys are always voluntary.",
  },
};

export const CAMPAIGN_TYPES = Object.keys(CAMPAIGN_PRESETS);

export function getPreset(type: string): CampaignPreset | null {
  return CAMPAIGN_PRESETS[type] ?? null;
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.

---

## Step 6: Server actions — contacts+, campaigns, pools, WhatsApp

### 6a — `src/server/actions/contacts.ts` (overwrite: CSV + DNC scrub + consent + CRM import)

Upgrades over the original: DNC scrubbing at import (skipped + counted against
`DncEntry`), `timezone`/`consent_at`/`consent_source` CSV columns, add-to-running-
campaign mode (`campaignId` of a DRAFT/RUNNING/PAUSED campaign), and CRM import via
guide 05's `getCrmProvider(...).pullUpdates()` (dry-run safe via `CRM_IMPORT_DRY_RUN`).
API sync of contacts is the public REST API — guide 08 owns it (nothing to build here).

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/campaign/phone";
import { scrubAgainstDnc } from "@/lib/campaign/compliance";
import { getCrmProvider } from "@/lib/integrations/crm";

export type ActionResult = {
  ok: boolean;
  error?: string;
  imported?: number;
  skipped?: number;
  dncSkipped?: number;
  listId?: string;
};

const TIMEZONES = /^[A-Za-z_]+\/[A-Za-z_]+$/; // cheap IANA shape check

type ParsedRow = {
  phone: string;
  name: string | null;
  timezone: string | null;
  consentAt: Date | null;
  consentSource: string | null;
  attributes: Record<string, string>;
};

/** Parse + validate the CSV. Skipped rows = bad phone.
 *  (Local to this "use server" file — server-action modules may only export
 *  async functions, so this stays private; CSV rules are pinned by the unit
 *  tests for src/lib/campaign/phone.ts and by the scripted import test.) */
function parseContactCsv(csvText: string): { rows: ParsedRow[]; skipped: number; error?: string } {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.data.length === 0) return { rows: [], skipped: 0, error: "CSV has no data rows." };
  if (parsed.data.length > 10_000) return { rows: [], skipped: 0, error: "Max 10,000 rows per upload." };

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const phone = normalizePhone(row.phone ?? row.mobile ?? row.number ?? "");
    if (!phone) { skipped++; continue; }
    const tz = (row.timezone ?? "").trim();
    const consentRaw = (row.consent_at ?? row.consent ?? "").trim().toLowerCase();
    const consentDate = consentRaw ? new Date(consentRaw) : null;
    const consentAt =
      consentDate && !Number.isNaN(consentDate.getTime()) ? consentDate
      : ["yes", "true", "1"].includes(consentRaw) ? new Date()
      : null;
    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!["phone", "mobile", "number", "name", "timezone", "consent_at", "consent", "consent_source"].includes(k) && v) {
        attributes[k] = v;
      }
    }
    rows.push({
      phone,
      name: (row.name ?? "").trim() || null,
      timezone: TIMEZONES.test(tz) ? tz : null,
      consentAt,
      consentSource: consentAt ? ((row.consent_source ?? "").trim() || "csv-upload") : null,
      attributes,
    });
  }
  return { rows, skipped };
}

/** Load the workspace's DNC phone set (DncEntry + opt-out contacts). */
async function loadDncSet(workspaceId: string): Promise<Set<string>> {
  const [entries, optedOut] = await Promise.all([
    db.dncEntry.findMany({ where: { workspaceId }, select: { phone: true } }),
    db.contact.findMany({ where: { workspaceId, optOutAt: { not: null } }, select: { phone: true } }),
  ]);
  return new Set([...entries.map((e) => e.phone), ...optedOut.map((c) => c.phone)]);
}

/** Upsert parsed rows into a list. DNC-listed phones are skipped + counted. */
async function upsertContacts(
  workspaceId: string,
  listId: string,
  rows: ParsedRow[],
  dnc: ReadonlySet<string>
): Promise<{ imported: number; dncSkipped: number }> {
  const { dialable, blocked } = scrubAgainstDnc(rows, dnc);
  for (const r of dialable) {
    await db.contact.upsert({
      where: { workspaceId_phone: { workspaceId, phone: r.phone } },
      update: {
        name: r.name ?? undefined,
        listId,
        attributes: r.attributes,
        timezone: r.timezone ?? undefined,
        consentAt: r.consentAt ?? undefined,
        consentSource: r.consentSource ?? undefined,
      },
      create: {
        workspaceId,
        listId,
        phone: r.phone,
        name: r.name,
        timezone: r.timezone,
        consentAt: r.consentAt,
        consentSource: r.consentSource,
        attributes: r.attributes,
      },
    });
  }
  return { imported: dialable.length, dncSkipped: blocked.length };
}

/** CSV upload → new list. Optionally ALSO enroll into an existing campaign
 *  (readme §6.1 "add contacts to a running campaign") — campaignId of a
 *  DRAFT/RUNNING/PAUSED campaign. */
export async function importContactsAction(input: {
  listName: string;
  csvText: string;
  campaignId?: string;
}): Promise<ActionResult> {
  // RBAC first (guide 03): throws FORBIDDEN for VIEWER/AGENT — NOT caught below.
  const ctx = await requirePermission("contacts:import");
  try {
    const listName = z.string().min(2).max(80).parse(input.listName);

    const { rows, skipped, error } = parseContactCsv(input.csvText);
    if (error) return { ok: false, error };

    let campaign: { id: string; listId: string; status: string } | null = null;
    if (input.campaignId) {
      campaign = await db.campaign.findFirst({
        where: { id: input.campaignId, workspaceId: ctx.workspaceId, status: { in: ["DRAFT", "RUNNING", "PAUSED"] } },
        select: { id: true, listId: true, status: true },
      });
      if (!campaign) return { ok: false, error: "Campaign not found or already finished." };
    }

    const list = await db.contactList.create({
      data: { workspaceId: ctx.workspaceId, name: listName },
    });

    const dnc = await loadDncSet(ctx.workspaceId);
    const { imported, dncSkipped } = await upsertContacts(ctx.workspaceId, list.id, rows, dnc);

    // Enroll into the campaign's snapshot when requested (dedupe via the
    // @@unique(campaignId, contactId) constraint).
    if (campaign) {
      const contacts = await db.contact.findMany({
        where: { workspaceId: ctx.workspaceId, listId: list.id },
        select: { id: true, dnc: true, optOutAt: true },
      });
      await db.campaignContact.createMany({
        data: contacts.map((c) => ({
          campaignId: campaign!.id,
          contactId: c.id,
          status: c.dnc || c.optOutAt ? ("SKIPPED_DNC" as const) : ("PENDING" as const),
        })),
        skipDuplicates: true,
      });
    }

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "contacts.import", entity: "ContactList", entityId: list.id,
      metadata: { imported, skipped, dncSkipped, listName, campaignId: input.campaignId ?? null },
    });
    revalidatePath("/contacts");
    if (campaign) revalidatePath(`/campaigns/${campaign.id}`);
    return { ok: true, imported, skipped, dncSkipped, listId: list.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Import failed. Check the CSV format." };
  }
}

/** CRM import (readme §6.1): pull contacts from the connected CRM into a new list.
 *  Dry-run safe: CRM_IMPORT_DRY_RUN=true returns fixture rows instead of calling
 *  the CRM (OAuth apps are guide 05/operator territory). */
export async function importFromCrmAction(crmConnectionId: string): Promise<ActionResult> {
  const ctx = await requirePermission("contacts:import");
  try {
    const conn = await db.crmConnection.findFirst({
      where: { id: crmConnectionId, workspaceId: ctx.workspaceId },
    });
    if (!conn) return { ok: false, error: "CRM connection not found." };

    let updates: { externalId: string; name?: string; phone?: string; email?: string }[];
    if (process.env.CRM_IMPORT_DRY_RUN !== "false") {
      updates = [
        { externalId: "dry-1", name: "CRM Dry One", phone: "+919876543210", email: "one@example.com" },
        { externalId: "dry-2", name: "CRM Dry Two", phone: "+919876543211" },
      ];
    } else {
      updates = await getCrmProvider(conn.provider).pullUpdates(conn, new Date(0));
    }

    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (const u of updates) {
      const phone = u.phone ? normalizePhone(u.phone) : null;
      if (!phone) { skipped++; continue; }
      rows.push({
        phone,
        name: u.name ?? null,
        timezone: null,
        consentAt: null,
        consentSource: null,
        attributes: u.email ? { email: u.email } : {},
      });
    }
    if (rows.length === 0) return { ok: false, error: "CRM returned no contacts with valid phones.", skipped };

    const list = await db.contactList.create({
      data: { workspaceId: ctx.workspaceId, name: `CRM import ${conn.provider} ${new Date().toISOString().slice(0, 10)}` },
    });
    const dnc = await loadDncSet(ctx.workspaceId);
    const { imported, dncSkipped } = await upsertContacts(ctx.workspaceId, list.id, rows, dnc);

    // Stamp crmExternalId for two-way sync (best effort, by phone).
    for (const u of updates) {
      const phone = u.phone ? normalizePhone(u.phone) : null;
      if (!phone) continue;
      await db.contact.updateMany({
        where: { workspaceId: ctx.workspaceId, phone },
        data: { crmExternalId: u.externalId },
      });
    }

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "contacts.import-crm", entity: "CrmConnection", entityId: conn.id,
      metadata: { provider: conn.provider, imported, skipped, dncSkipped, dryRun: process.env.CRM_IMPORT_DRY_RUN !== "false" },
    });
    revalidatePath("/contacts");
    return { ok: true, imported, skipped, dncSkipped, listId: list.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "CRM import failed." };
  }
}

export async function toggleDncAction(contactId: string, dnc: boolean): Promise<ActionResult> {
  const ctx = await requirePermission("contacts:write");
  try {
    const contact = await db.contact.findFirst({
      where: { id: contactId, workspaceId: ctx.workspaceId },
      select: { id: true, phone: true },
    });
    if (!contact) return { ok: false, error: "Contact not found." };
    await db.$transaction([
      db.contact.update({ where: { id: contact.id }, data: { dnc } }),
      dnc
        ? db.dncEntry.upsert({
            where: { workspaceId_phone: { workspaceId: ctx.workspaceId, phone: contact.phone } },
            update: {},
            create: { workspaceId: ctx.workspaceId, phone: contact.phone, source: "MANUAL", reason: "toggled by user" },
          })
        : db.dncEntry.deleteMany({ where: { workspaceId: ctx.workspaceId, phone: contact.phone, source: "MANUAL" } }),
    ]);
    revalidatePath("/contacts");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
```

### 6b — `src/server/actions/campaigns.ts` (overwrite: presets, compliance, mid-flight edits)

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ensureCampaignScheduler, stopCampaignScheduler } from "@/lib/queue";
import { getPreset, CAMPAIGN_TYPES } from "@/lib/campaign/presets";
import { parseRetryPolicy, parseCampaignExtras } from "@/lib/campaign/retry";
import { isNumberTypeAllowed, consentBlocks, requiresConsent } from "@/lib/campaign/compliance";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const HHMM = /^\d{2}:\d{2}$/;

const campaignSchema = z.object({
  name: z.string().min(2).max(80),
  type: z.string().refine((t) => CAMPAIGN_TYPES.includes(t), "unknown campaign type"),
  agentId: z.string().min(1),
  listId: z.string().min(1),
  poolId: z.string().nullable().optional(),
  callsPerMinute: z.coerce.number().int().min(1).max(60),
  concurrency: z.coerce.number().int().min(1).max(50),
  maxAttempts: z.coerce.number().int().min(1).max(5),
  retryDelayMin: z.coerce.number().int().min(5).max(1440),
  callingWindowStart: z.string().regex(HHMM),
  callingWindowEnd: z.string().regex(HHMM),
  retryPolicy: z.record(z.object({ attempts: z.number().int().min(1).max(10), delayMin: z.number().min(5).max(1440) })).nullable().optional(),
  timezoneWindows: z.object({
    timezone: z.string().optional(),
    days: z.array(z.number().int().min(0).max(6)).optional(),
    windows: z.array(z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)])).optional(),
  }).nullable().optional(),
  openingHook: z.string().max(2000).nullable().optional(),
  objectionPlaybook: z.string().max(4000).nullable().optional(),
  amdPolicy: z.enum(["HANGUP", "LEAVE_MESSAGE"]),
  predictiveDialing: z.coerce.boolean(),
  whatsappFallbackTemplateId: z.string().nullable().optional(),
  applyPreset: z.coerce.boolean().optional(),
});

type CampaignInput = z.infer<typeof campaignSchema>;

/** Snapshot a list's contacts into CampaignContact rows with the import-time
 *  DNC + consent scrub (dial time re-checks everything — defense in depth). */
async function snapshotContacts(
  workspaceId: string,
  campaignId: string,
  listId: string,
  campaignType: string
): Promise<void> {
  const consentOn = process.env.REQUIRE_CONSENT_FOR_PROMOTIONAL === "true";
  const [contacts, dncEntries] = await Promise.all([
    db.contact.findMany({
      where: { workspaceId, listId },
      select: { id: true, dnc: true, optOutAt: true, phone: true, consentAt: true },
    }),
    db.dncEntry.findMany({ where: { workspaceId }, select: { phone: true } }),
  ]);
  const dncPhones = new Set(dncEntries.map((d) => d.phone));
  await db.campaignContact.createMany({
    data: contacts.map((c) => {
      const blocked = c.dnc || c.optOutAt !== null || dncPhones.has(c.phone);
      const noConsent = consentBlocks({ consentAt: c.consentAt }, campaignType, consentOn);
      return {
        campaignId,
        contactId: c.id,
        status: blocked || noConsent ? ("SKIPPED_DNC" as const) : ("PENDING" as const),
        lastResult: noConsent && !blocked ? "skipped:no-consent" : blocked ? "skipped:dnc" : null,
      };
    }),
    skipDuplicates: true,
  });
}

export async function createCampaignAction(input: unknown): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write"); // RBAC first — throws FORBIDDEN
  try {
    const parsed = campaignSchema.safeParse(input);
    if (!parsed.success) {
      console.error("campaign schema", parsed.error.issues);
      return { ok: false, error: "Check the campaign fields." };
    }
    const d: CampaignInput = parsed.data;
    const preset = getPreset(d.type);

    // Preset defaults fill anything the form left at scalar defaults (applyPreset).
    const retryPolicyJson: Record<string, unknown> = {
      ...(d.applyPreset && preset ? preset.retryPolicy : parseRetryPolicy(d.retryPolicy ?? null)),
    };
    const extras = parseCampaignExtras({ whatsappFallbackTemplateId: d.whatsappFallbackTemplateId ?? undefined });
    if (extras.whatsappFallbackTemplateId) {
      retryPolicyJson.whatsappFallbackTemplateId = extras.whatsappFallbackTemplateId;
    }
    const timezoneWindowsJson = d.timezoneWindows ?? (d.applyPreset && preset ? { days: preset.days } : null);

    const [agent, list, pool] = await Promise.all([
      db.agent.findFirst({ where: { id: d.agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" } }),
      db.contactList.findFirst({ where: { id: d.listId, workspaceId: ctx.workspaceId } }),
      d.poolId ? db.numberPool.findFirst({ where: { id: d.poolId, workspaceId: ctx.workspaceId } }) : null,
    ]);
    if (!agent) return { ok: false, error: "Pick a PUBLISHED agent (publish it on the Agents page first)." };
    if (!list) return { ok: false, error: "Contact list not found." };
    if (d.poolId && !pool) return { ok: false, error: "Number pool not found." };
    if (extras.whatsappFallbackTemplateId) {
      const tpl = await db.whatsAppTemplate.findFirst({
        where: { id: extras.whatsappFallbackTemplateId, workspaceId: ctx.workspaceId, status: "APPROVED" },
      });
      if (!tpl) return { ok: false, error: "WhatsApp fallback template not found or not APPROVED." };
    }

    const campaign = await db.campaign.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: d.name,
        type: d.type as never,
        agentId: d.agentId,
        listId: d.listId,
        poolId: d.poolId ?? null,
        status: "DRAFT",
        callsPerMinute: d.callsPerMinute,
        concurrency: d.concurrency,
        maxAttempts: d.maxAttempts,
        retryDelayMin: d.retryDelayMin,
        retryPolicy: retryPolicyJson,
        callingWindowStart: d.applyPreset && preset ? preset.windowStart : d.callingWindowStart,
        callingWindowEnd: d.applyPreset && preset ? preset.windowEnd : d.callingWindowEnd,
        timezoneWindows: timezoneWindowsJson ?? undefined,
        openingHook: d.openingHook ?? (d.applyPreset && preset ? preset.openingHook : null),
        objectionPlaybook: d.objectionPlaybook ?? (d.applyPreset && preset ? preset.objectionPlaybook : null),
        amdPolicy: d.amdPolicy,
        predictiveDialing: d.predictiveDialing,
      },
    });
    await snapshotContacts(ctx.workspaceId, campaign.id, d.listId, d.type);

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "campaign.create", entity: "Campaign", entityId: campaign.id,
      metadata: { name: campaign.name, type: d.type, preset: d.applyPreset === true },
    });
    revalidatePath("/campaigns");
    return { ok: true, id: campaign.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create campaign." };
  }
}

/** Shared transition helper. `ctx` comes from the caller's requirePermission()
 *  (which runs OUTSIDE the try/catch so FORBIDDEN propagates). */
async function setStatus(
  ctx: { workspaceId: string; user: { id: string } },
  campaignId: string,
  from: string[],
  to: "RUNNING" | "PAUSED" | "CANCELLED",
  action: string
) {
  // TRAI series enforcement at START (readme §6.1/§11): every number in the pool
  // must be an allowed type for the campaign type.
  if (to === "RUNNING") {
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspaceId },
      include: { pool: { include: { numbers: { select: { number: true, numberType: true } } } } },
    });
    if (!campaign) return { ok: false, error: "Campaign not found." };
    if (campaign.pool) {
      const bad = campaign.pool.numbers.filter((n) => !isNumberTypeAllowed(campaign.type, n.numberType));
      if (bad.length > 0) {
        return {
          ok: false,
          error:
            `TRAI series violation: ${bad.map((b) => `${b.number} (${b.numberType})`).join(", ")} ` +
            `not allowed for ${campaign.type} (${requiresConsent(campaign.type) ? "promotional → SERIES_140" : "service → SERIES_1600"}). Fix the pool.`,
        };
      }
    }
  }

  const updated = await db.campaign.updateMany({
    where: { id: campaignId, workspaceId: ctx.workspaceId, status: { in: from as never[] } },
    data: {
      status: to,
      ...(to === "RUNNING" ? { startedAt: new Date() } : {}),
      ...(to === "CANCELLED" ? { finishedAt: new Date() } : {}),
    },
  });
  if (updated.count === 0) return { ok: false, error: `Campaign cannot be ${action} from its current state.` };

  if (to === "RUNNING") await ensureCampaignScheduler(campaignId);
  else await stopCampaignScheduler(campaignId);

  await audit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: `campaign.${action}`, entity: "Campaign", entityId: campaignId,
  });
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function startCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:launch"); // VIEWER gets FORBIDDEN (403-equivalent)
  try { return await setStatus(ctx, id, ["DRAFT", "PAUSED", "SCHEDULED"], "RUNNING", "start"); }
  catch (e) { console.error(e); return { ok: false, error: "Something went wrong." }; }
}

export async function pauseCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:launch");
  try { return await setStatus(ctx, id, ["RUNNING"], "PAUSED", "pause"); }
  catch (e) { console.error(e); return { ok: false, error: "Something went wrong." }; }
}

export async function cancelCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:delete");
  try { return await setStatus(ctx, id, ["DRAFT", "RUNNING", "PAUSED", "SCHEDULED"], "CANCELLED", "cancel"); }
  catch (e) { console.error(e); return { ok: false, error: "Something went wrong." }; }
}

/** Edit script mid-flight (readme §6.1): opening hook + objection playbook are read
 *  fresh by the worker on every dial batch, so saving here changes the NEXT dial. */
export async function updateCampaignScriptAction(input: {
  campaignId: string;
  openingHook: string;
  objectionPlaybook: string;
}): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const openingHook = z.string().max(2000).parse(input.openingHook);
    const objectionPlaybook = z.string().max(4000).parse(input.objectionPlaybook);
    const updated = await db.campaign.updateMany({
      where: { id: input.campaignId, workspaceId: ctx.workspaceId, status: { in: ["DRAFT", "RUNNING", "PAUSED"] } },
      data: { openingHook: openingHook || null, objectionPlaybook: objectionPlaybook || null },
    });
    if (updated.count === 0) return { ok: false, error: "Campaign not found or already finished." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "campaign.edit-script", entity: "Campaign", entityId: input.campaignId,
    });
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not save the script." };
  }
}
```

### 6c — `src/server/actions/pools.ts` (number pools + caps)

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isValidDidForType } from "@/lib/campaign/phone";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const NUMBER_TYPES = ["LOCAL", "TOLLFREE", "MOBILE", "SERIES_140", "SERIES_1600"] as const;

export async function createPoolAction(name: string): Promise<ActionResult> {
  const ctx = await requirePermission("numbers:write");
  try {
    const n = z.string().min(2).max(60).parse(name);
    const pool = await db.numberPool.create({ data: { workspaceId: ctx.workspaceId, name: n } });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "pool.create", entity: "NumberPool", entityId: pool.id });
    revalidatePath("/campaigns/pools");
    return { ok: true, id: pool.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create pool." };
  }
}

const addNumberSchema = z.object({
  poolId: z.string().min(1),
  number: z.string().min(8).max(16),
  label: z.string().max(60).nullable().optional(),
  numberType: z.enum(NUMBER_TYPES),
  dailyCallCap: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  lifetimeCallCap: z.coerce.number().int().min(1).max(10000000).nullable().optional(),
});

export async function addNumberToPoolAction(input: unknown): Promise<ActionResult> {
  const ctx = await requirePermission("numbers:write");
  try {
    const parsed = addNumberSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the number fields." };
    const d = parsed.data;
    if (!isValidDidForType(d.number, d.numberType)) {
      return { ok: false, error: `${d.number} is not a valid ${d.numberType} DID (140 series: +91140XXXXXXX, 1600 series: +911600XXXXXX).` };
    }
    const pool = await db.numberPool.findFirst({ where: { id: d.poolId, workspaceId: ctx.workspaceId } });
    if (!pool) return { ok: false, error: "Pool not found." };
    const created = await db.phoneNumber.upsert({
      where: { workspaceId_number: { workspaceId: ctx.workspaceId, number: d.number } },
      update: { poolId: pool.id, numberType: d.numberType, label: d.label ?? undefined, dailyCallCap: d.dailyCallCap ?? null, lifetimeCallCap: d.lifetimeCallCap ?? null },
      create: {
        workspaceId: ctx.workspaceId,
        poolId: pool.id,
        number: d.number,
        numberType: d.numberType,
        label: d.label ?? null,
        dailyCallCap: d.dailyCallCap ?? null,
        lifetimeCallCap: d.lifetimeCallCap ?? null,
      },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "pool.add-number", entity: "PhoneNumber", entityId: created.id, metadata: { poolId: pool.id } });
    revalidatePath("/campaigns/pools");
    return { ok: true, id: created.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not add the number." };
  }
}

export async function removeNumberFromPoolAction(phoneNumberId: string): Promise<ActionResult> {
  const ctx = await requirePermission("numbers:write");
  try {
    const updated = await db.phoneNumber.updateMany({
      where: { id: phoneNumberId, workspaceId: ctx.workspaceId },
      data: { poolId: null },
    });
    if (updated.count === 0) return { ok: false, error: "Number not found." };
    revalidatePath("/campaigns/pools");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not remove the number." };
  }
}
```

### 6d — `src/server/actions/whatsapp.ts` (templates + campaigns, readme §9)

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getWhatsAppQueue, WHATSAPP_SEND_JOB } from "@/lib/queue";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const templateSchema = z.object({
  name: z.string().min(2).max(60).regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscores only (Meta template-name rules)"),
  language: z.string().min(2).max(10),
  body: z.string().min(10).max(1024),
  dltTemplateId: z.string().max(60).nullable().optional(),
});

/** Create a template locally. Status starts DRAFT. OPERATOR GATE: submitting to
 *  Meta/Vobiz for approval happens in the Vobiz dashboard (Step 12 explains);
 *  the app tracks the DLT/Meta status. */
export async function createTemplateAction(input: unknown): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the template fields (name: lowercase/digits/underscores)." };
    const tpl = await db.whatsAppTemplate.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        language: parsed.data.language,
        body: parsed.data.body,
        dltTemplateId: parsed.data.dltTemplateId ?? null,
        status: "DRAFT",
      },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.template-create", entity: "WhatsAppTemplate", entityId: tpl.id });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true, id: tpl.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create the template." };
  }
}

/** Record the operator-side approval state (Meta/DLT decision made in the Vobiz
 *  dashboard). Only APPROVED templates can be sent. */
export async function setTemplateStatusAction(templateId: string, status: "PENDING" | "APPROVED" | "REJECTED"): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const s = z.enum(["PENDING", "APPROVED", "REJECTED"]).parse(status);
    const updated = await db.whatsAppTemplate.updateMany({
      where: { id: templateId, workspaceId: ctx.workspaceId },
      data: { status: s },
    });
    if (updated.count === 0) return { ok: false, error: "Template not found." };
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.template-status", entity: "WhatsAppTemplate", entityId: templateId, metadata: { status: s } });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not update the template." };
  }
}

export async function createWhatsAppCampaignAction(input: {
  name: string;
  templateId: string;
  listId: string;
}): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const name = z.string().min(2).max(80).parse(input.name);
    const [template, list] = await Promise.all([
      db.whatsAppTemplate.findFirst({ where: { id: input.templateId, workspaceId: ctx.workspaceId, status: "APPROVED" } }),
      db.contactList.findFirst({ where: { id: input.listId, workspaceId: ctx.workspaceId } }),
    ]);
    if (!template) return { ok: false, error: "Pick an APPROVED template." };
    if (!list) return { ok: false, error: "Contact list not found." };
    const wc = await db.whatsAppCampaign.create({
      data: { workspaceId: ctx.workspaceId, name, templateId: template.id, listId: list.id, status: "DRAFT" },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.campaign-create", entity: "WhatsAppCampaign", entityId: wc.id });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true, id: wc.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create the WhatsApp campaign." };
  }
}

/** Start sending: one throttled job per non-DNC contact. Dry-run gated downstream
 *  (WHATSAPP_DRY_RUN gate in src/worker/whatsapp.ts over guide 04's src/lib/vobiz.ts). */
export async function startWhatsAppCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:launch");
  try {
    const wc = await db.whatsAppCampaign.findFirst({
      where: { id, workspaceId: ctx.workspaceId, status: { in: ["DRAFT", "PAUSED"] } },
      include: { template: true },
    });
    if (!wc || !wc.listId) return { ok: false, error: "Campaign not found or already started." };
    if (wc.template.status !== "APPROVED") return { ok: false, error: "Template is not APPROVED." };

    const contacts = await db.contact.findMany({
      where: { workspaceId: ctx.workspaceId, listId: wc.listId, dnc: false, optOutAt: null },
      select: { phone: true, name: true },
    });
    if (contacts.length === 0) return { ok: false, error: "No dialable contacts in this list (all DNC?)." };

    const q = getWhatsAppQueue();
    for (let i = 0; i < contacts.length; i++) {
      await q.add(
        WHATSAPP_SEND_JOB,
        {
          workspaceId: ctx.workspaceId,
          whatsAppCampaignId: wc.id,
          phone: contacts[i].phone,
          templateName: wc.template.name,
          params: [contacts[i].name ?? "Customer"],
          index: i,
          total: contacts.length,
        },
        { jobId: `wa-${wc.id}-${i}` } // idempotent re-starts
      );
    }
    await db.whatsAppCampaign.update({ where: { id: wc.id }, data: { status: "RUNNING", startedAt: new Date() } });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.campaign-start", entity: "WhatsAppCampaign", entityId: wc.id, metadata: { recipients: contacts.length } });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true, id: wc.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not start the WhatsApp campaign." };
  }
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.
**If it fails:** most likely `@/lib/integrations/crm` path — confirm guide 05 created
`src/lib/integrations/crm/index.ts` (`ls src/lib/integrations/crm/`). Prisma type
errors on a field name → diff the model against guide 02's schema; do NOT invent
fields. Max 2 attempts, then STOP and report.

---

## Step 7: Worker part 1 — LLM wrapper + scheduler tick

The worker is split into focused modules so each is reviewable. `CAMPAIGN_DRY_RUN`
gates BOTH telephony and post-call LLM calls — the dry-run LLM mock is keyword-based
and deterministic, which is what makes the scripted integration tests (Step 14)
reproducible.

**File `src/worker/llm.ts`** (full content):

```ts
/**
 * Dry-run-aware post-call intelligence. CAMPAIGN_DRY_RUN=true → deterministic
 * keyword mocks (no OpenRouter, no cost); false → real OpenRouter classification
 * via src/lib/openrouter.ts + src/lib/campaign/scoring.ts.
 */
import { callOpenRouterJson } from "../lib/openrouter";
import {
  buildCallbackPrompt,
  buildInterestPrompt,
  parseCallbackRequest,
  parseInterestScore,
  type CallbackExtraction,
  type InterestScoreValue,
} from "../lib/campaign/scoring";

const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false";
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export async function classifyInterest(input: {
  transcript: string;
  campaignType: string;
}): Promise<{ score: InterestScoreValue; reason: string } | null> {
  if (DRY_RUN) {
    const t = input.transcript.toLowerCase();
    const out = /book|yes|interested|demo|sign ?up|payment done/.test(t)
      ? { score: "HOT" as const, reason: "dry-run mock: positive intent keywords" }
      : /not interested|no thanks|wrong number/.test(t)
        ? { score: "COLD" as const, reason: "dry-run mock: refusal keywords" }
        : { score: "WARM" as const, reason: "dry-run mock: neutral conversation" };
    log(`[postcall] dry-run interest=${out.score}`);
    return out;
  }
  try {
    const text = await callOpenRouterJson(buildInterestPrompt(input));
    return parseInterestScore(text);
  } catch (e) {
    console.error("[postcall] interest LLM failed", e);
    return null;
  }
}

export async function extractCallback(input: {
  transcript: string;
  timezone: string;
  now: Date;
}): Promise<CallbackExtraction> {
  if (DRY_RUN) {
    if (/call me|callback|call back|tomorrow/.test(input.transcript.toLowerCase())) {
      const dueAt = new Date(input.now.getTime() + 24 * 60 * 60_000);
      log(`[postcall] dry-run callback extracted → ${dueAt.toISOString()}`);
      return { requested: true, dueAt, note: "dry-run mock: callback keyword" };
    }
    return { requested: false };
  }
  try {
    const text = await callOpenRouterJson(
      buildCallbackPrompt({ transcript: input.transcript, nowIso: input.now.toISOString(), timezone: input.timezone })
    );
    return parseCallbackRequest(text, input.now);
  } catch (e) {
    console.error("[postcall] callback LLM failed", e);
    return { requested: false };
  }
}
```

**File `src/worker/campaignTick.ts`** (full content):

```ts
/**
 * Scheduler tick: every 30s per RUNNING campaign. Reads the campaign FRESH each
 * tick (mid-flight script edits take effect on the next batch), enforces windows
 * (per-contact timezone, day-of-week), TRAI hours, consent, DNC, pacing
 * (ramp-up + answer-rate adaptive), slot budget (concurrency / predictive), and
 * pool rotation with caps. Claims rows and enqueues `dial` jobs.
 */
import type { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { getDialerQueue, stopCampaignScheduler, DIAL_JOB, type SchedulerJobData } from "../lib/queue";
import { rampCpm, adaptiveCpm, answerRateFromCalls, tickBatchSize, predictiveSlots } from "../lib/campaign/pacing";
import { isWithinCallingWindows, isWithinTraiHours, parseTimezoneWindows, effectiveTimezone } from "../lib/campaign/windows";
import { pickNumberRoundRobin, type PoolNumber } from "../lib/campaign/pool";
import { consentBlocks, poolUsesPromotionalSeries } from "../lib/campaign/compliance";
import { emitWebhookEvent } from "../lib/webhooks";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const TRAI_ENFORCE = process.env.TRAI_HOURS_ENFORCE !== "false"; // default ON
const CONSENT_ON = process.env.REQUIRE_CONSENT_FOR_PROMOTIONAL === "true";

/** Round-robin cursor per pool id (worker-process memory; a restart just re-enters
 *  rotation at the first number — acceptable, caps are the real protection). */
const lastUsedByPool = new Map<string, string>();

export async function schedulerTick(job: Job<SchedulerJobData>): Promise<void> {
  const { campaignId } = job.data;
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      agent: { select: { id: true, name: true } },
      pool: { include: { numbers: true } },
    },
  });
  if (!campaign || campaign.status !== "RUNNING") {
    await stopCampaignScheduler(campaignId);
    return;
  }

  const now = new Date();
  const tw = parseTimezoneWindows(campaign.timezoneWindows);
  const windowInput = {
    now,
    windowStart: campaign.callingWindowStart,
    windowEnd: campaign.callingWindowEnd,
    timezoneWindows: tw,
  };

  // Fast path: campaign-default timezone outside the window AND no per-contact
  // timezones in play → idle. (Per-contact checks below are authoritative.)
  if (!isWithinCallingWindows({ ...windowInput, contactTimezone: null })) {
    log(`[scheduler] ${campaign.name}: outside default calling window, idle`);
    return;
  }

  // Pacing: ramp-up from startedAt, then answer-rate adaptation.
  const startedAt = campaign.startedAt ?? campaign.createdAt;
  let cpm = rampCpm({ capCpm: campaign.callsPerMinute, startedAt, now });
  const recentCalls = await db.call.findMany({
    where: { workspaceId: campaign.workspaceId, campaignId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { answeredAt: true },
  });
  const answerRate = answerRateFromCalls(recentCalls);
  cpm = adaptiveCpm(cpm, answerRate);

  // Slot budget: concurrency cap, optionally over-booked (predictive).
  const inFlight = await db.campaignContact.count({ where: { campaignId, status: "DIALING" } });
  const slots = predictiveSlots({
    concurrency: campaign.concurrency,
    inFlight,
    predictive: campaign.predictiveDialing,
  });
  const batch = Math.min(tickBatchSize(cpm), slots);
  if (batch <= 0) {
    log(`[scheduler] ${campaign.name}: no free slots (inFlight=${inFlight}/${campaign.concurrency}), idle`);
    return;
  }

  const due = await db.campaignContact.findMany({
    where: {
      campaignId,
      OR: [
        { status: "PENDING" },
        { status: "RETRY_SCHEDULED", nextAttemptAt: { lte: now } },
      ],
    },
    include: { contact: { select: { phone: true, dnc: true, optOutAt: true, timezone: true, consentAt: true } } },
    orderBy: { updatedAt: "asc" },
    take: batch * 5, // over-fetch: per-contact filters below drop some
  });

  if (due.length === 0) {
    const remaining = await db.campaignContact.count({
      where: { campaignId, status: { in: ["PENDING", "RETRY_SCHEDULED", "DIALING"] } },
    });
    if (remaining === 0) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED", finishedAt: new Date() },
      });
      await stopCampaignScheduler(campaignId);
      await emitWebhookEvent(campaign.workspaceId, "campaign.finished", {
        campaignId, name: campaign.name, status: "COMPLETED",
      });
      log(`[scheduler] ${campaign.name}: COMPLETED`);
    }
    return;
  }

  // Batch DNC lookup for the candidate phones (belt-and-suspenders over the flags).
  const phones = due.map((d) => d.contact.phone);
  const dncEntries = await db.dncEntry.findMany({
    where: { workspaceId: campaign.workspaceId, phone: { in: phones } },
    select: { phone: true },
  });
  const dncPhones = new Set(dncEntries.map((d) => d.phone));

  const poolNumbers: PoolNumber[] = (campaign.pool?.numbers ?? []).map((n) => ({
    id: n.id,
    number: n.number,
    numberType: n.numberType,
    dailyCallCap: n.dailyCallCap,
    lifetimeCallCap: n.lifetimeCallCap,
    dailyCallsUsed: n.dailyCallsUsed,
    lifetimeCallsUsed: n.lifetimeCallsUsed,
  }));
  const traiGuard = TRAI_ENFORCE && poolUsesPromotionalSeries(poolNumbers);

  let claimed = 0;
  for (const cc of due) {
    if (claimed >= batch) break;
    const c = cc.contact;

    // Schedule-time scrubs (dial time re-checks everything).
    if (c.dnc || c.optOutAt || dncPhones.has(c.phone)) {
      await db.campaignContact.updateMany({
        where: { id: cc.id, status: { in: ["PENDING", "RETRY_SCHEDULED"] } },
        data: { status: "SKIPPED_DNC", lastResult: "skipped:dnc" },
      });
      continue;
    }
    if (consentBlocks({ consentAt: c.consentAt }, campaign.type, CONSENT_ON)) {
      await db.campaignContact.updateMany({
        where: { id: cc.id, status: { in: ["PENDING", "RETRY_SCHEDULED"] } },
        data: { status: "SKIPPED_DNC", lastResult: "skipped:no-consent" },
      });
      continue;
    }
    const tz = effectiveTimezone({ ...windowInput, contactTimezone: c.timezone });
    if (!isWithinCallingWindows({ ...windowInput, contactTimezone: c.timezone })) continue; // retry next tick
    if (traiGuard && !isWithinTraiHours(now, tz)) continue; // TRAI 09:00–21:00 hard guardrail

    // Pool rotation (only when the campaign has a pool).
    let phoneNumberId: string | undefined;
    if (campaign.poolId) {
      const picked = pickNumberRoundRobin(poolNumbers, lastUsedByPool.get(campaign.poolId) ?? null);
      if (!picked) {
        log(`[scheduler] ${campaign.name}: POOL EXHAUSTED (all numbers capped) — pausing dials this tick`);
        break;
      }
      // Claim capacity atomically; re-check caps in the WHERE clause.
      const capClaim = await db.phoneNumber.updateMany({
        where: {
          id: picked.id,
          OR: [{ dailyCallCap: null }, { dailyCallsUsed: { lt: picked.dailyCallCap ?? 0 } }],
        },
        data: { dailyCallsUsed: { increment: 1 }, lifetimeCallsUsed: { increment: 1 } },
      });
      if (capClaim.count === 0) {
        picked.dailyCallsUsed = picked.dailyCallCap ?? picked.dailyCallsUsed; // mark capped locally
        continue;
      }
      picked.dailyCallsUsed += 1;
      picked.lifetimeCallsUsed += 1;
      lastUsedByPool.set(campaign.poolId, picked.id);
      phoneNumberId = picked.id;
    }

    // Claim the contact row (optimistic: status unchanged since read).
    const claim = await db.campaignContact.updateMany({
      where: { id: cc.id, status: cc.status },
      data: { status: "DIALING" },
    });
    if (claim.count !== 1) {
      if (phoneNumberId) {
        await db.phoneNumber.update({ where: { id: phoneNumberId }, data: { dailyCallsUsed: { decrement: 1 }, lifetimeCallsUsed: { decrement: 1 } } });
      }
      continue;
    }
    await getDialerQueue().add(DIAL_JOB, {
      campaignId,
      campaignContactId: cc.id,
      workspaceId: campaign.workspaceId,
      ...(phoneNumberId ? { phoneNumberId } : {}),
    });
    claimed++;
  }
  if (claimed > 0) {
    log(`[scheduler] ${campaign.name}: enqueued ${claimed} dial(s) (cpm=${cpm}, answerRate=${answerRate ?? "n/a"}, slots=${slots})`);
  }
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.
**If it fails:** `Cannot find module '../lib/webhooks'` → guide 06 Step 10 file
missing; confirm `ls src/lib/webhooks.ts`. Do not stub it — report if absent.

---

## Step 8: Worker part 2 — dial processors (dial, callback-dial, manual-dial, whatsapp-send)

**File `src/worker/whatsapp.ts`** (full content — dry-run gate over guide 04's
CANONICAL client `sendWhatsAppTemplate` in `src/lib/vobiz.ts`; do not create any
other WhatsApp helper):

```ts
/**
 * Dry-run gate for WhatsApp sends. The actual provider call is ALWAYS guide 04's
 * canonical client: sendWhatsAppTemplate({to, templateName, languageCode?, components?})
 * from src/lib/vobiz.ts (envs VOBIZ_AUTH_ID/VOBIZ_AUTH_TOKEN/VOBIZ_API_BASE/
 * VOBIZ_WHATSAPP_PATH/VOBIZ_WHATSAPP_SENDER). WHATSAPP_DRY_RUN=true (default, guide
 * 06's env) logs instead of sending — zero cost in every test.
 */
import { sendWhatsAppTemplate } from "../lib/vobiz";

export type GatedWhatsAppResult = { ok: boolean; dryRun?: boolean; error?: string };

export async function sendWhatsAppGated(input: {
  to: string;
  template: string; // approved template NAME (vobiz.ts `templateName`)
  params: string[]; // body {{1}} {{2}} … parameters, in order
}): Promise<GatedWhatsAppResult> {
  if (process.env.WHATSAPP_DRY_RUN !== "false") {
    console.log(
      `[whatsapp] DRY RUN template=${input.template} to=${input.to} params=${JSON.stringify(input.params)}`
    );
    return { ok: true, dryRun: true };
  }
  try {
    await sendWhatsAppTemplate({
      to: input.to,
      templateName: input.template,
      components: [
        {
          type: "body",
          parameters: input.params.map((text) => ({ type: "text", text })),
        },
      ],
    });
    return { ok: true };
  } catch (e) {
    console.error("[whatsapp] send failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}
```

**File `src/worker/dial.ts`** (full content):

```ts
/**
 * Dial processors on the shared `campaign-dialer` queue + the `whatsapp-send` queue.
 * Job names "callback-dial" / "manual-dial" are guide 06's contract — payload shapes
 * MUST stay in sync with src/lib/dialJobs.ts.
 */
import type { Job } from "bullmq";
import { PrismaClient, type Agent } from "@prisma/client";
import { dograhTriggerCall } from "../lib/dograh";
import { resolveAgentForCall } from "../lib/ab-test"; // guide 05 A/B + version routing
import { sendWhatsAppGated } from "./whatsapp"; // dry-run gate over guide 04's canonical client
import { parseRetryPolicy, computeNextRetry, isDisposition, type Disposition } from "../lib/campaign/retry";
import { shouldSendWhatsAppFallback } from "../lib/campaign/fallback";
import type {
  DialJobData,
  CallbackDialJobData,
  ManualDialJobData,
  WhatsAppSendJobData,
} from "../lib/queue";

const db = new PrismaClient();
const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false"; // default true — safe
const FORCED = process.env.CAMPAIGN_DRY_RUN_RESULT || ""; // deterministic tests
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Simulated outcome distribution: 70% completed, 15% no-answer, 10% busy, 5% voicemail. */
function simulateResult(): "completed" | Disposition {
  if (FORCED === "completed" || isDisposition(FORCED)) return FORCED as "completed" | Disposition;
  const r = Math.random();
  if (r < 0.7) return "completed";
  if (r < 0.85) return "no-answer";
  if (r < 0.95) return "busy";
  return "voicemail";
}

/** Send the call-to-WhatsApp fallback (readme §9) after a FINAL no-answer.
 *  Never throws; dry-run logs via src/worker/whatsapp.ts. */
export async function maybeSendWhatsAppFallback(input: {
  workspaceId: string;
  campaignId: string;
  phone: string;
  name: string | null;
  retryPolicyJson: unknown;
  disposition: string;
  retryExhausted: boolean;
}): Promise<void> {
  const fb = shouldSendWhatsAppFallback({
    retryPolicyJson: input.retryPolicyJson,
    disposition: input.disposition,
    retryExhausted: input.retryExhausted,
  });
  if (!fb.send || !fb.templateId) return;
  try {
    const tpl = await db.whatsAppTemplate.findFirst({
      where: { id: fb.templateId, workspaceId: input.workspaceId, status: "APPROVED" },
    });
    if (!tpl) {
      log(`[whatsapp-fallback] template ${fb.templateId} missing/not APPROVED — skipped`);
      return;
    }
    const res = await sendWhatsAppGated({
      to: input.phone,
      template: tpl.name,
      params: [input.name ?? "Customer"],
    });
    log(`[whatsapp-fallback] campaign=${input.campaignId} to=${input.phone} template=${tpl.name} ok=${res.ok}${res.dryRun ? " (dry-run)" : ""}${res.error ? ` error=${res.error}` : ""}`);
  } catch (e) {
    console.error("[whatsapp-fallback] failed", e);
  }
}

/**
 * Resolve which Dograh workflow serves an outbound call for `agent`:
 * guide 05's A/B + version routing (resolveAgentForCall) over the agent's
 * PUBLISHED versions, falling back to the agent-level Dograh ids.
 * Returns null when nothing usable is published — caller must NOT dial.
 */
export async function resolveWorkflowForAgent(
  agent: Agent,
  workspaceId: string,
  callerPhone?: string
): Promise<{ dograhWorkflowId: string; dograhWorkflowUuid: string } | null> {
  const versions = await db.agentVersion.findMany({
    where: { agentId: agent.id, workspaceId, status: "PUBLISHED" },
    select: { id: true, isAbVariant: true, abTrafficPercent: true, dograhWorkflowId: true, dograhWorkflowUuid: true },
  });
  const resolved = resolveAgentForCall({ agentId: agent.id, callerPhone, publishedVersions: versions });
  const wf = resolved ?? (agent.dograhWorkflowId
    ? { dograhWorkflowId: agent.dograhWorkflowId, dograhWorkflowUuid: agent.dograhWorkflowUuid }
    : null);
  if (!wf || !wf.dograhWorkflowUuid) return null;
  return { dograhWorkflowId: wf.dograhWorkflowId, dograhWorkflowUuid: wf.dograhWorkflowUuid };
}

export async function dialJob(job: Job<DialJobData>): Promise<void> {
  const { campaignContactId } = job.data;
  const cc = await db.campaignContact.findUnique({
    where: { id: campaignContactId },
    include: {
      contact: true,
      campaign: { include: { agent: true } },
    },
  });
  if (!cc) return;
  if (cc.status !== "DIALING") {
    log(`[dial] stale job for ${campaignContactId} (status=${cc.status}) — skipped`);
    return;
  }
  const { campaign, contact } = cc;

  // Dial-time DNC re-check (contact may have opted out since the tick).
  if (contact.dnc || contact.optOutAt) {
    await db.campaignContact.update({ where: { id: cc.id }, data: { status: "SKIPPED_DNC", lastResult: "skipped:dnc" } });
    log(`[dial] ${contact.phone}: DNC skip at dial time`);
    return;
  }
  const dnc = await db.dncEntry.findFirst({
    where: { workspaceId: campaign.workspaceId, phone: contact.phone },
    select: { id: true },
  });
  if (dnc) {
    await db.campaignContact.update({ where: { id: cc.id }, data: { status: "SKIPPED_DNC", lastResult: "skipped:dnc" } });
    log(`[dial] ${contact.phone}: DncEntry skip at dial time`);
    return;
  }

  // Caller id for fromNumber/analytics: the pool number claimed by the scheduler,
  // else the workspace's FIRST DID (guide 08 joins Call.fromNumber → PhoneNumber.number,
  // so fromNumber must ALWAYS be a real E.164 number — never a placeholder).
  let fromNumber: string | null = null;
  if (job.data.phoneNumberId) {
    const pn = await db.phoneNumber.findUnique({ where: { id: job.data.phoneNumberId }, select: { number: true } });
    fromNumber = pn?.number ?? null;
  } else {
    const pn = await db.phoneNumber.findFirst({
      where: { workspaceId: campaign.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { number: true },
    });
    fromNumber = pn?.number ?? null;
  }
  if (!fromNumber) {
    await db.campaignContact.update({
      where: { id: cc.id },
      data: { status: "FAILED", lastResult: "failed" },
    });
    log(`[dial] ${contact.phone}: FAILED — no DID in workspace for fromNumber (add one in /campaigns/pools or /numbers)`);
    return;
  }

  let result: "completed" | Disposition;
  let callId: string | null = null;
  if (DRY_RUN) {
    result = simulateResult();
  } else {
    try {
      // A/B + version routing (guide 05): pick the serving published version.
      const wf = await resolveWorkflowForAgent(campaign.agent, campaign.workspaceId, contact.phone);
      if (!wf) throw new Error("agent not published (missing Dograh ids)");
      // Exact Dograh contract (guide 04): POST /api/v1/public/agent/workflow/{uuid}
      // { phone_number, initial_context } → { status, workflow_run_id }.
      // opening_hook / objection_playbook / amd_policy travel in initial_context —
      // the workflow prompt references them (guide 05's builder documents the keys).
      const run = await dograhTriggerCall(wf.dograhWorkflowUuid, {
        phoneNumber: contact.phone,
        initialContext: {
          name: contact.name ?? "",
          caller_id: fromNumber,
          opening_hook: campaign.openingHook ?? "",
          objection_playbook: campaign.objectionPlaybook ?? "",
          amd_policy: campaign.amdPolicy, // LEAVE_MESSAGE → agent leaves the template message on voicemail
          campaign_type: campaign.type,
          ...(contact.attributes as Record<string, string> | null ?? {}),
        },
      });
      const call = await db.call.create({
        data: {
          workspaceId: campaign.workspaceId,
          dograhCallId: `${wf.dograhWorkflowId}:${run.workflow_run_id}`,
          direction: "OUTBOUND",
          status: "RINGING",
          fromNumber,
          toNumber: contact.phone,
          agentId: campaign.agentId,
          campaignId: campaign.id,
        },
      });
      callId = call.id;
      result = "completed"; // call placed; final outcome arrives via webhook (Step 10 reconciles)
    } catch (e) {
      console.error("[dial] dograh error", e);
      result = "failed"; // infra failure is retryable via policy
    }
  }

  const attempts = cc.attempts + 1;
  const policy = parseRetryPolicy(campaign.retryPolicy);
  const defaults = { maxAttempts: campaign.maxAttempts, retryDelayMin: campaign.retryDelayMin };
  const success = result === "completed";
  const next = success
    ? { retry: false, nextAttemptAt: null }
    : computeNextRetry(policy, result as Disposition, attempts, defaults, new Date(), Math.random);

  await db.campaignContact.update({
    where: { id: cc.id },
    data: {
      attempts,
      lastResult: result,
      lastCallId: callId ?? cc.lastCallId,
      status: success ? "COMPLETED" : next.retry ? "RETRY_SCHEDULED" : "FAILED",
      nextAttemptAt: next.nextAttemptAt,
    },
  });
  log(`[dial] ${contact.phone}: ${result} (attempt ${attempts}/${defaults.maxAttempts}${campaign.predictiveDialing ? ", predictive" : ""})`);
  if (DRY_RUN) {
    // Visibility for the dry-run tests: proves mid-flight script edits + AMD policy
    // reach the dial path (in real mode they travel in initial_context).
    log(`[dial] dry-run context hook="${(campaign.openingHook ?? "").slice(0, 40)}" amd=${campaign.amdPolicy} from=${fromNumber}`);
  }

  await maybeSendWhatsAppFallback({
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    phone: contact.phone,
    name: contact.name,
    retryPolicyJson: campaign.retryPolicy,
    disposition: result,
    retryExhausted: !success && !next.retry,
  });
}

/** guide 06 contract: dial a CallbackTask's phone, mark the task DONE. */
export async function callbackDialJob(job: Job<CallbackDialJobData>): Promise<void> {
  const { workspaceId, callbackTaskId, phone } = job.data;
  // Claim atomically: only the first job flips PENDING → DONE.
  const claim = await db.callbackTask.updateMany({
    where: { id: callbackTaskId, workspaceId, status: "PENDING" },
    data: { status: "DONE", completedAt: new Date() },
  });
  if (claim.count === 0) {
    log(`[callback-dial] task ${callbackTaskId} already handled — skipped`);
    return;
  }
  const task = await db.callbackTask.findUnique({ where: { id: callbackTaskId } });
  const fail = async (reason: string, cancel = false) => {
    await db.callbackTask.updateMany({
      where: { id: callbackTaskId },
      data: cancel ? { status: "CANCELLED", completedAt: null } : { status: "PENDING", completedAt: null },
    });
    log(`[callback-dial] ${phone}: ${reason}`);
  };

  const dnc = await db.dncEntry.findFirst({ where: { workspaceId, phone }, select: { id: true } });
  if (dnc) return fail("on DNC — callback cancelled", true);

  // Agent resolution, in priority order: (1) agentId on the job payload (newer
  // guide 06 producers), (2) the campaign's agent when the task came from a
  // campaign, (3) the workspace's inbound agent (first PhoneNumber with an agent).
  let agent: Agent | null = null;
  if (job.data.agentId) {
    agent = await db.agent.findFirst({ where: { id: job.data.agentId, workspaceId, status: "PUBLISHED" } });
  }
  if (!agent && task?.campaignId) {
    const camp = await db.campaign.findUnique({ where: { id: task.campaignId }, include: { agent: true } });
    agent = camp?.agent ?? null;
  }
  if (!agent) {
    const pn = await db.phoneNumber.findFirst({
      where: { workspaceId, agentId: { not: null } },
      include: { agent: true },
    });
    agent = pn?.agent ?? null;
  }
  if (!agent) return fail("no agent available — callback cancelled", true);

  if (DRY_RUN) {
    log(`[callback-dial] DRY RUN → would dial ${phone} (task ${callbackTaskId}${task?.note ? `, note: ${task.note}` : ""}${job.data.reason ? `, reason: ${job.data.reason}` : ""})`);
    return;
  }
  try {
    const wf = await resolveWorkflowForAgent(agent, workspaceId, phone);
    if (!wf) throw new Error("agent not published");
    // fromNumber must be a real E.164 DID (guide 08 joins on it): prefer the DID
    // assigned to the resolved agent, else the workspace's first DID.
    const did = (await db.phoneNumber.findFirst({
      where: { workspaceId, agentId: agent.id },
      orderBy: { createdAt: "asc" },
      select: { number: true },
    })) ?? (await db.phoneNumber.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { number: true },
    }));
    if (!did) {
      await db.callbackTask.updateMany({ where: { id: callbackTaskId }, data: { status: "CANCELLED" } });
      log(`[callback-dial] ${phone}: CANCELLED — no DID in workspace for fromNumber`);
      return;
    }
    const run = await dograhTriggerCall(wf.dograhWorkflowUuid, {
      phoneNumber: phone,
      initialContext: { callback_note: task?.note ?? job.data.reason ?? "", is_callback: "true" },
    });
    await db.call.create({
      data: {
        workspaceId,
        dograhCallId: `${wf.dograhWorkflowId}:${run.workflow_run_id}`,
        direction: "OUTBOUND",
        status: "RINGING",
        fromNumber: did.number,
        toNumber: phone,
        agentId: agent.id,
        campaignId: task?.campaignId ?? null,
      },
    });
    log(`[callback-dial] dialed ${phone} (task ${callbackTaskId})`);
  } catch (e) {
    console.error("[callback-dial] dograh error", e);
    await fail("dial failed — task back to PENDING for job retry");
    throw e; // let BullMQ backoff retry the job
  }
}

/** guide 06 contract: manual click-to-call from the web dialer. */
export async function manualDialJob(job: Job<ManualDialJobData>): Promise<void> {
  const { workspaceId, callId, fromNumber, toNumber } = job.data;
  const call = await db.call.findFirst({ where: { id: callId, workspaceId } });
  if (!call) {
    log(`[manual-dial] call row ${callId} not found in workspace — dropped`);
    return;
  }
  // Worker-side DNC re-check (producer guards too — defense in depth).
  const dnc = await db.dncEntry.findFirst({ where: { workspaceId, phone: toNumber }, select: { id: true } });
  if (dnc) {
    await db.call.update({ where: { id: call.id }, data: { status: "FAILED", outcome: "blocked:dnc" } });
    log(`[manual-dial] ${toNumber} on DNC — call ${callId} marked failed`);
    return;
  }
  const pn = await db.phoneNumber.findFirst({
    where: { workspaceId, number: fromNumber },
    include: { agent: true },
  });
  const agent = pn?.agent;
  if (DRY_RUN) {
    log(`[manual-dial] DRY RUN → would dial ${toNumber} from ${fromNumber} (call ${callId})`);
    return;
  }
  try {
    if (!agent) throw new Error("no agent on that number");
    const wf = await resolveWorkflowForAgent(agent, workspaceId, toNumber);
    if (!wf) throw new Error("no published agent on that number");
    const run = await dograhTriggerCall(wf.dograhWorkflowUuid, {
      phoneNumber: toNumber,
      initialContext: { manual_dial: "true" },
    });
    await db.call.update({
      where: { id: call.id },
      data: { dograhCallId: `${wf.dograhWorkflowId}:${run.workflow_run_id}`, agentId: agent.id },
    });
    log(`[manual-dial] dialed ${toNumber} from ${fromNumber}`);
  } catch (e) {
    console.error("[manual-dial] dograh error", e);
    await db.call.update({ where: { id: call.id }, data: { status: "FAILED" } });
    throw e;
  }
}

/** Throttled WhatsApp campaign send (readme §9). */
export async function whatsappSendJob(job: Job<WhatsAppSendJobData>): Promise<void> {
  const { workspaceId, whatsAppCampaignId, phone, templateName, params, index, total } = job.data;
  const res = await sendWhatsAppGated({ to: phone, template: templateName, params });
  log(`[whatsapp-send] ${whatsAppCampaignId}: ${index + 1}/${total} to=${phone} ok=${res.ok}${res.dryRun ? " (dry-run)" : ""}${res.error ? ` error=${res.error}` : ""}`);
  if (index === total - 1) {
    await db.whatsAppCampaign.updateMany({
      where: { id: whatsAppCampaignId, workspaceId, status: "RUNNING" },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
    log(`[whatsapp-send] ${whatsAppCampaignId}: COMPLETED (${total} messages)`);
  }
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.
**If it fails:** `Property 'dograhWorkflowUuid' does not exist on type 'Agent'` →
guide 04's additive migration wasn't applied; run `npx prisma migrate dev` once,
`npx prisma generate`, re-typecheck. Still failing → STOP and report.

---

## Step 9: Worker part 3 — cron maintenance + post-call sweep + bootstrap

First a tiny pure helper for the WhatsApp fallback decision (unit-tested), used by
`dial.ts` and the reconciliation sweep.

**File `src/lib/campaign/fallback.ts`** (full content):

```ts
/**
 * Call-to-WhatsApp fallback decision (readme §9): fire only when the contact is
 * finally unreachable by voice — retries exhausted AND the last disposition is
 * no-answer — and a fallback template is configured.
 */
import { parseCampaignExtras } from "./retry";

export function shouldSendWhatsAppFallback(input: {
  retryPolicyJson: unknown;
  disposition: string;
  retryExhausted: boolean;
}): { send: boolean; templateId?: string } {
  if (!input.retryExhausted || input.disposition !== "no-answer") return { send: false };
  const extras = parseCampaignExtras(input.retryPolicyJson);
  if (!extras.whatsappFallbackTemplateId) return { send: false };
  return { send: true, templateId: extras.whatsappFallbackTemplateId };
}
```

**File `tests/campaign-fallback.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { shouldSendWhatsAppFallback } from "../src/lib/campaign/fallback";

const POLICY = { busy: { attempts: 3, delayMin: 30 }, whatsappFallbackTemplateId: "tpl_1" };

describe("shouldSendWhatsAppFallback", () => {
  it("fires only on final no-answer with a configured template", () => {
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "no-answer", retryExhausted: true }))
      .toEqual({ send: true, templateId: "tpl_1" });
  });
  it("does NOT fire when retries remain, on other dispositions, or without a template", () => {
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "no-answer", retryExhausted: false }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "busy", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "voicemail", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "completed", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: { busy: { attempts: 3, delayMin: 30 } }, disposition: "no-answer", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: null, disposition: "no-answer", retryExhausted: true }).send).toBe(false);
  });
});
```

**File `src/worker/maintenance.ts`** (full content):

```ts
/**
 * node-cron maintenance (worker process):
 * - sweepDueCallbacks: PENDING CallbackTasks due now → enqueue `callback-dial`
 *   (safety net alongside the delayed jobs enqueued at creation time; the
 *   callbackDialJob claim makes double-enqueue harmless).
 * - sweepPostCalls: post-call intelligence + reconciliation on campaign calls.
 * - resetDailyCaps: nightly PhoneNumber.dailyCallsUsed = 0.
 *
 * Webhook emission note: `call.completed` etc. are emitted by guide 06's Dograh
 * webhook receiver — this module NEVER re-emits call-level events. It only emits
 * campaign-domain events (campaign.finished, lead.qualified, contact.opted-out)
 * and transfer.requested for the TransferRequests it creates itself.
 */
import { PrismaClient } from "@prisma/client";
import { getDialerQueue, CALLBACK_DIAL_JOB } from "../lib/queue";
import { buildCallbackDialJob } from "../lib/dialJobs"; // guide 06 producer helpers
import { parseRetryPolicy, computeNextRetry, type Disposition } from "../lib/campaign/retry";
import { shouldSendWhatsAppFallback } from "../lib/campaign/fallback";
import { sendWhatsAppGated } from "./whatsapp";
import { detectOptOut, needsHumanEscalation } from "../lib/campaign/scoring";
import { effectiveTimezone } from "../lib/campaign/windows";
import { classifyInterest, extractCallback } from "./llm";
import { emitWebhookEvent } from "../lib/webhooks";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Nightly: reset per-number daily counters (readme §6.1 daily caps). */
export async function resetDailyCaps(): Promise<void> {
  const res = await db.phoneNumber.updateMany({
    where: { dailyCallsUsed: { gt: 0 } },
    data: { dailyCallsUsed: 0 },
  });
  log(`[cron] daily cap reset: ${res.count} number(s)`);
}

/** Every minute: enqueue due callbacks. */
export async function sweepDueCallbacks(): Promise<void> {
  const due = await db.callbackTask.findMany({
    where: { status: "PENDING", dueAt: { lte: new Date() } },
    take: 20,
  });
  for (const t of due) {
    const jobDef = buildCallbackDialJob(
      { workspaceId: t.workspaceId, callbackTaskId: t.id, phone: t.phone, note: t.note ?? undefined, dueAt: t.dueAt },
      new Date()
    );
    // jobId dedupes repeat sweeps; a same-task delayed job from guide 06 may still
    // coexist — the callbackDialJob PENDING→DONE claim makes that harmless.
    await getDialerQueue().add(CALLBACK_DIAL_JOB, jobDef.data, { ...jobDef.opts, delay: 0, jobId: `cb-${t.id}` });
    log(`[cron] callback due → enqueued ${t.phone} (task ${t.id})`);
  }
}

/** Reconcile a real call whose webhook outcome needs a retry (no-answer/busy/
 *  voicemail) but whose CampaignContact was marked COMPLETED at trigger time. */
async function reconcileCall(call: {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  status: string;
  amdResult: string;
  toNumber: string;
}): Promise<void> {
  if (!call.campaignId) return;
  const cc = await db.campaignContact.findFirst({
    where: { campaignId: call.campaignId, lastCallId: call.id, status: "COMPLETED" },
    include: { campaign: true, contact: { select: { phone: true, name: true } } },
  });
  if (!cc) return; // already reconciled

  const disposition: Disposition =
    call.status === "VOICEMAIL" || call.amdResult === "MACHINE" ? "voicemail"
    : call.status === "BUSY" ? "busy"
    : "no-answer";
  const policy = parseRetryPolicy(cc.campaign.retryPolicy);
  const defaults = { maxAttempts: cc.campaign.maxAttempts, retryDelayMin: cc.campaign.retryDelayMin };
  const next = computeNextRetry(policy, disposition, cc.attempts, defaults, new Date(), Math.random);

  await db.campaignContact.update({
    where: { id: cc.id },
    data: {
      lastResult: disposition,
      status: next.retry ? "RETRY_SCHEDULED" : "FAILED",
      nextAttemptAt: next.nextAttemptAt,
    },
  });
  log(`[postcall] reconcile ${call.toNumber}: ${disposition} → ${next.retry ? "retry" : "FAILED"}`);

  const fb = shouldSendWhatsAppFallback({
    retryPolicyJson: cc.campaign.retryPolicy,
    disposition,
    retryExhausted: !next.retry,
  });
  if (fb.send && fb.templateId) {
    const tpl = await db.whatsAppTemplate.findFirst({
      where: { id: fb.templateId, workspaceId: call.workspaceId, status: "APPROVED" },
    });
    if (tpl) {
      const res = await sendWhatsAppGated({ to: call.toNumber, template: tpl.name, params: [cc.contact.name ?? "Customer"] });
      log(`[postcall] whatsapp-fallback to=${call.toNumber} ok=${res.ok}${res.dryRun ? " (dry-run)" : ""}${res.error ? ` error=${res.error}` : ""}`);
    }
  }
}

/** Opt-out cascade (readme §11): "stop calling me" honored instantly — DncEntry +
 *  contact flag + removal from ALL active campaign queues in the workspace. */
async function optOutCascade(input: { workspaceId: string; phone: string; callId: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.dncEntry.upsert({
      where: { workspaceId_phone: { workspaceId: input.workspaceId, phone: input.phone } },
      update: {},
      create: { workspaceId: input.workspaceId, phone: input.phone, source: "OPT_OUT", reason: `mid-call opt-out (call ${input.callId})` },
    });
    await tx.contact.updateMany({
      where: { workspaceId: input.workspaceId, phone: input.phone },
      data: { dnc: true, optOutAt: new Date() },
    });
    const removed = await tx.campaignContact.updateMany({
      where: {
        status: { in: ["PENDING", "RETRY_SCHEDULED"] },
        contact: { workspaceId: input.workspaceId, phone: input.phone },
        campaign: { workspaceId: input.workspaceId, status: { in: ["DRAFT", "RUNNING", "PAUSED"] } },
      },
      data: { status: "SKIPPED_DNC", lastResult: "skipped:opt-out" },
    });
    log(`[postcall] OPT-OUT cascade ${input.phone}: removed from ${removed.count} campaign queue(s)`);
  });
  await emitWebhookEvent(input.workspaceId, "contact.opted-out", { phone: input.phone, callId: input.callId });
}

/** Post-call sweep (every minute): interest scoring, callback extraction, opt-out
 *  cascade, sentiment escalation, and retry reconciliation. Processes calls whose
 *  interestReason is still null (marker: we always write it after processing). */
export async function sweepPostCalls(): Promise<void> {
  // 1) Retry reconciliation for ended-but-unsuccessful real calls.
  const unsuccessful = await db.call.findMany({
    where: {
      direction: "OUTBOUND",
      campaignId: { not: null },
      OR: [{ status: { in: ["NO_ANSWER", "BUSY", "VOICEMAIL"] } }, { amdResult: "MACHINE" }],
    },
    take: 20,
    orderBy: { createdAt: "asc" },
  });
  for (const call of unsuccessful) await reconcileCall(call);

  // 2) Intelligence on completed calls with a transcript.
  const done = await db.call.findMany({
    where: {
      direction: "OUTBOUND",
      campaignId: { not: null },
      status: "COMPLETED",
      interestScore: null,
      interestReason: null,
      transcript: { not: null },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
    include: { campaign: { select: { type: true, timezoneWindows: true } } },
  });
  for (const call of done) {
    const transcript = call.transcript ?? "";
    const contact = await db.contact.findFirst({
      where: { workspaceId: call.workspaceId, phone: call.toNumber },
      select: { id: true, timezone: true },
    });

    // a) interest scoring (LLM; dry-run mock)
    const scored = await classifyInterest({ transcript, campaignType: call.campaign?.type ?? "LEAD_QUALIFICATION" });
    await db.call.update({
      where: { id: call.id },
      data: scored
        ? { interestScore: scored.score, interestReason: scored.reason }
        : { interestReason: "unscored" }, // marker so we don't reprocess forever
    });
    if (scored?.score === "HOT") {
      await emitWebhookEvent(call.workspaceId, "lead.qualified", {
        callId: call.id, phone: call.toNumber, score: "HOT", reason: scored.reason,
      });
    }

    // b) opt-out cascade — runs BEFORE callback scheduling (compliance first).
    //    An opted-out caller gets NO callback; an angry one still gets the human flag.
    const optedOut = detectOptOut({ outcome: call.outcome, transcript });
    if (optedOut) {
      await optOutCascade({ workspaceId: call.workspaceId, phone: call.toNumber, callId: call.id });
    }

    // c) callback extraction ("call me tomorrow at 5") — skipped after opt-out
    const cb = optedOut ? { requested: false as const } : await extractCallback({
      transcript,
      timezone: effectiveTimezone({
        now: new Date(),
        contactTimezone: contact?.timezone ?? null,
        windowStart: "09:00",
        windowEnd: "19:00",
        timezoneWindows: null,
      }),
      now: new Date(),
    });
    if (cb.requested && cb.dueAt) {
      const task = await db.callbackTask.create({
        data: {
          workspaceId: call.workspaceId,
          contactId: contact?.id ?? null,
          campaignId: call.campaignId,
          callId: call.id,
          phone: call.toNumber,
          note: cb.note ?? "callback requested mid-call",
          dueAt: cb.dueAt,
        },
      });
      const jobDef = buildCallbackDialJob(
        { workspaceId: call.workspaceId, callbackTaskId: task.id, phone: call.toNumber, note: task.note ?? undefined, dueAt: cb.dueAt },
        new Date()
      );
      await getDialerQueue().add(CALLBACK_DIAL_JOB, jobDef.data, { ...jobDef.opts, jobId: `cb-${task.id}` });
      log(`[postcall] callback scheduled ${call.toNumber} at ${cb.dueAt.toISOString()}`);
    }

    // d) sentiment escalation → human flag (guide 06 TransferRequest contract)
    if (needsHumanEscalation({ sentiment: call.sentiment, outcome: call.outcome, transcript })) {
      await db.transferRequest.create({
        data: {
          workspaceId: call.workspaceId,
          callId: call.id,
          queue: "escalations",
          reason: "angry/abusive caller on outbound call — polite exit done by AI, human follow-up needed",
          contextSnapshot: {
            summary: call.summary ?? null,
            sentiment: call.sentiment ?? null,
            transcriptTail: transcript.slice(-1000),
          },
        },
      });
      await emitWebhookEvent(call.workspaceId, "transfer.requested", { callId: call.id, queue: "escalations" });
      log(`[postcall] escalation → TransferRequest for call ${call.id}`);
    }
  }
}
```

**File `src/worker/index.ts`** (full content — overwrite the old single-file worker):

```ts
/**
 * Campaign worker. Run with: npm run worker
 * - BullMQ: campaign-scheduler (ticks), campaign-dialer (dial / callback-dial /
 *   manual-dial), whatsapp-send (throttled template sends).
 * - node-cron: callback sweep + post-call sweep (every minute), daily cap reset
 *   (03:00).
 * CAMPAIGN_DRY_RUN=true simulates dials AND post-call LLM results — no Dograh, no
 * OpenRouter, no cost.
 */
import { Worker } from "bullmq";
import cron from "node-cron";
import { createRedisConnection, QUEUES } from "../lib/queue";
import type { DialJobData, CallbackDialJobData, ManualDialJobData, WhatsAppSendJobData } from "../lib/queue";
import { DIAL_JOB, CALLBACK_DIAL_JOB, MANUAL_DIAL_JOB, WHATSAPP_SEND_JOB } from "../lib/queue";
import { schedulerTick } from "./campaignTick";
import { dialJob, callbackDialJob, manualDialJob, whatsappSendJob } from "./dial";
import { resetDailyCaps, sweepDueCallbacks, sweepPostCalls } from "./maintenance";

const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false"; // default true — safe
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function main() {
  log(`worker starting (CAMPAIGN_DRY_RUN=${DRY_RUN}, TRAI_HOURS_ENFORCE=${process.env.TRAI_HOURS_ENFORCE ?? "true"}, REQUIRE_CONSENT=${process.env.REQUIRE_CONSENT_FOR_PROMOTIONAL ?? "false"})`);
  const connection = createRedisConnection();

  new Worker(QUEUES.scheduler, schedulerTick, { connection, concurrency: 5 });

  new Worker<DialJobData | CallbackDialJobData | ManualDialJobData>(
    QUEUES.dialer,
    async (job) => {
      switch (job.name) {
        case DIAL_JOB:
          return dialJob(job as never);
        case CALLBACK_DIAL_JOB:
          return callbackDialJob(job as never);
        case MANUAL_DIAL_JOB:
          return manualDialJob(job as never);
        default:
          log(`[dialer] unknown job name "${job.name}" — ignored`);
      }
    },
    { connection, concurrency: 10 }
  );

  new Worker<WhatsAppSendJobData>(QUEUES.whatsapp, whatsappSendJob, {
    connection,
    concurrency: 2,
    limiter: { max: 5, duration: 1000 }, // 5 msgs/sec — provider-friendly throttle
  });

  cron.schedule("* * * * *", () => {
    sweepDueCallbacks().catch((e) => console.error("[cron] sweepDueCallbacks", e));
    sweepPostCalls().catch((e) => console.error("[cron] sweepPostCalls", e));
  });
  cron.schedule("0 3 * * *", () => {
    resetDailyCaps().catch((e) => console.error("[cron] resetDailyCaps", e));
  });

  log("worker ready — scheduler + dialer + whatsapp + cron (callbacks, post-call, nightly cap reset)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/campaign-fallback.test.ts && npm run typecheck && npm run build
```
**Expected:** fallback tests pass; typecheck + build exit 0.
**If it fails:** `Cannot find module '../lib/dialJobs'` → guide 06 Step 9 file missing;
confirm `ls src/lib/dialJobs.ts` — do NOT recreate it here, report if absent. Build
error about `node-cron` types → confirm Step 1 installed `@types/node-cron@3.0.11`.

---

## Step 10: Campaign pages (list, new with preset cards, detail with live control)

All interactive elements carry stable `data-testid` attributes (Playwright suite is
guide 11 — the flows are listed in this guide's acceptance section).

**File `src/app/(app)/campaigns/page.tsx`** (full content — overwrite):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CAMPAIGN_PRESETS } from "@/lib/campaign/presets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  SCHEDULED: "bg-blue-500/10 text-blue-400",
  RUNNING: "bg-green-500/10 text-green-400 animate-pulse",
  PAUSED: "bg-orange-500/10 text-orange-400",
  COMPLETED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-red-500/10 text-red-400",
};

export default async function CampaignsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const campaigns = await db.campaign.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: {
      agent: { select: { name: true } },
      list: { select: { name: true } },
      pool: { select: { name: true } },
      _count: { select: { contacts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6" data-testid="campaign-list">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild data-testid="pools-link"><Link href="/campaigns/pools">Number pools</Link></Button>
          <Button variant="outline" asChild data-testid="whatsapp-link"><Link href="/campaigns/whatsapp">WhatsApp</Link></Button>
          <Button asChild data-testid="new-campaign-button"><Link href="/campaigns/new">New campaign</Link></Button>
        </div>
      </div>
      {campaigns.length === 0 && (
        <p className="text-muted-foreground">No campaigns yet. Upload contacts, publish an agent, then launch.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {campaigns.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} data-testid="campaign-card">
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`} data-testid="campaign-status-pill">{c.status}</span>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>{CAMPAIGN_PRESETS[c.type]?.label ?? c.type}{c.predictiveDialing ? " · predictive" : ""}</p>
                <p>Agent: {c.agent.name} · List: {c.list.name}{c.pool ? ` · Pool: ${c.pool.name}` : ""}</p>
                <p>{c._count.contacts} contacts · {c.callsPerMinute}/min · {c.concurrency} concurrent</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

**File `src/app/(app)/campaigns/new/page.tsx`** (full content — overwrite):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CAMPAIGN_PRESETS } from "@/lib/campaign/presets";
import { NewCampaignForm } from "./new-campaign-form";

export default async function NewCampaignPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const [agents, lists, pools, waTemplates] = await Promise.all([
    db.agent.findMany({ where: { workspaceId: ctx.workspaceId, status: "PUBLISHED" }, select: { id: true, name: true } }),
    db.contactList.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { contacts: true } } } }),
    db.numberPool.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { numbers: true } } } }),
    db.whatsAppTemplate.findMany({ where: { workspaceId: ctx.workspaceId, status: "APPROVED" }, select: { id: true, name: true } }),
  ]);

  // Serialize presets for the client component (plain JSON only).
  const presets = Object.values(CAMPAIGN_PRESETS).map((p) => ({
    type: p.type,
    label: p.label,
    description: p.description,
    retryPolicy: p.retryPolicy,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    days: p.days,
    openingHook: p.openingHook,
    objectionPlaybook: p.objectionPlaybook,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="new-campaign-page">
      <h1 className="text-2xl font-bold">New campaign</h1>
      {agents.length === 0 && (
        <p className="text-yellow-400">You need a PUBLISHED agent first (Agents → Publish).</p>
      )}
      <NewCampaignForm
        agents={agents}
        lists={lists.map((l) => ({ id: l.id, name: l.name, count: l._count.contacts }))}
        pools={pools.map((p) => ({ id: p.id, name: p.name, count: p._count.numbers }))}
        waTemplates={waTemplates}
        presets={presets}
      />
    </div>
  );
}
```

**File `src/app/(app)/campaigns/new/new-campaign-form.tsx`** (client, full content):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction } from "@/server/actions/campaigns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Preset = {
  type: string;
  label: string;
  description: string;
  retryPolicy: Record<string, { attempts: number; delayMin: number }>;
  windowStart: string;
  windowEnd: string;
  days: number[];
  openingHook: string;
  objectionPlaybook: string;
};

export function NewCampaignForm(props: {
  agents: { id: string; name: string }[];
  lists: { id: string; name: string; count: number }[];
  pools: { id: string; name: string; count: number }[];
  waTemplates: { id: string; name: string }[];
  presets: Preset[];
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset | null>(null);
  const [retryJson, setRetryJson] = useState("{}");
  const [windowsJson, setWindowsJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPreset(p: Preset) {
    setPreset(p);
    setRetryJson(JSON.stringify(p.retryPolicy, null, 2));
    setWindowsJson(JSON.stringify({ days: p.days }, null, 2));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    let retryPolicy: unknown = null;
    let timezoneWindows: unknown = null;
    try {
      retryPolicy = retryJson.trim() && retryJson.trim() !== "{}" ? JSON.parse(retryJson) : null;
      timezoneWindows = windowsJson.trim() && windowsJson.trim() !== "{}" ? JSON.parse(windowsJson) : null;
    } catch {
      setBusy(false);
      return setError("Retry policy / windows must be valid JSON.");
    }
    const res = await createCampaignAction({
      name: f.get("name"),
      type: preset?.type ?? "LEAD_QUALIFICATION",
      agentId: f.get("agentId"),
      listId: f.get("listId"),
      poolId: f.get("poolId") || null,
      callsPerMinute: f.get("callsPerMinute"),
      concurrency: f.get("concurrency"),
      maxAttempts: f.get("maxAttempts"),
      retryDelayMin: f.get("retryDelayMin"),
      callingWindowStart: f.get("callingWindowStart") || preset?.windowStart || "09:00",
      callingWindowEnd: f.get("callingWindowEnd") || preset?.windowEnd || "19:00",
      retryPolicy,
      timezoneWindows,
      openingHook: f.get("openingHook") || preset?.openingHook || null,
      objectionPlaybook: f.get("objectionPlaybook") || preset?.objectionPlaybook || null,
      amdPolicy: f.get("amdPolicy"),
      predictiveDialing: f.get("predictiveDialing") === "on",
      whatsappFallbackTemplateId: f.get("waFallback") || null,
      applyPreset: false, // preset values already merged client-side
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not create campaign.");
    router.push(`/campaigns/${res.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="campaign-form">
      <section>
        <h2 className="mb-2 text-lg font-semibold">1 · Campaign type</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {props.presets.map((p) => (
            <button
              type="button"
              key={p.type}
              data-testid={`preset-card-${p.type}`}
              onClick={() => pickPreset(p)}
              className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                preset?.type === p.type ? "border-primary bg-primary/10" : "hover:border-primary/40"
              }`}
            >
              <p className="font-semibold">{p.label}</p>
              <p className="text-muted-foreground">{p.description}</p>
            </button>
          ))}
        </div>
        {!preset && <p className="mt-1 text-xs text-muted-foreground">No preset selected — defaults to Lead qualification with empty policy.</p>}
      </section>

      <Card>
        <CardHeader><CardTitle>2 · Basics</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input name="name" placeholder="Campaign name" required data-testid="campaign-name-input" />
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Agent (PUBLISHED)</span>
            <select name="agentId" required data-testid="agent-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              {props.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Contact list</span>
            <select name="listId" required data-testid="list-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              {props.lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Number pool (optional — rotation + caps)</span>
            <select name="poolId" data-testid="pool-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— no pool (single trunk DID) —</option>
              {props.pools.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.count} numbers)</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3 · Pacing & retries</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Calls/minute cap</span>
              <Input name="callsPerMinute" type="number" defaultValue={10} min={1} max={60} data-testid="cpm-input" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Max concurrent calls</span>
              <Input name="concurrency" type="number" defaultValue={2} min={1} max={50} data-testid="concurrency-input" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Max attempts (fallback)</span>
              <Input name="maxAttempts" type="number" defaultValue={2} min={1} max={5} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Retry delay min (fallback)</span>
              <Input name="retryDelayMin" type="number" defaultValue={60} min={5} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              Retry policy JSON — per disposition overrides (busy / no-answer / failed / voicemail)
            </span>
            <textarea
              value={retryJson}
              onChange={(e) => setRetryJson(e.target.value)}
              rows={5}
              data-testid="retry-policy-editor"
              className="w-full rounded-md border border-border bg-card p-2 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="predictiveDialing" data-testid="predictive-toggle" />
            Predictive dial-ahead (§15 — over-book slots 1.5×; AI always picks up, abandonment ≈ 0)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>4 · Schedule & windows</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Window start</span>
              <Input name="callingWindowStart" defaultValue={preset?.windowStart ?? "09:00"} pattern="\d{2}:\d{2}" data-testid="window-start-input" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Window end</span>
              <Input name="callingWindowEnd" defaultValue={preset?.windowEnd ?? "19:00"} pattern="\d{2}:\d{2}" data-testid="window-end-input" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              Timezone windows JSON — {"{"}&quot;timezone&quot;:&quot;Asia/Kolkata&quot;,&quot;days&quot;:[1,2,3,4,5],&quot;windows&quot;:[[&quot;09:00&quot;,&quot;13:00&quot;]]{"}"} (empty = every day, window above)
            </span>
            <textarea
              value={windowsJson}
              onChange={(e) => setWindowsJson(e.target.value)}
              rows={3}
              data-testid="windows-editor"
              className="w-full rounded-md border border-border bg-card p-2 font-mono text-xs"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Guardrails always on: per-contact timezone windows, TRAI 09:00–21:00 for
            SERIES_140 pools, DNC + consent checks at schedule AND dial time.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>5 · Conversation & fallback</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Opening hook (first 15 seconds, incl. identity disclosure)</span>
            <textarea name="openingHook" rows={3} defaultValue={preset?.openingHook ?? ""} data-testid="opening-hook-input" className="w-full rounded-md border border-border bg-card p-2 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Objection playbook</span>
            <textarea name="objectionPlaybook" rows={4} defaultValue={preset?.objectionPlaybook ?? ""} data-testid="objection-playbook-input" className="w-full rounded-md border border-border bg-card p-2 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Voicemail / AMD policy</span>
            <select name="amdPolicy" data-testid="amd-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="HANGUP">Hang up on voicemail</option>
              <option value="LEAVE_MESSAGE">Leave a message</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Call-to-WhatsApp fallback (on final no-answer, optional)</span>
            <select name="waFallback" data-testid="wa-fallback-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— none —</option>
              {props.waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-400" data-testid="campaign-form-error">{error}</p>}
      <Button type="submit" disabled={busy} data-testid="create-campaign-submit">
        {busy ? "Creating…" : "Create campaign"}
      </Button>
    </form>
  );
}
```

**File `src/app/(app)/campaigns/[id]/page.tsx`** (full content — overwrite):

```tsx
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import {
  startCampaignAction,
  pauseCampaignAction,
  cancelCampaignAction,
  updateCampaignScriptAction,
} from "@/server/actions/campaigns";
import { CAMPAIGN_PRESETS } from "@/lib/campaign/presets";
import { CsvUploader } from "../../contacts/csv-uploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic"; // always fresh status

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: {
      agent: { select: { name: true } },
      list: { select: { name: true } },
      pool: { select: { name: true } },
    },
  });
  if (!campaign) notFound();

  const stats = await db.campaignContact.groupBy({
    by: ["status"],
    where: { campaignId: campaign.id },
    _count: true,
  });
  const count = (s: string) => stats.find((x) => x.status === s)?._count ?? 0;
  const total = stats.reduce((a, x) => a + x._count, 0);
  const done = count("COMPLETED") + count("FAILED") + count("SKIPPED_DNC");
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  const recent = await db.campaignContact.findMany({
    where: { campaignId: campaign.id },
    include: { contact: { select: { phone: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  const editable = ["DRAFT", "RUNNING", "PAUSED"].includes(campaign.status);

  async function start() { "use server"; await startCampaignAction(campaign!.id); }
  async function pause() { "use server"; await pauseCampaignAction(campaign!.id); }
  async function cancel() { "use server"; await cancelCampaignAction(campaign!.id); }
  async function saveScript(formData: FormData) {
    "use server";
    await updateCampaignScriptAction({
      campaignId: campaign!.id,
      openingHook: String(formData.get("openingHook") ?? ""),
      objectionPlaybook: String(formData.get("objectionPlaybook") ?? ""),
    });
  }

  return (
    <div className="space-y-6" data-testid="campaign-detail">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">{campaign.name}</h1>
        <span className="rounded-full border px-3 py-1 text-sm" data-testid="campaign-status-pill">{campaign.status}</span>
        <span className="text-sm text-muted-foreground">{CAMPAIGN_PRESETS[campaign.type]?.label ?? campaign.type}</span>
        <div className="ml-auto flex gap-2">
          {["DRAFT", "PAUSED"].includes(campaign.status) && (
            <form action={start}><Button data-testid="resume-button">▶ Start</Button></form>
          )}
          {campaign.status === "RUNNING" && (
            <form action={pause}><Button variant="outline" data-testid="pause-button">⏸ Pause</Button></form>
          )}
          {editable && (
            <form action={cancel}><Button variant="destructive" data-testid="cancel-button">Cancel</Button></form>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex justify-between text-sm text-muted-foreground">
            <span>
              Agent: {campaign.agent.name} · List: {campaign.list.name}
              {campaign.pool ? ` · Pool: ${campaign.pool.name}` : ""} · {campaign.callsPerMinute}/min ·{" "}
              {campaign.concurrency} concurrent · window {campaign.callingWindowStart}–{campaign.callingWindowEnd}
              {campaign.predictiveDialing ? " · predictive" : ""}
            </span>
            <span data-testid="progress-percent">{progress}%</span>
          </div>
          <div className="h-2 w-full rounded bg-muted" data-testid="progress-bar">
            <div className="h-2 rounded bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6" data-testid="stats-grid">
            <div><p className="text-lg font-bold">{total}</p><p className="text-muted-foreground">total</p></div>
            <div><p className="text-lg font-bold text-yellow-400">{count("PENDING")}</p><p className="text-muted-foreground">pending</p></div>
            <div><p className="text-lg font-bold text-blue-400">{count("DIALING")}</p><p className="text-muted-foreground">dialing</p></div>
            <div><p className="text-lg font-bold text-green-400">{count("COMPLETED")}</p><p className="text-muted-foreground">completed</p></div>
            <div><p className="text-lg font-bold text-orange-400">{count("RETRY_SCHEDULED")}</p><p className="text-muted-foreground">retry</p></div>
            <div><p className="text-lg font-bold text-red-400">{count("FAILED") + count("SKIPPED_DNC")}</p><p className="text-muted-foreground">failed/dnc</p></div>
          </div>
        </CardContent>
      </Card>

      {editable && (
        <Card data-testid="edit-script-card">
          <CardHeader><CardTitle>Script (editable mid-flight — next dial batch picks it up)</CardTitle></CardHeader>
          <CardContent>
            <form action={saveScript} className="space-y-3" data-testid="edit-script-form">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Opening hook</span>
                <textarea name="openingHook" rows={3} defaultValue={campaign.openingHook ?? ""} className="w-full rounded-md border border-border bg-card p-2 text-sm" data-testid="edit-opening-hook" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Objection playbook</span>
                <textarea name="objectionPlaybook" rows={4} defaultValue={campaign.objectionPlaybook ?? ""} className="w-full rounded-md border border-border bg-card p-2 text-sm" data-testid="edit-objection-playbook" />
              </label>
              <Button type="submit" data-testid="edit-script-submit">Save script</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {editable && (
        <section data-testid="add-contacts-section">
          <h2 className="mb-2 text-lg font-semibold">Add contacts to this campaign</h2>
          <CsvUploader campaignId={campaign.id} />
        </section>
      )}

      <Card>
        <CardHeader><CardTitle>Recent activity (refresh page to update)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="live-status-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Phone</th><th className="p-2">Name</th>
                <th className="p-2">Status</th><th className="p-2">Attempts</th><th className="p-2">Last result</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b last:border-0" data-testid="live-status-row">
                  <td className="p-2 font-mono">{r.contact.phone}</td>
                  <td className="p-2">{r.contact.name ?? "—"}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.attempts}</td>
                  <td className="p-2 text-muted-foreground">{r.lastResult ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** exit 0 both; routes `/campaigns`, `/campaigns/new`, `/campaigns/[id]`.
**If it fails:** JSX/type error in the form — re-create `new-campaign-form.tsx`
exactly (it is the most error-prone file here). Once. Then STOP and report.

---

## Step 11: Pools page, WhatsApp page, contacts page updates

**File `src/app/(app)/campaigns/pools/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { createPoolAction, addNumberToPoolAction, removeNumberFromPoolAction } from "@/server/actions/pools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const NUMBER_TYPES = ["LOCAL", "TOLLFREE", "MOBILE", "SERIES_140", "SERIES_1600"];

export default async function PoolsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const pools = await db.numberPool.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { numbers: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  async function createPool(formData: FormData) {
    "use server";
    await createPoolAction(String(formData.get("name") ?? ""));
  }
  async function addNumber(formData: FormData) {
    "use server";
    await addNumberToPoolAction({
      poolId: formData.get("poolId"),
      number: formData.get("number"),
      label: formData.get("label") || null,
      numberType: formData.get("numberType"),
      dailyCallCap: formData.get("dailyCallCap") ? Number(formData.get("dailyCallCap")) : null,
      lifetimeCallCap: formData.get("lifetimeCallCap") ? Number(formData.get("lifetimeCallCap")) : null,
    });
  }
  async function removeNumber(formData: FormData) {
    "use server";
    await removeNumberFromPoolAction(String(formData.get("id")));
  }

  return (
    <div className="space-y-6" data-testid="pool-editor">
      <h1 className="text-2xl font-bold">Number pools</h1>
      <p className="text-sm text-muted-foreground">
        Pools rotate caller IDs across DIDs with per-number daily/lifetime caps
        (spam-flag protection, readme §6.1). TRAI rule: SERIES_140 = promotional
        (+91140XXXXXXX), SERIES_1600 = service/transactional (+911600XXXXXX) — the
        campaign type decides which series its pool may contain.
      </p>

      <Card>
        <CardHeader><CardTitle>Create pool</CardTitle></CardHeader>
        <CardContent>
          <form action={createPool} className="flex gap-2" data-testid="pool-create-form">
            <Input name="name" placeholder="Pool name (e.g. Promo 140 pool)" required className="w-72" />
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      {pools.map((pool) => (
        <Card key={pool.id} data-testid="pool-card">
          <CardHeader><CardTitle>{pool.name} ({pool.numbers.length} numbers)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm" data-testid="pool-numbers-table">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-2">Number</th><th className="p-2">Type</th>
                  <th className="p-2">Daily used/cap</th><th className="p-2">Lifetime used/cap</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {pool.numbers.map((n) => (
                  <tr key={n.id} className="border-b last:border-0">
                    <td className="p-2 font-mono">{n.number}{n.label ? ` (${n.label})` : ""}</td>
                    <td className="p-2">{n.numberType}</td>
                    <td className="p-2">{n.dailyCallsUsed}/{n.dailyCallCap ?? "∞"}</td>
                    <td className="p-2">{n.lifetimeCallsUsed}/{n.lifetimeCallCap ?? "∞"}</td>
                    <td className="p-2">
                      <form action={removeNumber}>
                        <input type="hidden" name="id" value={n.id} />
                        <Button size="sm" variant="ghost">Remove</Button>
                      </form>
                    </td>
                  </tr>
                ))}
                {pool.numbers.length === 0 && (
                  <tr><td colSpan={5} className="p-2 text-muted-foreground">No numbers yet.</td></tr>
                )}
              </tbody>
            </table>
            <form action={addNumber} className="flex flex-wrap items-center gap-2" data-testid="pool-add-number-form">
              <input type="hidden" name="poolId" value={pool.id} />
              <Input name="number" placeholder="+911401234567" required className="w-48 font-mono" data-testid="pool-number-input" />
              <Input name="label" placeholder="Label (optional)" className="w-36" />
              <select name="numberType" className="h-9 rounded-md border border-border bg-card px-3 text-sm" data-testid="pool-number-type-select">
                {NUMBER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Input name="dailyCallCap" type="number" placeholder="Daily cap" className="w-28" min={1} />
              <Input name="lifetimeCallCap" type="number" placeholder="Lifetime cap" className="w-32" min={1} />
              <Button type="submit" size="sm">Add number</Button>
            </form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

**File `src/app/(app)/campaigns/whatsapp/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import {
  createTemplateAction,
  setTemplateStatusAction,
  createWhatsAppCampaignAction,
  startWhatsAppCampaignAction,
} from "@/server/actions/whatsapp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TPL_STATUS: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  PENDING: "bg-blue-500/10 text-blue-400",
  APPROVED: "bg-green-500/10 text-green-400",
  REJECTED: "bg-red-500/10 text-red-400",
};

export default async function WhatsAppPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const [templates, lists, campaigns] = await Promise.all([
    db.whatsAppTemplate.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" } }),
    db.contactList.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { contacts: true } } } }),
    db.whatsAppCampaign.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { template: { select: { name: true } }, list: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  async function createTemplate(formData: FormData) {
    "use server";
    await createTemplateAction({
      name: formData.get("name"),
      language: formData.get("language"),
      body: formData.get("body"),
      dltTemplateId: formData.get("dltTemplateId") || null,
    });
  }
  async function setStatus(formData: FormData) {
    "use server";
    await setTemplateStatusAction(
      String(formData.get("id")),
      String(formData.get("status")) as "PENDING" | "APPROVED" | "REJECTED"
    );
  }
  async function createCampaign(formData: FormData) {
    "use server";
    await createWhatsAppCampaignAction({
      name: String(formData.get("name")),
      templateId: String(formData.get("templateId")),
      listId: String(formData.get("listId")),
    });
  }
  async function startCampaign(formData: FormData) {
    "use server";
    await startWhatsAppCampaignAction(String(formData.get("id")));
  }

  return (
    <div className="space-y-6" data-testid="whatsapp-page">
      <h1 className="text-2xl font-bold">WhatsApp campaigns</h1>
      <p className="text-sm text-muted-foreground">
        Template messages via Vobiz WhatsApp Business (readme §9). Templates need
        Meta/DLT approval — submit in the Vobiz dashboard, then record the status
        here. Only APPROVED templates send. Sends are throttled (5/sec) and honor DNC.
      </p>

      <Card>
        <CardHeader><CardTitle>New template</CardTitle></CardHeader>
        <CardContent>
          <form action={createTemplate} className="space-y-3" data-testid="whatsapp-template-form">
            <div className="flex flex-wrap gap-2">
              <Input name="name" placeholder="call_followup" required className="w-56" data-testid="template-name-input" />
              <Input name="language" defaultValue="en" className="w-24" />
              <Input name="dltTemplateId" placeholder="DLT template id (India)" className="w-56" />
            </div>
            <textarea
              name="body"
              rows={3}
              required
              placeholder={"Hi {{1}}, thanks for speaking with us. Your details are confirmed."}
              className="w-full rounded-md border border-border bg-card p-2 text-sm"
              data-testid="template-body-input"
            />
            <Button type="submit">Create template</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Templates</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="whatsapp-template-list">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Name</th><th className="p-2">Body</th>
                <th className="p-2">DLT id</th><th className="p-2">Status</th><th className="p-2">Record decision</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b last:border-0" data-testid="template-row">
                  <td className="p-2 font-mono">{t.name}</td>
                  <td className="max-w-xs truncate p-2 text-muted-foreground">{t.body}</td>
                  <td className="p-2">{t.dltTemplateId ?? "—"}</td>
                  <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs ${TPL_STATUS[t.status]}`}>{t.status}</span></td>
                  <td className="p-2">
                    <form action={setStatus} className="flex gap-1">
                      <input type="hidden" name="id" value={t.id} />
                      <select name="status" className="h-8 rounded-md border border-border bg-card px-2 text-xs" data-testid="template-status-select">
                        {["PENDING", "APPROVED", "REJECTED"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <Button size="sm" variant="outline" type="submit">Save</Button>
                    </form>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr><td colSpan={5} className="p-2 text-muted-foreground">No templates yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>New WhatsApp campaign</CardTitle></CardHeader>
        <CardContent>
          <form action={createCampaign} className="flex flex-wrap items-center gap-2" data-testid="whatsapp-campaign-form">
            <Input name="name" placeholder="Campaign name" required className="w-56" />
            <select name="templateId" required className="h-9 rounded-md border border-border bg-card px-3 text-sm" data-testid="wa-template-select">
              {templates.filter((t) => t.status === "APPROVED").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select name="listId" required className="h-9 rounded-md border border-border bg-card px-3 text-sm">
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l._count.contacts})</option>)}
            </select>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>WhatsApp campaigns</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-md border p-3 text-sm" data-testid="wa-campaign-row">
              <span className="font-semibold">{c.name}</span>
              <span className="text-muted-foreground">{c.template.name} → {c.list?.name ?? "—"}</span>
              <span className="rounded-full border px-2 py-0.5 text-xs">{c.status}</span>
              {c.status === "DRAFT" && (
                <form action={startCampaign} className="ml-auto">
                  <input type="hidden" name="id" value={c.id} />
                  <Button size="sm" data-testid="whatsapp-campaign-start">▶ Start sending</Button>
                </form>
              )}
            </div>
          ))}
          {campaigns.length === 0 && <p className="text-sm text-muted-foreground">No WhatsApp campaigns yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/contacts/csv-uploader.tsx`** (client, full content — overwrite;
now accepts an optional `campaignId` for add-to-running-campaign and reports DNC skips):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importContactsAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CsvUploader({ campaignId }: { campaignId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("csv") as File | null;
    const listName = String(data.get("listName") ?? "");
    if (!file || file.size === 0) { setBusy(false); return setError("Choose a CSV file."); }
    if (file.size > 2 * 1024 * 1024) { setBusy(false); return setError("Max 2 MB CSV."); }
    const csvText = await file.text();
    const res = await importContactsAction({ listName, csvText, ...(campaignId ? { campaignId } : {}) });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Import failed.");
    setResult(
      `Imported ${res.imported} contacts (${res.skipped} skipped — bad phone` +
      `${res.dncSkipped ? `, ${res.dncSkipped} skipped — on DNC list` : ""}).` +
      (campaignId ? " Added to the campaign." : "")
    );
    form.reset();
    router.refresh();
  }

  return (
    <Card data-testid="contacts-upload-card">
      <CardHeader><CardTitle>{campaignId ? "Upload CSV → this campaign" : "Upload CSV"}</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Required column: <code>phone</code> (or <code>mobile</code>). Optional:{" "}
          <code>name</code>, <code>timezone</code> (IANA, e.g. Asia/Kolkata),{" "}
          <code>consent_at</code> (date or &quot;yes&quot;), <code>consent_source</code>, plus any
          extra columns (they become call personalization variables). Indian 10-digit
          mobiles auto-convert to +91. Numbers on the DNC list are skipped and counted.
        </p>
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" data-testid="contacts-upload-form">
          <Input name="listName" placeholder="List name (e.g. July leads)" className="w-56" required data-testid="list-name-input" />
          <input name="csv" type="file" accept=".csv,text/csv" required className="text-sm" data-testid="csv-file-input" />
          <Button type="submit" disabled={busy} data-testid="csv-import-submit">{busy ? "Importing…" : "Import"}</Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-400" data-testid="csv-import-error">{error}</p>}
        {result && <p className="mt-2 text-sm text-green-400" data-testid="csv-import-result">{result}</p>}
      </CardContent>
    </Card>
  );
}
```

**File `src/app/(app)/contacts/page.tsx`** (full content — overwrite; adds consent/
timezone columns, CRM import, DNC scrub counts):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CsvUploader } from "./csv-uploader";
import { CrmImportButton } from "./crm-import-button";
import { toggleDncAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { list?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const [lists, contacts, crmConnections] = await Promise.all([
    db.contactList.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { _count: { select: { contacts: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.contact.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(searchParams.list ? { listId: searchParams.list } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.crmConnection.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, provider: true },
    }),
  ]);

  async function toggleDnc(formData: FormData) {
    "use server";
    await toggleDncAction(String(formData.get("id")), formData.get("dnc") === "true");
  }

  return (
    <div className="space-y-8" data-testid="contacts-page">
      <h1 className="text-2xl font-bold">Contacts</h1>

      <CsvUploader />
      {crmConnections.length > 0 && <CrmImportButton connections={crmConnections} />}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Lists</h2>
        <div className="flex flex-wrap gap-2">
          {lists.map((l) => (
            <a key={l.id} href={`/contacts?list=${l.id}`}
              className="rounded-full border px-3 py-1 text-sm hover:border-primary">
              {l.name} ({l._count.contacts})
            </a>
          ))}
          {lists.length === 0 && <p className="text-sm text-muted-foreground">No lists yet — upload a CSV.</p>}
        </div>
      </section>

      <Card>
        <CardHeader><CardTitle>{contacts.length} contacts (latest 200)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="contacts-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Phone</th><th className="p-2">Name</th>
                <th className="p-2">Timezone</th><th className="p-2">Consent</th>
                <th className="p-2">Attributes</th><th className="p-2">DNC</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-2 font-mono">{c.phone}</td>
                  <td className="p-2">{c.name ?? "—"}</td>
                  <td className="p-2">{c.timezone ?? "—"}</td>
                  <td className="p-2" data-testid="consent-cell">
                    {c.optOutAt ? <span className="text-red-400">opted out</span>
                      : c.consentAt ? <span className="text-green-400">{c.consentSource ?? "yes"}</span>
                      : "—"}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {c.attributes ? Object.entries(c.attributes as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(", ") : "—"}
                  </td>
                  <td className="p-2">{c.dnc ? <span className="text-red-400" data-testid="dnc-badge">DNC</span> : "—"}</td>
                  <td className="p-2">
                    <form action={toggleDnc}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="dnc" value={String(!c.dnc)} />
                      <Button size="sm" variant="ghost" data-testid="dnc-toggle">{c.dnc ? "Allow calls" : "Mark DNC"}</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/contacts/crm-import-button.tsx`** (client, full content):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importFromCrmAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CrmImportButton({ connections }: { connections: { id: string; provider: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(id: string) {
    setBusy(true); setMessage(null);
    const res = await importFromCrmAction(id);
    setBusy(false);
    setMessage(
      res.ok
        ? `CRM import: ${res.imported} imported, ${res.skipped} skipped (bad phone), ${res.dncSkipped} on DNC.`
        : res.error ?? "CRM import failed."
    );
    router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Import from CRM</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Pull contacts from a connected CRM (Settings → Integrations). In
          CRM_IMPORT_DRY_RUN mode this imports two fixture contacts instead of
          calling the CRM.
        </p>
        <div className="flex flex-wrap gap-2">
          {connections.map((c) => (
            <Button key={c.id} variant="outline" disabled={busy} onClick={() => run(c.id)} data-testid="crm-import-button">
              {busy ? "Importing…" : `Import from ${c.provider}`}
            </Button>
          ))}
        </div>
        {message && <p className="text-sm text-green-400" data-testid="crm-import-result">{message}</p>}
      </CardContent>
    </Card>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** exit 0 both; routes `/campaigns/pools`, `/campaigns/whatsapp`,
`/contacts` build.
**If it fails:** `Module not found: Can't resolve './crm-import-button'` → create the
file exactly as shown (it lives next to `csv-uploader.tsx`). Once. Then STOP and report.

---

## Step 12: Worker env loading (package.json script fix)

The worker is a plain Node process — it does NOT auto-load `.env` the way Next.js
does. Make the env file explicit (Node 20's `--env-file`; shell env still wins, which
the tests rely on).

**Edit `package.json`:** replace the line
```json
    "worker": "tsx src/worker/index.ts"
```
with
```json
    "worker": "tsx --env-file=.env src/worker/index.ts"
```

**Verify:**
```bash
cd /root/vaani-ai && npm run worker > /tmp/worker-env-test.log 2>&1 & sleep 8; head -n 3 /tmp/worker-env-test.log; pkill -f "tsx --env-file" || true
```
**Expected:** first line contains `worker starting (CAMPAIGN_DRY_RUN=true, ...)`.
**If it fails:** `tsx: bad option: --env-file` → your tsx is old; run
`npm install tsx@4.19.1` once and retry. Alternative if Node rejects `--env-file`
(should not happen on Node 20.6+): run the worker as
`set -a; source .env; set +a; npx tsx src/worker/index.ts` and note the deviation.
Max 2 attempts → STOP and report.

---

## Step 13: TRAI / DLT onboarding checklist (operator-facing, readme §6.1 + §11)

No code — this is the compliance runbook the product links from the pools page. It is
part of the guide so it ships with the playbook and guide 12 can link it from the
production runbook.

**India TRAI/TCCCPR checklist for outbound campaigns:**

1. **Entity + header registration (DLT):** register the business entity on a DLT
   portal (e.g. Vilpower/Truecaller Jio/etc. via your Vobiz account manager) → get
   the PE (Principal Entity) ID. Register caller-ID "headers" for promotional
   (140 series) and service (1600 series) use.
2. **Number procurement (Vobiz):** request SERIES_140 DIDs (promotional campaigns:
   LEAD_QUALIFICATION, REACTIVATION, EVENT_INVITE, POLITICAL_SURVEY) and/or
   SERIES_1600 DIDs (service campaigns: APPOINTMENT_REMINDER, PAYMENT_REMINDER,
   FEEDBACK_SURVEY, ORDER_CONFIRMATION). KYC is mandatory for these series — start
   early (days). Add them in `/campaigns/pools` with the correct `numberType`;
   the pool editor validates the series format, and campaign start REFUSES a pool
   whose numbers don't match the campaign type.
3. **Content templates (DLT):** register SMS/WhatsApp/voice-clip templates with DLT;
   record the DLT template id on each WhatsApp template (`/campaigns/whatsapp`).
   Only APPROVED templates send.
4. **Permitted hours:** promotional (140) calls only 09:00–21:00 contact-local — the
   worker enforces this automatically when the pool contains SERIES_140 numbers
   (`TRAI_HOURS_ENFORCE=true`, default). Service (1600) calls have no statutory
   window; we still recommend campaign windows for answer rates.
5. **Consent (TCPA-style, readme §11):** collect consent for promotional outreach
   (web form, IVR, import). Track it per contact (`consent_at`, `consent_source`
   CSV columns). Set `REQUIRE_CONSENT_FOR_PROMOTIONAL=true` in production to hard-
   block non-consented contacts from promotional campaigns (they are skipped and
   reported, never dialed).
6. **DNC / DND:** maintain the internal DNC list (`/contacts` → Mark DNC, or
   mid-call opt-out — automatic). Every import and every dial re-checks DNC. For
   scrubbing against the national NCPR registry, use your Vobiz/Telemarketer
   portal's scrubbing service (OPERATOR GATE: Vobiz-side feature; verify with your
   account manager before the first promotional blast).
7. **Recording disclosure:** the presets' opening hooks include identity disclosure
   ("automated call… AI assistant… may be recorded") — keep that line in every
   custom hook (guide 05/06 handle playback of configured disclosure text).

---

## Step 14: FULL dry-run integration suite (Hermes runs this end-to-end)

Every scenario runs with `CAMPAIGN_DRY_RUN=true`. Costs: zero. Each scenario has
exact expected outputs — paste them into the FINAL REPORT.

### 14.0 Setup

```bash
cd /root/vaani-ai
grep CAMPAIGN_DRY_RUN .env   # must be true (or unset → default true)
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 8

WS=$(docker exec vaani-db psql -U vaani -d vaani -tA -c "SELECT id FROM \"Workspace\" WHERE slug='demo-clinic';")
echo "workspace: $WS"

# published agent (simulated Dograh ids — dry-run never calls Dograh)
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"Agent\" SET status='PUBLISHED', \"dograhWorkflowId\"='12', \"dograhWorkflowUuid\"='uuid-sim-1' WHERE \"workspaceId\"='$WS';"
AGENT=$(docker exec vaani-db psql -U vaani -d vaani -tA -c "SELECT id FROM \"Agent\" WHERE \"workspaceId\"='$WS' AND status='PUBLISHED' LIMIT 1;")
echo "agent: $AGENT"
# NOTE: keep this shell open for the whole suite — $WS/$AGENT/$LIST are reused below.
# New shell? Re-run the three variable assignments (WS, AGENT above; LIST in the next block).

# number pool: 2 LOCAL numbers, dailyCallCap=1 each (rotation + exhaustion test).
# pn-test-1 also gets the agent assigned so callback-dial finds an "inbound agent".
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"NumberPool\" (id, \"workspaceId\", name) VALUES ('pool-test-1', '$WS', 'Test rotation pool');
  INSERT INTO \"PhoneNumber\" (id, \"workspaceId\", number, \"numberType\", \"poolId\", \"dailyCallCap\", \"agentId\") VALUES
   ('pn-test-1', '$WS', '+918040001111', 'LOCAL', 'pool-test-1', 1, '$AGENT'),
   ('pn-test-2', '$WS', '+918040002222', 'LOCAL', 'pool-test-1', 1, NULL);"

# APPROVED WhatsApp template (fallback test)
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"WhatsAppTemplate\" (id, \"workspaceId\", name, language, body, status) VALUES
   ('wa-tpl-1', '$WS', 'call_followup', 'en', 'Hi {{1}}, thanks for your time. We will reach out again soon.', 'APPROVED');"

# one DNC number (scrub test)
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"DncEntry\" (id, \"workspaceId\", phone, source) VALUES ('dnc-test-1', '$WS', '+919876500003', 'MANUAL');"

cat > /tmp/campaign-test.csv <<'EOF'
phone,name,city,timezone,consent_at
9876500001,Asha,Delhi,Asia/Kolkata,2025-06-01
9876500002,Bala,Mumbai,,yes
9876500003,Charan,Chennai,,
9876500004,Divya,Kolkata,Asia/Kolkata,
9876500005,Eshan,Pune,,
bad-row,,,,
08023456789,Landline Person,Bengaluru,,
EOF
```

**Operator (browser):** login → `/contacts` → upload `campaign-test.csv` as list
"Dry-run test".
**Expected:** green message
`Imported 4 contacts (2 skipped — bad phone, 1 skipped — on DNC list).`
(the DNC number 0003 is skipped at import and COUNTED — readme §6.1 DNC scrubbing;
the landline and `bad-row` fail phone validation.)

**Hermes:** grab the list id + create the test campaign (pool rotation, window 00:00–23:59):
```bash
LIST=$(docker exec vaani-db psql -U vaani -d vaani -tA -c "SELECT id FROM \"ContactList\" WHERE name='Dry-run test' AND \"workspaceId\"='$WS' ORDER BY \"createdAt\" DESC LIMIT 1;")
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Campaign\" (id, \"workspaceId\", name, type, \"agentId\", \"listId\", \"poolId\", status, \"callsPerMinute\", concurrency, \"maxAttempts\", \"retryDelayMin\", \"retryPolicy\", \"callingWindowStart\", \"callingWindowEnd\", \"amdPolicy\", \"predictiveDialing\")
  VALUES ('camp-test-1', '$WS', 'Dry-run blaster', 'LEAD_QUALIFICATION', '$AGENT', '$LIST', 'pool-test-1', 'DRAFT', 60, 5, 2, 5, '{\"busy\":{\"attempts\":2,\"delayMin\":5}}', '00:00', '23:59', 'HANGUP', false);"
```

### 14.1 Scenario A — pool rotation + daily cap exhaustion

```bash
cd /root/vaani-ai
CAMPAIGN_RAMP_START_CPM=100 CAMPAIGN_DRY_RUN_RESULT=completed npm run worker > /tmp/worker.log 2>&1 &
sleep 6
```
**Operator (browser):** open the campaign → click **▶ Start** (testid `resume-button`).

**Hermes — after ~40s:**
```bash
sleep 40
grep -E "enqueued|POOL EXHAUSTED|dry-run context" /tmp/worker.log | head -n 8
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT number, \"dailyCallsUsed\", \"dailyCallCap\" FROM \"PhoneNumber\" WHERE \"poolId\"='pool-test-1' ORDER BY number;"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, \"lastResult\", attempts FROM \"CampaignContact\" WHERE \"campaignId\"='camp-test-1' ORDER BY \"lastResult\" NULLS LAST;"
```
**Expected:**
- Log: `enqueued 2 dial(s)` then `dry-run context hook=... from=+918040001111` and
  `from=+918040002222` — the two dials used DIFFERENT pool numbers (rotation works).
- Same tick or the next logs `POOL EXHAUSTED (all numbers capped) — pausing dials
  this tick` (both numbers hit dailyCallCap=1; 2 contacts remain PENDING).
- Both numbers: `dailyCallsUsed = 1` with `dailyCallCap = 1`.
- CampaignContacts: 2 `COMPLETED` (result `completed`, 1 attempt each), 2 `PENDING`
  (waiting for cap reset), the DNC contact was never snapshotted (skipped at import).
- Campaign stays `RUNNING` — capped, not complete.

**Cap reset → completion (proves the daily cap semantics):**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"PhoneNumber\" SET \"dailyCallsUsed\"=0 WHERE \"poolId\"='pool-test-1';"
sleep 45
docker exec vaani-db psql -U vaani -d vaani -tA -c "SELECT status FROM \"Campaign\" WHERE id='camp-test-1';"
```
**Expected:** the remaining 2 contacts dial on the next tick and the campaign flips
to `COMPLETED` (~90s max). (Nightly, the `0 3 * * *` cron does this reset
automatically — the log line is `[cron] daily cap reset: N number(s)`.)

**UI (operator):** `/campaigns` card shows `COMPLETED`; detail stats grid shows
4 completed.

### 14.2 Scenario B — retry spacing honored (per-disposition policy + backoff)

```bash
pkill -f "tsx --env-file" || true; sleep 2
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Campaign\" (id, \"workspaceId\", name, type, \"agentId\", \"listId\", status, \"callsPerMinute\", concurrency, \"maxAttempts\", \"retryDelayMin\", \"retryPolicy\", \"callingWindowStart\", \"callingWindowEnd\", \"amdPolicy\", \"predictiveDialing\")
  SELECT 'camp-test-2', '$WS', 'Retry test', 'LEAD_QUALIFICATION', '$AGENT', '$LIST', 'DRAFT', 60, 5, 2, 5, '{\"busy\":{\"attempts\":2,\"delayMin\":5}}', '00:00', '23:59', 'HANGUP', false;
  INSERT INTO \"CampaignContact\" (\"campaignId\", \"contactId\", status)
  SELECT 'camp-test-2', c.id, CASE WHEN c.dnc THEN 'SKIPPED_DNC' ELSE 'PENDING' END FROM \"Contact\" c WHERE c.\"listId\"='$LIST';"
CAMPAIGN_RAMP_START_CPM=100 CAMPAIGN_DRY_RUN_RESULT=busy npm run worker > /tmp/worker2.log 2>&1 &
sleep 6
```
**Operator:** open "Retry test" → **▶ Start**. **Hermes:**
```bash
sleep 45
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT c.phone, cc.status, cc.attempts, cc.\"lastResult\",
         ROUND(EXTRACT(EPOCH FROM (cc.\"nextAttemptAt\" - now()))/60, 1) AS retry_in_min
  FROM \"CampaignContact\" cc JOIN \"Contact\" c ON c.id=cc.\"contactId\"
  WHERE cc.\"campaignId\"='camp-test-2' AND cc.status='RETRY_SCHEDULED';"
```
**Expected:** all 4 contacts `RETRY_SCHEDULED`, attempts=1, `lastResult=busy`,
`retry_in_min` between **3.5 and 6.5** (base 5 min × 2^0, ±20% jitter — the policy
override, not the 60-min default). Stop the worker (`pkill -f "tsx --env-file"`)
unless you want to watch attempt 2 fire ~5 min later and flip to `FAILED`
(attempts=2 = policy max for busy).

### 14.3 Scenario C — mid-flight script edit reflected in the next dial

```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Campaign\" (id, \"workspaceId\", name, type, \"agentId\", \"listId\", status, \"callsPerMinute\", concurrency, \"maxAttempts\", \"retryDelayMin\", \"callingWindowStart\", \"callingWindowEnd\", \"amdPolicy\", \"predictiveDialing\", \"openingHook\")
  SELECT 'camp-test-3', '$WS', 'Script edit test', 'LEAD_QUALIFICATION', '$AGENT', '$LIST', 'DRAFT', 60, 1, 1, 5, '00:00', '23:59', 'LEAVE_MESSAGE', true, 'HOOK-V1 original hook';
  INSERT INTO \"CampaignContact\" (\"campaignId\", \"contactId\", status)
  SELECT 'camp-test-3', c.id, 'PENDING' FROM \"Contact\" c WHERE c.\"listId\"='$LIST' AND NOT c.dnc;"
CAMPAIGN_RAMP_START_CPM=100 CAMPAIGN_DRY_RUN_RESULT=busy npm run worker > /tmp/worker3.log 2>&1 &
sleep 6
```
**Operator:** open "Script edit test" → **▶ Start**. After the first tick has run
(~40s — the first contact dialed with V1), **Hermes** edits the script mid-flight
(same thing the `edit-script-form` does):
```bash
sleep 40
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"Campaign\" SET \"openingHook\"='HOOK-V2 edited mid-flight' WHERE id='camp-test-3';"
sleep 75
grep "dry-run context" /tmp/worker3.log
```
**Expected:** the earliest dial(s) show `hook="HOOK-V1 original hook"`; dials after
the edit show `hook="HOOK-V2 edited mid-flight"` — the worker read the campaign fresh
on the next tick. (concurrency=1 ⇒ one dial per 30s tick; the first contact dials
with V1, the edit lands, and the next contact's dial shows V2. maxAttempts=1 ⇒ no
retries; you may need ~2 ticks after the edit. V2 MUST appear.) Also note
`amd=LEAVE_MESSAGE` in the context line (AMD policy reaches the dial path).

**If V2 never appears:** the campaign drained before the edit landed — re-run the
scenario and do the SQL update within 10s of Start. One retry, then report.

### 14.4 Scenario D — callback task dialed when due (guide 06 contract)

```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"CallbackTask\" (id, \"workspaceId\", phone, note, \"dueAt\", status)
  VALUES ('cb-test-1', '$WS', '+919876500001', 'call me tomorrow at 5 (test)', now() - interval '1 minute', 'PENDING');"
sleep 70
grep -E "callback due|callback-dial" /tmp/worker3.log
docker exec vaani-db psql -U vaani -d vaani -tA -c "SELECT status FROM \"CallbackTask\" WHERE id='cb-test-1';"
```
**Expected:** log shows `callback due → enqueued +919876500001` then
`[callback-dial] DRY RUN → would dial +919876500001`; task status `DONE`.

### 14.5 Scenario E — call-to-WhatsApp fallback on final no-answer

```bash
pkill -f "tsx --env-file" || true; sleep 2
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Campaign\" (id, \"workspaceId\", name, type, \"agentId\", \"listId\", status, \"callsPerMinute\", concurrency, \"maxAttempts\", \"retryDelayMin\", \"retryPolicy\", \"callingWindowStart\", \"callingWindowEnd\", \"amdPolicy\", \"predictiveDialing\")
  SELECT 'camp-test-4', '$WS', 'WA fallback test', 'LEAD_QUALIFICATION', '$AGENT', '$LIST', 'DRAFT', 60, 5, 1, 5, '{\"whatsappFallbackTemplateId\":\"wa-tpl-1\"}', '00:00', '23:59', 'HANGUP', false;
  INSERT INTO \"CampaignContact\" (\"campaignId\", \"contactId\", status)
  SELECT 'camp-test-4', c.id, 'PENDING' FROM \"Contact\" c WHERE c.\"listId\"='$LIST' AND NOT c.dnc;"
CAMPAIGN_RAMP_START_CPM=100 CAMPAIGN_DRY_RUN_RESULT=no-answer npm run worker > /tmp/worker4.log 2>&1 &
sleep 6
```
**Operator:** open "WA fallback test" → **▶ Start**. **Hermes:**
```bash
sleep 45
grep -E "whatsapp-fallback|whatsapp" /tmp/worker4.log | head -n 5
```
**Expected:** for each final no-answer (maxAttempts=1 ⇒ first miss is final):
`[whatsapp-fallback] campaign=camp-test-4 to=+9198765000X template=call_followup ok=true (dry-run)`
— and `[whatsapp] DRY RUN template=call_followup ...` from `src/worker/whatsapp.ts`
(WHATSAPP_DRY_RUN defaults true — nothing was really sent; the real path is guide
04's `sendWhatsAppTemplate` in `src/lib/vobiz.ts`).

### 14.6 Scenario F — post-call sweep: interest score, callback extraction, opt-out cascade

Seed two finished calls with transcripts (simulating webhook-completed calls), plus a
RUNNING campaign that still contains one of those numbers (cascade target):

```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Campaign\" (id, \"workspaceId\", name, type, \"agentId\", \"listId\", status, \"callsPerMinute\", concurrency, \"maxAttempts\", \"retryDelayMin\", \"callingWindowStart\", \"callingWindowEnd\", \"amdPolicy\", \"predictiveDialing\")
  SELECT 'camp-test-5', '$WS', 'Cascade target', 'REACTIVATION', '$AGENT', '$LIST', 'DRAFT', 10, 1, 2, 60, '00:00', '23:59', 'HANGUP', false;
  INSERT INTO \"CampaignContact\" (\"campaignId\", \"contactId\", status)
  SELECT 'camp-test-5', c.id, 'PENDING' FROM \"Contact\" c WHERE c.\"listId\"='$LIST' AND NOT c.dnc;
  INSERT INTO \"Call\" (id, \"workspaceId\", direction, status, \"fromNumber\", \"toNumber\", \"agentId\", \"campaignId\", transcript, sentiment)
  VALUES
   ('call-hot-1', '$WS', 'OUTBOUND', 'COMPLETED', '+918040001111', '+919876500001', '$AGENT', 'camp-test-5', 'agent: ... caller: yes I am interested, please call me tomorrow at 5 to discuss the demo', 'positive'),
   ('call-optout-1', '$WS', 'OUTBOUND', 'COMPLETED', '+918040001111', '+919876500002', '$AGENT', 'camp-test-5', 'caller: please stop calling me, remove my number', 'negative');"
sleep 75
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT id, \"interestScore\", \"interestReason\" FROM \"Call\" WHERE id IN ('call-hot-1','call-optout-1');"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT phone, status, \"dueAt\" > now() AS future FROM \"CallbackTask\" WHERE phone='+919876500001' ORDER BY \"createdAt\" DESC LIMIT 1;"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT phone, source, reason FROM \"DncEntry\" WHERE phone='+919876500002';
  SELECT c.dnc, c.\"optOutAt\" IS NOT NULL AS opted_out FROM \"Contact\" c WHERE c.phone='+919876500002';
  SELECT cc.status, cc.\"lastResult\" FROM \"CampaignContact\" cc JOIN \"Contact\" c ON c.id=cc.\"contactId\" WHERE c.phone='+919876500002' AND cc.\"campaignId\"='camp-test-5';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT queue, status, reason IS NOT NULL AS has_reason FROM \"TransferRequest\" WHERE \"callId\"='call-optout-1';"
```
**Expected:**
- `call-hot-1`: `interestScore=HOT`, reason mentions dry-run mock; a `CallbackTask`
  for +919876500001 exists with `future=true` (dry-run extractor: +24h) — and the
  sweep enqueued its `callback-dial` job (it will fire in a day, or when due).
- `call-optout-1`: interest scored (COLD/WARM — not the point), a `DncEntry` with
  `source=OPT_OUT`, the contact has `dnc=true` + `optOutAt` set, and its
  CampaignContact in camp-test-5 flipped to `SKIPPED_DNC` / `skipped:opt-out`
  (**opt-out cascade removed it from the running queue**).
- A `TransferRequest` exists for the angry call (`queue=escalations`, `QUEUED`) —
  the human flag (readme §6.2 sentiment escalation). Guide 06's `/transfers` page
  shows it.
- Worker log shows `[postcall] OPT-OUT cascade +919876500002: removed from ...`.

### 14.7 Scenario G — pause stops dials

Re-start any DRAFT campaign from 14.2/14.3, then while RUNNING click **⏸ Pause**
(testid `pause-button`):
```bash
sleep 40 && tail -n 5 /tmp/worker4.log
```
**Expected:** no new `enqueued` lines for that campaign after the pause (the
scheduler self-removes). **▶ Start** again resumes it.

### 14.8 Scenario H — RBAC negatives (VIEWER cannot launch)

Every mutating server action in this guide calls `requirePermission(...)` FIRST
(outside its try/catch, so FORBIDDEN propagates). Prove the guard with a real
VIEWER session against guide 03's test-only probe (the action runs the identical
check before any prisma call):

```bash
# negative: VIEWER must NOT pass campaigns:launch (startCampaignAction's guard)
COOKIE=$(npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER | tail -n 1)
curl -s -w "\n%{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/api/internal/perm-check?perm=campaigns:launch"
# positive control: MANAGER passes
COOKIE2=$(npx tsx scripts/make-test-session.ts manager@test.dev MANAGER | tail -n 1)
curl -s -w "\n%{http_code}\n" -H "Cookie: $COOKIE2" "http://localhost:3000/api/internal/perm-check?perm=campaigns:launch"
# spot-check the other guards this guide uses
for p in campaigns:write campaigns:delete contacts:import contacts:write numbers:write; do
  echo -n "VIEWER $p → "; curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/api/internal/perm-check?perm=$p"
done
```
**Expected:** VIEWER `campaigns:launch` → `{"ok":false,"error":"FORBIDDEN"}` then
`403`; MANAGER → `{"ok":true,...,"role":"MANAGER"}` then `200`; all five
spot-checks print `403` for VIEWER.

### 14.9 Cleanup

```bash
pkill -f "tsx --env-file" || true; pkill -f "next dev" || true
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"TransferRequest\" WHERE \"callId\" IN ('call-hot-1','call-optout-1');
  DELETE FROM \"CallbackTask\" WHERE id IN ('cb-test-1') OR phone IN ('+919876500001','+919876500002');
  DELETE FROM \"Call\" WHERE id IN ('call-hot-1','call-optout-1');
  DELETE FROM \"CampaignContact\" WHERE \"campaignId\" LIKE 'camp-test-%';
  DELETE FROM \"Campaign\" WHERE id LIKE 'camp-test-%';
  DELETE FROM \"DncEntry\" WHERE id='dnc-test-1' OR phone='+919876500002';
  DELETE FROM \"WhatsAppTemplate\" WHERE id='wa-tpl-1';
  DELETE FROM \"PhoneNumber\" WHERE id IN ('pn-test-1','pn-test-2');
  DELETE FROM \"NumberPool\" WHERE id='pool-test-1';
  DELETE FROM \"Contact\" WHERE phone IN ('+919876500001','+919876500002','+919876500004','+919876500005');
  DELETE FROM \"ContactList\" WHERE name='Dry-run test' AND \"workspaceId\"=(SELECT id FROM \"Workspace\" WHERE slug='demo-clinic');"
```

**If anything fails:**
- `ECONNREFUSED 6379` → `docker compose up -d redis`.
- Nothing enqueued → campaign not RUNNING, or worker started without `--env-file`
  (Step 12), or `CAMPAIGN_DRY_RUN_RESULT` typo (must be `completed|no-answer|busy|voicemail`).
- Scheduler idle despite RUNNING → check the log line; `no free slots` means stale
  `DIALING` rows from a killed worker — fix:
  `UPDATE "CampaignContact" SET status='PENDING' WHERE status='DIALING';` (guide 13
  covers this as "stuck locks").
- Contacts flip straight to FAILED with log `no DID in workspace for fromNumber` →
  the workspace has zero PhoneNumber rows; add one (`/campaigns/pools` or `/numbers`)
  and set the contacts back to PENDING.
- Pool never rotates → both numbers claim in the same tick; check the two
  `from=...` lines differ.

---

## Step 15: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 07: outbound engine v2 — presets, pools+rotation, timezone windows+TRAI, retries, pacing, predictive, post-call intelligence, opt-out cascade, whatsapp campaigns+fallback"
```

---

## Playwright critical flows (for guide 11 — selectors are stable testids)

1. **CSV → campaign → dry-run → live status:** `/contacts` → `contacts-upload-form`
   (`list-name-input`, `csv-file-input`, `csv-import-submit`) → expect
   `csv-import-result` → `/campaigns/new` (`new-campaign-button`) → click
   `preset-card-LEAD_QUALIFICATION` → fill `campaign-name-input`, `agent-select`,
   `list-select`, `pool-select` → `create-campaign-submit` → lands on
   `campaign-detail` → `resume-button` → poll `stats-grid` + `live-status-table`
   rows until `campaign-status-pill` = COMPLETED.
2. **Opt-out cascade (UI side):** `/contacts` → a row shows `dnc-badge` +
   `consent-cell` = "opted out" after the cascade; campaign detail shows the row as
   SKIPPED_DNC in `live-status-table`.
3. **Mid-flight script edit:** RUNNING campaign → `edit-script-form`
   (`edit-opening-hook`, `edit-objection-playbook`, `edit-script-submit`) → no error;
   worker log picks it up (API-level assertion, not UI).
4. **Pools:** `/campaigns/pools` → `pool-create-form` → `pool-add-number-form`
   (`pool-number-input`, `pool-number-type-select`) → row appears in
   `pool-numbers-table` with used/cap counters.
5. **WhatsApp:** `/campaigns/whatsapp` → `whatsapp-template-form`
   (`template-name-input`, `template-body-input`) → row in `whatsapp-template-list`
   → `template-status-select` → APPROVED → `whatsapp-campaign-form` →
   `whatsapp-campaign-start` → row flips to RUNNING (worker: COMPLETED).
6. **Callback scheduling:** covered API-level (Scenario F); UI assertion is the
   CallbackTask visible via guide 06's surfaces.

## Acceptance Checklist

- [ ] All 7 vitest files pass (`npx vitest run tests/`): phone, windows, retry,
      pacing, pool+compliance, scoring, fallback
- [ ] CSV import: E.164 normalization, invalid skipped, DNC scrubbed + counted,
      timezone/consent columns honored
- [ ] CRM import works in dry-run (2 fixture contacts)
- [ ] Campaign create snapshots contacts with DNC/consent scrub; 8 presets render
      and fill defaults
- [ ] Start enforces TRAI series mapping (bad pool → error, good pool → RUNNING)
- [ ] Worker: ramp-up + adaptive pacing, per-contact timezone windows, TRAI hours
      guard, pool rotation with caps (Scenario A), per-disposition retries with
      spacing (B), mid-flight script edit (C), callback-dial (D), WhatsApp fallback
      (E), post-call intelligence + opt-out cascade + escalation (F), pause/resume (G)
- [ ] Nightly cap reset cron registered (worker log on schedule; verify by
      temporarily setting the schedule to `* * * * *` if the operator wants proof —
      then set it back to `0 3 * * *`)
- [ ] Predictive toggle over-books slots (unit tests + campaign flag honored)
- [ ] RBAC: every mutating action guards with requirePermission FIRST; VIEWER gets
      403 FORBIDDEN on campaigns:launch (Scenario H)
- [ ] Call.fromNumber always a real E.164 DID (pool number or workspace's first
      DID; dial fails loudly when the workspace has none)
- [ ] WhatsApp templates (DRAFT→APPROVED gate) + campaign send flow dry-run logs
- [ ] DRY_RUN never touched Dograh/OpenRouter/Vobiz (no provider errors in logs)
- [ ] `npm run typecheck` + `npm run build` exit 0
- [ ] Git commit `phase 07: ...` exists

## FINAL REPORT format

```
STEP 1..15: PASS/FAIL/GATED — <one line of evidence each>
VITEST: n files, n tests, 0 failures
SCENARIOS: A:PASS/FAIL B:PASS/FAIL C:PASS/FAIL D:PASS/FAIL E:PASS/FAIL F:PASS/FAIL G:PASS/FAIL H:PASS/FAIL
  A rotation: from=+918040001111 / +918040002222, pool-exhausted log: yes/no
  B retry_in_min: <values>
  F: interest=<score>, callbackTask=<dueAt>, optOutCascade rows=<n>, transfer=<queued?>
  H: VIEWER campaigns:launch → <status> (must be 403)
ACCEPTANCE: n/14 checked
NOTES: <deviations>
```
