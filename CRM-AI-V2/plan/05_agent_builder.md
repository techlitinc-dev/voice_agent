# 05 — AI Agent Builder

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/05_agent_builder.md` exactly. Create every file with the EXACT
> contents shown. Run every Verify, compare with Expected, max 2 fix attempts, then
> STOP and report. Every server action MUST call `requirePermission("<domain>:<action>")`
> FIRST (guide 03 vocabulary — never invent keys); every query is tenant-scoped via the
> returned ctx.workspaceId — never trust client-supplied workspace ids. Never spend real telephony money in
> tests — use the `VAANI_DRY_RUN=true` path exactly as described. Do not create any
> Prisma migration except the single additive one in Step 2. End with the FINAL REPORT.
> ---

---

## Goal

The heart of the product: users create AI voice agents from industry templates,
configure persona/voice/language/LLM/conversation controls/knowledge/tools, keep
**versions** (draft → publish → rollback → A/B), **test in browser** via Dograh,
connect **CRM/calendar integrations**, and share agents through the **template
marketplace**. After this phase the app has:

- template gallery (10 industry templates), agent list, tabbed agent editor
- version control: drafts, publish to Dograh per version, one-click rollback, A/B split
- test-in-browser (Dograh web test run + deep link to Dograh's advanced flow editor)
- Sarvam Bulbul v3 voice picker (39 voices), per-language mapping, 3 language modes
  (FIXED / AUTO_DETECT / CALLER_SELECTABLE with DTMF pre-flow)
- per-agent LLM selection (OpenRouter `:floor` / `:nitro` / premium curated list)
- conversation controls (barge-in, VAD, max duration, silence timeout, fillers, pace)
- Knowledge Base: PDF/DOCX/URL/FAQ upload → MinIO + DB row → Dograh KB sync
  (OPERATOR GATE), re-index scheduler, KB-only guardrail prompt module
- all 8 `AgentToolType` tools: config UI + workflow nodes + dry-run test buttons
- CRM integration framework (`CrmProvider` interface, full HubSpot + Zoho
  implementations, 4 config-driven adapters), settings UI with field-mapping editor
- template marketplace: browse, publish, install with counter

**Time estimate:** 6–8 hours. **Prerequisites:** guides 01–04 green (04 Step 8 may be
deferred, but `src/lib/dograh.ts` must exist and the migration adding
`Agent.dograhWorkflowUuid` must be applied).

---

## Coverage map (spec → step)

| readme.md bullet | Step |
|---|---|
| §4.1 visual builder / branching on intent+sentiment+variables / multi-agent handoff / no-code editing | 4 (workflow-builder lib), 5 (advanced-editor deep link), 19 (tabbed no-code editor) |
| §4.1 version control: drafts, publish, rollback, A/B versions | 3 (additive migration), 6 (versions + A/B libs), 7 (actions), 19c (versions tab) |
| §4.1 test-in-browser (webRTC widget) | 5 + 7 (`createTestRunAction`), 8 (OPERATOR GATE) |
| §4.2 voice selection (39 Bulbul v3 voices), per-language voice mapping | 2 (`voices.ts`), 19b (voice tab) |
| §4.2 language mode: fixed / auto-detect / caller-selectable DTMF | 2, 4 (`buildCallerSelectPreflow`), 19b |
| §4.2 LLM selection per agent + failover chain | 2 (`LLM_MODELS` + `llmFallbackChain`), 4 (`llm` node hint, consumes guide 04's chain), 19b |
| §4.2 personality & script: industry system-prompt templates | 1 (10 templates) |
| §4.2 conversation controls: barge-in, VAD, max duration, silence timeout, fillers, pace | 3 (migration), 4 (builder wiring), 19b (general tab) |
| §4.2 hybrid pre-recorded + TTS / latency budget | Step 4 note (Dograh capability, configured in advanced editor) |
| §4.3 Knowledge Base RAG: PDF/DOCX/URL/FAQ, per-agent + shared scoping, scheduled re-index, KB-only guardrail | 9 (storage/knowledge libs), 10 (actions), 11 (re-index worker), 17 (KB page), 19 (knowledge tab); Dograh KB push = OPERATOR GATE (Step 10) |
| §4.4 all 8 tools (book, transfer, SMS, WhatsApp, CRM, payment, webhook, voicemail) | 9 (vobiz/calendar/payments libs), 12 (schemas + executor + route), 19c (tools tab) |
| §9 CRM: HubSpot + Zoho (full), 4 adapters (OPERATOR GATE), two-way sync, field mapping | 13 (framework), 14 (OAuth routes + actions), 15 (sync worker), 20 (settings UI) |
| §9 calendars: Google (full via googleapis), Microsoft/Calendly/Cal.com (OPERATOR GATE) | 9 (`calendar.ts`), 14 (OAuth), 20 (settings UI) |
| §15 template marketplace: browse all workspaces, publish, install, counter | 16 (actions), 17 (UI), 19c (publish button) |
| Plan gate `maxAgents` (guide 09 owns billing; we only enforce) | 7 + 16 (`assertAgentQuota` / install gate) |

---

## Step 0: Dependencies + environment

Install (idempotent — safe if already installed by guides 01/03):

```bash
cd /root/vaani-ai
npm install googleapis@144.0.0 node-cron@3.0.3 mime-types@2.1.35
npm install --save-dev @types/node-cron@3.0.11 @types/mime-types@2.1.4
```

**Verify:**
```bash
node -e "const p=require('./package.json');console.log(p.dependencies.googleapis,p.dependencies['node-cron'],p.dependencies['mime-types'])"
```
**Expected:** `144.0.0 3.0.3 2.1.35` (caret prefixes are fine).
**If it fails:** re-run the two install lines once more; then STOP and report the npm
error output.

Add npm scripts to `package.json` inside the existing `"scripts"` block (merge — do
NOT remove other scripts):

```json
"worker:kb": "tsx src/worker/kb-reindex.ts",
"worker:crm-sync": "tsx src/worker/crm-sync.ts"
```

**Verify:** `node -e "console.log(Object.keys(require('./package.json').scripts).join(' '))" | grep -o "worker:kb worker:crm-sync"`
**Expected:** `worker:kb worker:crm-sync`

Append ONLY guide-05-owned vars to `.env` and `.env.example` — grep-guarded so
re-runs and other guides' vars are never duplicated. (Guide 04 already owns
`VOBIZ_API_BASE`, `VOBIZ_AUTH_ID`, `VOBIZ_AUTH_TOKEN`, `VOBIZ_APPLICATION_ID`,
`VOBIZ_WHATSAPP_SENDER`, `VOBIZ_WHATSAPP_PATH`; guide 01 owns
`HUBSPOT_CLIENT_ID`/`HUBSPOT_CLIENT_SECRET` — do NOT re-add them.)

```bash
cd /root/vaani-ai
for kv in \
  'DOGRAH_UI_URL=http://localhost:3001' \
  'S3_BUCKET_KB=vaani-knowledge' \
  'GOOGLE_CALENDAR_CLIENT_ID=CHANGE_ME' \
  'GOOGLE_CALENDAR_CLIENT_SECRET=CHANGE_ME' \
  'ZOHO_CLIENT_ID=CHANGE_ME' \
  'ZOHO_CLIENT_SECRET=CHANGE_ME' \
  'VOBIZ_SMS_SENDER=VAANIAI' \
  'VAANI_DRY_RUN=true' \
  'WORKFLOW_HINTS=true' ; do
  key="${kv%%=*}"
  grep -q "^${key}=" .env || echo "$kv" >> .env
  grep -q "^${key}=" .env.example || echo "$kv" >> .env.example
done
```

What each var is for:
- `DOGRAH_UI_URL` — public URL of the Dograh WEB UI (deep links: advanced flow editor,
  browser test calls). The port the operator tunnels to in guide 04.
- `S3_BUCKET_KB` — MinIO bucket for knowledge-base documents (auto-created on first upload).
- `GOOGLE_CALENDAR_CLIENT_ID/SECRET` — Google Cloud OAuth client (Step 14 OPERATOR GATE).
- `ZOHO_CLIENT_ID/SECRET` — Zoho API-console OAuth app (Step 14 OPERATOR GATE).
- `VOBIZ_SMS_SENDER` — SMS sender id (guide 04 owns the WhatsApp sender + auth).
- `VAANI_DRY_RUN=true` — dry-run guard for tool execution (SMS/WhatsApp/payment):
  `true` = simulate, nothing is sent or charged. Guide 05's tool executor honours it.
- `WORKFLOW_HINTS=true` — set `false` ONLY if Dograh 422-rejects the per-node
  stt/tts/llm/tools hints (see Step 4 RESILIENCE NOTE).

**Verify:**
```bash
grep -c "CHANGE_ME" .env; grep -n "^VAANI_DRY_RUN=\|^WORKFLOW_HINTS=\|^DOGRAH_UI_URL=" .env
```
**Expected:** count ≥ 6, and all three lines printed exactly once each.
**If it fails:** re-run the `for` loop once (it is idempotent); then STOP and report.

---

## Step 1: Industry template library (10 templates)

These templates are the "go live in 30 minutes" magic. Full file, exact content —
replaces the guide-04-era version (it is a superset: the original 6 templates keep
their `code`s, so existing DB rows stay valid).

**File `src/lib/templates.ts`:**

```ts
import type { AgentToolType } from "@prisma/client";

export type AgentTemplate = {
  code: string;
  name: string;
  industry: string;
  description: string;
  greeting: string;
  systemPrompt: string;
  suggestedVoice: string; // must exist in src/lib/voices.ts
  suggestedLlm: string; // must exist in LLM_MODELS (src/lib/voices.ts)
  suggestedTools: AgentToolType[];
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    code: "clinic-receptionist",
    name: "Clinic Receptionist",
    industry: "Healthcare",
    description: "Answers FAQs, books/reschedules appointments, takes messages for doctors.",
    greeting: "Namaste! Thank you for calling {{business_name}}. How may I help you today?",
    suggestedVoice: "anushka",
    suggestedLlm: "meta-llama/llama-3.1-70b-instruct",
    suggestedTools: ["CALENDAR_BOOKING", "HUMAN_TRANSFER", "VOICEMAIL"],
    systemPrompt: `You are the AI receptionist of {{business_name}}.
You speak Hindi, English and Hinglish — always match the caller's language.
Jobs: (1) answer FAQs about timings, location, services and prices using only the
facts given to you, (2) book, reschedule or cancel appointments — always confirm the
caller's name and phone number before booking, (3) take a detailed message for the
doctor or manager when needed.
Rules: never give medical advice or diagnoses; be warm, patient and concise; if the
caller is upset or explicitly asks for a human, promise a callback from the clinic
manager. End every call by summarizing what was agreed.`,
  },
  {
    code: "real-estate-qualifier",
    name: "Real Estate Lead Qualifier",
    industry: "Real Estate",
    description: "Qualifies property inquiries: budget, location, timeline; schedules site visits.",
    greeting: "Hello! Thank you for your interest in {{business_name}}. I'd love to help you find the right property.",
    suggestedVoice: "arvind",
    suggestedLlm: "anthropic/claude-3.5-sonnet",
    suggestedTools: ["CALENDAR_BOOKING", "CRM_WRITE"],
    systemPrompt: `You are a property consultant for {{business_name}}.
Match the caller's language (Hindi/English/Hinglish).
Jobs: (1) understand requirement — buy/rent, BHK, budget range, preferred locations,
possession timeline, (2) answer project questions from provided facts only,
(3) schedule a site visit — confirm date, time and phone number.
Rules: never invent prices, offers or possession dates; if unsure, say the sales team
will confirm on WhatsApp. Score the lead before ending: HOT (site visit fixed or
budget+timeline clear), WARM (interested, no timeline), COLD (just browsing) — and say
the next step clearly.`,
  },
  {
    code: "emi-reminder",
    name: "EMI / Payment Reminder",
    industry: "BFSI / Collections",
    description: "Polite payment reminders with amount, due date and payment-link offer.",
    greeting: "Namaste, this is a courtesy call from {{business_name}} regarding your account.",
    suggestedVoice: "anushka",
    suggestedLlm: "deepseek/deepseek-chat:floor",
    suggestedTools: ["PAYMENT_LINK", "SMS", "WHATSAPP"],
    systemPrompt: `You are a polite payment-reminder agent for {{business_name}}.
Match the caller's language. ALWAYS identify yourself as an automated calling agent
in the first sentence.
Jobs: (1) remind about the pending amount and due date (use only provided values),
(2) offer to send a payment link on WhatsApp/SMS, (3) note a promise-to-pay date if
the caller gives one.
Rules: NEVER threaten, harass, or call the caller's character into question; follow
RBI fair-practices tone; if the caller disputes the amount, log the dispute and say
the accounts team will call back; if the caller says "stop calling", apologize,
confirm the number will be marked do-not-call, and end immediately.`,
  },
  {
    code: "salon-booking",
    name: "Salon & Spa Booking",
    industry: "Beauty & Wellness",
    description: "Books services, quotes prices, manages slots and cancellations.",
    greeting: "Hi! Thanks for calling {{business_name}}. Looking to book a service today?",
    suggestedVoice: "anushka",
    suggestedLlm: "meta-llama/llama-3.1-70b-instruct",
    suggestedTools: ["CALENDAR_BOOKING", "WHATSAPP"],
    systemPrompt: `You are the front-desk assistant of {{business_name}} salon.
Match the caller's language.
Jobs: (1) quote services and prices from the provided list only, (2) book appointments
— service, date, time, stylist preference, caller name + phone, (3) reschedule or
cancel bookings.
Rules: suggest the next available slot if the requested one is taken; never invent
discounts; end by repeating the full booking details back to the caller.`,
  },
  {
    code: "delivery-confirmation",
    name: "Delivery / Order Confirmation",
    industry: "E-commerce & Logistics",
    description: "Confirms orders, delivery slots and COD amounts; reduces RTO.",
    greeting: "Hello! This is an automated confirmation call from {{business_name}} about your recent order.",
    suggestedVoice: "arvind",
    suggestedLlm: "deepseek/deepseek-chat:floor",
    suggestedTools: ["SMS", "WHATSAPP", "CUSTOM_WEBHOOK"],
    systemPrompt: `You are an order-confirmation agent for {{business_name}}.
Match the caller's language. Identify yourself as an automated agent immediately.
Jobs: (1) confirm the order id, items count and COD amount (use provided values only),
(2) confirm or reschedule the delivery date/slot, (3) confirm the delivery address
landmark.
Rules: if the caller cancels, capture the reason politely; if unreachable answers
(voicemail), end cleanly. Keep the call under 90 seconds unless the caller has
questions. End with a one-line summary: confirmed / rescheduled / cancelled + reason.`,
  },
  {
    code: "nps-survey",
    name: "Feedback / NPS Survey",
    industry: "Any",
    description: "Short post-service surveys with score capture and verbatim feedback.",
    greeting: "Hi! This is a 30-second feedback call from {{business_name}}. Is now a good time?",
    suggestedVoice: "anushka",
    suggestedLlm: "deepseek/deepseek-chat:floor",
    suggestedTools: ["CRM_WRITE"],
    systemPrompt: `You are a feedback-collection agent for {{business_name}}.
Match the caller's language. Identify as automated; ask permission before starting.
Jobs: (1) ask for a 0-10 rating, (2) ask the main reason for the score,
(3) if score <= 6, apologize and ask what went wrong; if >= 9, thank warmly and ask
what they loved.
Rules: maximum 3 questions; if the caller declines, thank them and end immediately;
end by thanking them and summarizing the score given.`,
  },
  {
    code: "emi-collections",
    name: "EMI Collections (Hard Due)",
    industry: "BFSI / Collections",
    description: "Overdue collections with promise-to-pay capture, dispute logging and DNC compliance.",
    greeting: "Namaste, this is an automated call from {{business_name}} about an overdue payment on your account.",
    suggestedVoice: "arvind",
    suggestedLlm: "meta-llama/llama-3.1-70b-instruct",
    suggestedTools: ["PAYMENT_LINK", "SMS", "HUMAN_TRANSFER"],
    systemPrompt: `You are an overdue-collections agent for {{business_name}}.
Match the caller's language. ALWAYS identify yourself as an automated calling agent
in the first sentence and state the call is regarding an overdue payment.
Jobs: (1) state the overdue amount, days overdue and minimum due (use only provided
values), (2) ask for a commitment: pay now via link, or a promise-to-pay date,
(3) if the caller disputes, capture the exact dispute reason and log it,
(4) if the caller requests a human or a settlement discussion, arrange a callback
from the collections team.
Rules: follow RBI fair-practices code strictly — no threats, no harassment, no
calling-family references, no mention of legal action unless explicitly provided in
your facts; call only facts from the account data given to you; if the caller says
"stop calling" or "don't call this number", apologize, confirm do-not-call will be
marked, and end immediately. End by summarizing: amount, commitment (or dispute),
and next step.`,
  },
  {
    code: "restaurant-reservations",
    name: "Restaurant Reservations",
    industry: "Hospitality / F&B",
    description: "Takes table bookings, quotes wait times, handles modifications and cancellations.",
    greeting: "Namaste! {{business_name}} — thanks for calling. Would you like to book a table?",
    suggestedVoice: "anushka",
    suggestedLlm: "google/gemini-flash-1.5",
    suggestedTools: ["CALENDAR_BOOKING", "SMS", "VOICEMAIL"],
    systemPrompt: `You are the reservations host of {{business_name}} restaurant.
Match the caller's language (Hindi/English/Hinglish).
Jobs: (1) take reservations — date, time, party size, occasion, seating preference
(indoor/outdoor), caller name + phone, (2) quote today's specials and approximate
wait time from provided facts only, (3) modify or cancel existing bookings,
(4) for groups larger than 10 or private events, take details and promise a callback
from the manager.
Rules: if a slot is full, offer the two nearest available slots; never invent menu
prices; confirm every booking by repeating date, time, party size and name; send an
SMS confirmation when the caller agrees. Be warm, quick and upbeat.`,
  },
  {
    code: "hotel-concierge",
    name: "Hotel Concierge & Reservations",
    industry: "Hotels & Travel",
    description: "Room bookings, check-in info, amenity FAQs and service requests for hotels.",
    greeting: "Thank you for calling {{business_name}}. This is your concierge — how may I assist you?",
    suggestedVoice: "vidya",
    suggestedLlm: "anthropic/claude-3.5-sonnet",
    suggestedTools: ["CALENDAR_BOOKING", "HUMAN_TRANSFER", "WHATSAPP"],
    systemPrompt: `You are the AI concierge of {{business_name}} hotel.
Match the caller's language; be polished, calm and precise.
Jobs: (1) room reservations — dates, room type, occupancy, name + phone, quote only
provided rates, (2) answer amenity/policy FAQs (check-in/out times, breakfast,
airport shuttle, Wi-Fi, pets, cancellation policy) from provided facts only,
(3) take in-stay service requests (extra towels, housekeeping, maintenance) and log
them with room number, (4) escalate billing disputes or complaints to the duty
manager with a promise of callback.
Rules: never invent availability or rates — say you will confirm and call back if
unsure; always repeat booking details before confirming; for VIP or angry callers,
offer immediate human transfer. End with a one-line summary of what was arranged.`,
  },
  {
    code: "recruitment-screener",
    name: "Recruitment Screener",
    industry: "HR / Recruitment",
    description: "First-round candidate screening: role fit, experience, salary expectations, interview scheduling.",
    greeting: "Hello! This is an automated screening call from {{business_name}} about the position you applied for. Do you have 5 minutes?",
    suggestedVoice: "manisha",
    suggestedLlm: "meta-llama/llama-3.1-70b-instruct",
    suggestedTools: ["CALENDAR_BOOKING", "CRM_WRITE", "VOICEMAIL"],
    systemPrompt: `You are a recruitment screening agent for {{business_name}}.
Match the candidate's language. Identify as an automated screening call and ask
permission to proceed before starting.
Jobs: (1) confirm identity and the role applied for, (2) ask screening questions
from the provided question set only — total experience, relevant skills, current
CTC and expected CTC, notice period, location/work-mode preference,
(3) answer candidate questions about the role from provided facts only,
(4) if the candidate clears the knockout criteria given to you, offer interview
slots and schedule one; otherwise thank them and say the hiring team will review.
Rules: be respectful and neutral; never comment on age, gender, religion, marital
status or any protected attribute; never negotiate salary; capture answers verbatim
for the recruiter. End with the outcome: interview scheduled (with date/time) or
application under review.`,
  },
];

export function getTemplate(code: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.code === code);
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.
**If it fails:** re-copy the file exactly (most common: truncated template string);
once more, then STOP and report.

---

## Step 2: Voice catalogue + language list + curated LLM list

One typed constant file drives the voice picker, the per-language mapping UI, and
the LLM picker. The 39 speaker ids below are the Sarvam Bulbul v3 catalogue.

> **OPERATOR NOTE (voice ids):** speaker ids change as Sarvam releases models. After
> guide 04 keys are live, verify once:
> `curl -s https://api.sarvam.ai/v1/models -H "api-subscription-key: $SARVAM_API_KEY" | grep -io bulbul`
> and cross-check a few speaker names against the Sarvam dashboard TTS playground.
> Fixing a name is a one-line change in this file — the whole UI is data-driven from it.

**File `src/lib/voices.ts`:**

```ts
/** Sarvam Bulbul v3 voice catalogue + supported languages + curated OpenRouter LLMs.
 *  Everything voice/LLM-related in the UI is data-driven from this file. */

export const SUPPORTED_LANGUAGES = [
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "mr", label: "Marathi" },
  { code: "od", label: "Odia" },
  { code: "pa", label: "Punjabi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "gu", label: "Gujarati" },
  { code: "en-IN", label: "English (India)" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => [l.code, l.label]),
);

/** Saarika auto-detect sentinel: languageCode "unknown" (readme §4.2). */
export const AUTO_DETECT_LANGUAGE_CODE = "unknown";

export type SarvamVoice = {
  id: string; // Bulbul v3 speaker id (lowercase)
  gender: "female" | "male";
  /** Every Bulbul v3 voice speaks all 11 languages; bestFor is the UI's
   *  recommendation tag for the per-language default mapping. */
  bestFor: LanguageCode[];
};

function v(id: string, gender: "female" | "male", bestFor: LanguageCode[] = []): SarvamVoice {
  return { id, gender, bestFor };
}

/** The 39 Bulbul v3 speakers. */
export const SARVAM_VOICES: SarvamVoice[] = [
  v("anushka", "female", ["hi", "en-IN"]),
  v("abhilash", "male", ["hi"]),
  v("manisha", "female", ["hi", "en-IN"]),
  v("vidya", "female", ["hi", "en-IN"]),
  v("arya", "female", ["hi"]),
  v("karun", "male", ["hi"]),
  v("hitesh", "male", ["hi"]),
  v("arvind", "male", ["hi", "en-IN"]),
  v("shubh", "male", ["hi"]),
  v("aditya", "male", ["hi"]),
  v("ritu", "female", ["hi"]),
  v("priya", "female", ["hi"]),
  v("neha", "female", ["hi", "mr"]),
  v("rahul", "male", ["hi", "en-IN"]),
  v("pooja", "female", ["hi"]),
  v("rohan", "male", ["hi"]),
  v("simran", "female", ["pa"]),
  v("kavya", "female", ["ta", "kn"]),
  v("amit", "male", ["hi"]),
  v("dev", "male", ["gu", "hi"]),
  v("ishita", "female", ["bn", "hi"]),
  v("shreya", "female", ["bn"]),
  v("ratan", "male", ["od", "bn"]),
  v("varun", "male", ["kn", "te"]),
  v("manan", "male", ["gu"]),
  v("sumitra", "female", ["ml"]),
  v("roopa", "female", ["kn"]),
  v("kian", "male", ["en-IN"]),
  v("nisha", "female", ["ta"]),
  v("anand", "male", ["ml", "ta"]),
  v("tara", "female", ["te"]),
  v("kabir", "male", ["mr", "hi"]),
  v("meera", "female", ["mr", "gu"]),
  v("arjun", "male", ["te", "en-IN"]),
  v("diya", "female", ["en-IN"]),
  v("vikram", "male", ["ta", "hi"]),
  v("aarti", "female", ["pa", "hi"]),
  v("kiran", "male", ["od"]),
  v("lakshmi", "female", ["te", "ta"]),
];

export function getVoice(id: string): SarvamVoice | undefined {
  return SARVAM_VOICES.find((x) => x.id === id);
}

/** Default voice for a language: first voice whose bestFor includes it, else fallback. */
export function defaultVoiceForLanguage(lang: string, fallback = "anushka"): string {
  const hit = SARVAM_VOICES.find((x) => (x.bestFor as string[]).includes(lang));
  return hit?.id ?? fallback;
}

/**
 * Resolve the voice to use for a detected language.
 * voiceMap is the per-language mapping from the agent's conversationConfig.
 * Unknown/unsupported languages fall back to the agent's primary voice.
 */
export function resolveVoiceForLanguage(
  voiceMap: Record<string, string> | null | undefined,
  detectedLang: string | null | undefined,
  fallbackVoiceId: string,
): string {
  if (detectedLang && voiceMap && voiceMap[detectedLang]) {
    const id = voiceMap[detectedLang];
    if (getVoice(id)) return id;
  }
  return fallbackVoiceId;
}

// ---------- Language modes ----------

export const LANGUAGE_MODES = [
  {
    id: "auto",
    label: "Auto-detect (recommended) — Saarika languageCode: unknown",
  },
  { id: "fixed", label: "Fixed language" },
  { id: "caller-select", label: 'Caller chooses ("Hindi ke liye 1 dabaiye")' },
] as const;

export type LanguageMode = (typeof LANGUAGE_MODES)[number]["id"];

// ---------- Curated OpenRouter LLM list ----------

export type LlmTier = "floor" | "balanced" | "nitro" | "premium";

export type LlmOption = {
  id: string; // exact OpenRouter model id (may carry :floor / :nitro suffix)
  label: string;
  tier: LlmTier;
  useFor: string;
};

export const LLM_MODELS: LlmOption[] = [
  {
    id: "deepseek/deepseek-chat:floor",
    label: "DeepSeek Chat (:floor)",
    tier: "floor",
    useFor: "Cheapest — simple FAQ / reminder / confirmation agents",
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct:floor",
    label: "Llama 3.1 8B (:floor)",
    tier: "floor",
    useFor: "Cheap — short scripted calls, surveys",
  },
  {
    id: "meta-llama/llama-3.1-70b-instruct",
    label: "Llama 3.1 70B (default)",
    tier: "balanced",
    useFor: "Balanced cost/quality — receptionists, qualifiers",
  },
  {
    id: "google/gemini-flash-1.5",
    label: "Gemini Flash 1.5",
    tier: "balanced",
    useFor: "Fast, strong Hinglish/code-mixing",
  },
  {
    id: "google/gemini-flash-1.5:nitro",
    label: "Gemini Flash 1.5 (:nitro)",
    tier: "nitro",
    useFor: "Latency-sensitive calls (<800ms budget)",
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    label: "Claude 3.5 Sonnet",
    tier: "premium",
    useFor: "Premium — complex sales / negotiation conversations",
  },
  {
    id: "openai/gpt-4o:nitro",
    label: "GPT-4o (:nitro)",
    tier: "nitro",
    useFor: "Premium + low latency",
  },
];

export function getLlm(id: string): LlmOption | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

/** Failover chain for a chosen model (readme §4.2: automatic failover if a provider
 *  rate-limits). Guide 04 configured OpenRouter inside Dograh; this chain is passed
 *  per-node by the workflow builder (guide 04 owns the mechanism — we consume it). */
export function llmFallbackChain(primaryId: string): string[] {
  const chain: string[] = [primaryId];
  if (primaryId !== "meta-llama/llama-3.1-70b-instruct") {
    chain.push("meta-llama/llama-3.1-70b-instruct");
  }
  if (primaryId !== "google/gemini-flash-1.5") chain.push("google/gemini-flash-1.5");
  if (primaryId !== "deepseek/deepseek-chat:floor") chain.push("deepseek/deepseek-chat:floor");
  return chain;
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx tsx -e "
import('tsx/cjs').then(async () => {
  const { SARVAM_VOICES, LLM_MODELS, defaultVoiceForLanguage } = await import('./src/lib/voices');
  console.log('voices:', SARVAM_VOICES.length, 'llms:', LLM_MODELS.length, 'bn-default:', defaultVoiceForLanguage('bn'));
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** typecheck exit 0, then `voices: 39 llms: 7 bn-default: ishita`.
**If it fails:** the tsx error names the line — fix against the file above; once more,
then STOP and report.

---

## Step 3: ONE additive Prisma migration (agent conversation config + version uuid)

The authoritative schema (guide 02) is NOT modified. We need two additive fields that
guide 02 predates; everything else in this guide uses existing models as-is.

1. `Agent.conversationConfig Json?` — editable draft of conversation controls
   (barge-in, VAD, silence timeout, fillers, pace) + per-language voice map. Published
   snapshots still land in `AgentVersion.config` (guide 02).
2. `AgentVersion.dograhWorkflowUuid String?` — guide 04 added `Agent.dograhWorkflowUuid`;
   versions need the same because Dograh's public call-trigger endpoint takes the uuid
   (guides 06/07 trigger calls against a resolved *version*).

**Edit `prisma/schema.prisma`:** in `model Agent`, directly under the line
`maxCallSeconds   Int         @default(600)` add:
```prisma
  conversationConfig Json? // {allowBargeIn, vadSensitivity, silenceTimeoutSec, fillerPhrases[], speakingPace, voiceMap{lang:voiceId}}
```

In `model AgentVersion`, directly under the line `dograhWorkflowId String?  // Dograh workflow created for THIS version` add:
```prisma
  dograhWorkflowUuid String? // Dograh workflow_uuid for THIS version (public call-trigger path)
```

**Do:**
```bash
cd /root/vaani-ai
npx prisma migrate dev --name agent_controls_version_uuid && npm run typecheck
```
**Expected:** migration applied, `✔ Generated Prisma Client`, typecheck exit 0.
**If it fails:** `Can't reach database server` → `docker compose up -d && sleep 10`,
retry once. Schema error → the two added lines are misplaced; move them exactly as
instructed and retry once. Then STOP and report.

---

## Step 4: Workflow-definition builder (greeting → qualification → FAQ → booking → transfer)

We do NOT rebuild Dograh's drag-and-drop builder. This module generates Dograh
workflow JSON from our agent config; users who want the full visual canvas open the
Dograh UI via the deep link in Step 11. Concepts mapped:

- **Branching on intent/entities/sentiment/variables** → multiple `agentNode`s with
  edges whose `data.condition` describes the branch ("caller wants to book",
  "caller is angry or asks for a human"); `extraction_variables` capture entities.
- **Multi-agent flows** → specialist nodes: `greeter` (startCall) → `main agent` →
  `scheduler` (booking specialist) → `transfer` (human handoff) with clean edges.
- **Caller-selectable language** → a DTMF-style pre-flow node before the main agent.
- **Per-agent voice/LLM/controls** → `data.stt`/`data.tts`/`data.llm` hints on nodes
  (Dograh's model-configuration concept, guide 04 owns the provider setup).

> **RESILIENCE NOTE (important):** `stt`/`tts`/`llm`/`tools` sub-objects are emitted
> as best-effort hints following Dograh's model-configuration concept; Dograh versions
> that ignore unknown node keys work fine. If publish returns `Dograh 422` naming one
> of these keys, set `WORKFLOW_HINTS=false` in `.env` (builder then omits them; the
> per-agent prompts still carry every behavioral instruction) and re-publish. Report
> the deviation. Prompt-level instructions are the baseline that ALWAYS works.

> **HYBRID PRE-RECORDED AUDIO + LATENCY BUDGET (readme §4.2):** pre-recording
> predictable utterances (greetings, compliance disclosures) and the <800ms streaming
> latency budget are Dograh pipeline capabilities (see `dograh_api_docs.txt`:
> "Pre-recorded Audio", "Interruption Handling", "Model Configurations"), not code we
> write. Our builder emits streaming-friendly nodes (`allow_interrupt` per node, pace
> hints). To pre-record a compliance-critical greeting: open the workflow in the
> Dograh advanced editor (Step 5 deep link) → upload the audio on the start node per
> Dograh's pre-recorded-audio docs. Recording disclosures themselves are configured
> per workspace/agent (guide 02 fields) and enforced by guide 06.

**File `src/lib/workflow-builder.ts`:**

```ts
/**
 * Generate Dograh workflow_definition JSON from a Vaani agent configuration.
 * Pure functions — fully unit-tested in tests/workflow-builder.test.ts.
 * Dograh node/edge contract: plan/04 guide §"The Dograh API contract".
 */

export type ConversationControls = {
  allowBargeIn: boolean; // caller may interrupt the bot while it speaks
  vadSensitivity: "low" | "medium" | "high"; // voice-activity-detection tuning
  silenceTimeoutSec: number; // end-call prompting after this much dead air
  fillerPhrases: string[]; // spoken while the LLM thinks ("ek second...", "hmm")
  speakingPace: "slow" | "normal" | "fast";
  voiceMap?: Record<string, string>; // per-language voice override { "ta": "kavya" }
};

export const DEFAULT_CONTROLS: ConversationControls = {
  allowBargeIn: true,
  vadSensitivity: "medium",
  silenceTimeoutSec: 20,
  fillerPhrases: ["Ek second...", "Haan ji...", "Let me check..."],
  speakingPace: "normal",
  voiceMap: {},
};

export type ToolNodeSpec = {
  tool: string; // AgentToolType enum value
  config: Record<string, unknown>;
};

export type WorkflowSpec = {
  name: string;
  greeting: string;
  systemPrompt: string;
  languageMode: "auto" | "fixed" | "caller-select";
  fixedLanguage?: string | null;
  voiceId: string;
  llmModel: string;
  llmFallbacks?: string[];
  maxCallSeconds: number; // Dograh caps at 1200 — caller clamps
  controls: ConversationControls;
  kbGuardrail: boolean; // answer only from KB else "let me confirm and call you back"
  callerSelectLanguages?: { code: string; label: string }[]; // for caller-select mode
  tools: ToolNodeSpec[];
};

export type WorkflowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  data: { label: string; condition: string; transition_speech?: string };
};

export type WorkflowDefinition = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };

/** readme §4.3 guardrail: answer only from the knowledge base. */
export const KB_GUARDRAIL_PROMPT = `KNOWLEDGE GUARDRAIL (highest priority rule):
Answer factual questions ONLY from the knowledge base documents and facts provided
to you. If the answer is not in the knowledge base, do NOT guess or make anything up.
Say exactly this instead: "let me confirm and call you back" — then note the
question so the team can follow up.`;

const HINTS_ON = () => process.env.WORKFLOW_HINTS !== "false";

/** Prompt section instructing the LLM when to trigger each enabled tool. */
export function buildToolPromptSection(tools: ToolNodeSpec[]): string {
  if (tools.length === 0) return "";
  const lines = tools.map((t) => {
    switch (t.tool) {
      case "CALENDAR_BOOKING":
        return "- BOOK APPOINTMENT: when the caller wants to book/reschedule/cancel, collect name, phone, date and time, then use the book_appointment tool. Confirm by repeating the details.";
      case "HUMAN_TRANSFER":
        return "- TRANSFER TO HUMAN: if the caller explicitly asks for a human, is very upset, or you cannot help after two tries, use the transfer_to_human tool and say you are connecting them.";
      case "SMS":
        return "- SEND SMS: when the caller agrees to receive details by SMS, use the send_sms tool with the confirmed phone number.";
      case "WHATSAPP":
        return "- SEND WHATSAPP: when the caller agrees to receive details/links on WhatsApp, use the send_whatsapp tool with the confirmed phone number.";
      case "CRM_WRITE":
        return "- CRM UPDATE: before ending the call, use the crm_write tool to log the caller's name, phone, requirement and the call outcome.";
      case "PAYMENT_LINK":
        return "- PAYMENT COLLECTION: when the caller agrees to pay, read out the exact amount, use the payment_collection tool to create and send the payment link, and tell them you will confirm once paid.";
      case "CUSTOM_WEBHOOK":
        return "- EXTERNAL LOOKUP: when you need live data (order status, account details), use the custom_webhook tool and relay the answer.";
      case "VOICEMAIL":
        return "- TAKE A MESSAGE: if the caller wants to leave a message or the right person is unavailable, use the voicemail_capture tool to record name, number and message, and promise a callback.";
      default:
        return `- ${t.tool}: use the matching tool when relevant.`;
    }
  });
  return `TOOLS AVAILABLE (call the matching tool exactly when the condition is met):\n${lines.join("\n")}`;
}

/** Controls → prompt section (pace, fillers, silence, interruption). */
export function buildControlsPromptSection(c: ConversationControls): string {
  const pace =
    c.speakingPace === "slow"
      ? "Speak slowly and clearly, pausing between sentences."
      : c.speakingPace === "fast"
        ? "Speak briskly and keep every reply under two sentences."
        : "Speak at a natural conversational pace.";
  const fillers =
    c.fillerPhrases.length > 0
      ? `While you are thinking or looking something up, use a short filler like: ${c.fillerPhrases.join(", ")}.`
      : "Never leave more than 2 seconds of dead air.";
  return `${pace} ${fillers} If the caller is silent for about ${c.silenceTimeoutSec} seconds, gently ask if they are still there; if silence continues, summarize and end the call politely.`;
}

function sttHint(spec: WorkflowSpec): Record<string, unknown> {
  return {
    provider: "sarvam",
    model: "saarika",
    language_code:
      spec.languageMode === "fixed" && spec.fixedLanguage
        ? spec.fixedLanguage
        : "unknown", // Saarika auto-detect (readme §4.2)
  };
}

function ttsHint(spec: WorkflowSpec): Record<string, unknown> {
  return {
    provider: "sarvam",
    model: "bulbul:v3",
    voice_id: spec.voiceId,
    pace: spec.controls.speakingPace ?? "normal",
    voice_map: spec.controls.voiceMap ?? {},
  };
}

function llmHint(spec: WorkflowSpec): Record<string, unknown> {
  return {
    provider: "openrouter",
    model: spec.llmModel,
    fallbacks: spec.llmFallbacks ?? [],
  };
}

/** Dograh tool node configs (HTTP API tools call back into OUR app — see
 *  src/app/api/tools/execute/route.ts). Call Transfer uses Dograh's native tool. */
export function buildToolNodeConfigs(spec: WorkflowSpec): Record<string, unknown>[] {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const secret = process.env.DOGRAH_WEBHOOK_SECRET ?? "";
  const out: Record<string, unknown>[] = [];
  for (const t of spec.tools) {
    if (t.tool === "HUMAN_TRANSFER") {
      out.push({
        type: "call_transfer",
        name: "transfer_to_human",
        destination: t.config.fallbackNumber ?? "",
        queue: t.config.queue ?? "support",
        skill: t.config.skill ?? "",
        whisper_summary: t.config.whisperSummary ?? true,
      });
    } else if (t.tool === "VOICEMAIL") {
      // Voicemail/message capture is a prompt-driven flow; the voicemail_capture
      // HTTP tool stores the message in our DB.
      out.push({
        type: "http_api",
        name: "voicemail_capture",
        http_method: "POST",
        endpoint_url: `${appUrl}/api/tools/execute`,
        custom_headers: [{ key: "x-tool-secret", value: secret }],
        payload_template: { tool: "VOICEMAIL", input: { message: "{{caller_message}}", caller_name: "{{caller_name}}", caller_phone: "{{from_number}}" } },
      });
    } else if (t.tool === "CUSTOM_WEBHOOK") {
      out.push({
        type: "http_api",
        name: "custom_webhook",
        http_method: String(t.config.method ?? "POST"),
        endpoint_url: String(t.config.url ?? ""),
        custom_headers: t.config.authHeader
          ? [{ key: "Authorization", value: String(t.config.authHeader) }]
          : [],
        payload_template: t.config.requestTemplate ?? {},
      });
    } else {
      // CALENDAR_BOOKING, SMS, WHATSAPP, CRM_WRITE, PAYMENT_LINK → our executor
      out.push({
        type: "http_api",
        name: t.tool.toLowerCase(),
        http_method: "POST",
        endpoint_url: `${appUrl}/api/tools/execute`,
        custom_headers: [{ key: "x-tool-secret", value: secret }],
        payload_template: { tool: t.tool, input: "{{tool_input}}" },
      });
    }
  }
  return out;
}

/** DTMF-style language pre-flow for caller-select mode ("Hindi ke liye 1 dabaiye"). */
export function buildCallerSelectPreflow(
  languages: { code: string; label: string }[],
): { node: WorkflowNode; edge: WorkflowEdge } {
  const menu = languages.map((l, i) => `${l.label} ke liye ${i + 1} dabaiye (press ${i + 1} for ${l.label})`).join(". ");
  return {
    node: {
      id: "lang-1",
      type: "agentNode",
      position: { x: 300, y: 0 },
      data: {
        name: "Language selection",
        prompt: `Say this language menu exactly, in a friendly tone: "${menu}". Then collect the caller's choice (DTMF keypress or spoken language name). Set the variable selected_language to the language code for the rest of the call: ${languages.map((l, i) => `${i + 1}=${l.code}`).join(", ")}. If the caller does not respond, default to ${languages[0]?.code ?? "hi"}.`,
        allow_interrupt: true,
        extraction_variables: [
          { name: "selected_language", type: "string", prompt: `The language the caller chose. One of: ${languages.map((l) => l.code).join(", ")}.` },
        ],
      },
    },
    edge: {
      id: "edge-lang",
      source: "lang-1",
      target: "agent-1",
      data: {
        label: "Language chosen",
        condition: "selected_language is set — continue the call in that language",
        transition_speech: "Switching to your language now.",
      },
    },
  };
}

/**
 * Build the full workflow: startCall (greeting) → [language pre-flow] → main agent
 * → [booking specialist] → [human transfer] → webhook sync → endCall.
 */
export function buildAgentWorkflow(spec: WorkflowSpec): WorkflowDefinition {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const secret = process.env.DOGRAH_WEBHOOK_SECRET ?? "";
  const hints = HINTS_ON();
  const has = (tool: string) => spec.tools.some((t) => t.tool === tool);

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  nodes.push({
    id: "start-1",
    type: "startCall",
    position: { x: 0, y: 0 },
    data: {
      name: "Greeting",
      prompt: `Greet the caller with exactly this greeting, then listen: "${spec.greeting}"`,
      allow_interrupt: spec.controls.allowBargeIn,
      ...(hints ? { stt: sttHint(spec), tts: ttsHint(spec) } : {}),
    },
  });

  let entryTarget = "agent-1";
  if (spec.languageMode === "caller-select") {
    const langs = spec.callerSelectLanguages?.length
      ? spec.callerSelectLanguages
      : [{ code: "hi", label: "Hindi" }, { code: "en-IN", label: "English" }];
    const pre = buildCallerSelectPreflow(langs.slice(0, 4));
    nodes.push(pre.node);
    edges.push({
      id: "edge-start-lang",
      source: "start-1",
      target: "lang-1",
      data: { label: "Greeting done", condition: "The greeting has been delivered" },
    });
    edges.push(pre.edge);
    entryTarget = "lang-1";
  } else {
    edges.push({
      id: "edge-start-agent",
      source: "start-1",
      target: "agent-1",
      data: { label: "Greeting done", condition: "The greeting has been delivered" },
    });
  }

  const promptParts = [spec.systemPrompt];
  if (spec.kbGuardrail) promptParts.push(KB_GUARDRAIL_PROMPT);
  promptParts.push(buildControlsPromptSection(spec.controls));
  const toolSection = buildToolPromptSection(spec.tools);
  if (toolSection) promptParts.push(toolSection);
  if (spec.languageMode === "fixed" && spec.fixedLanguage) {
    promptParts.push(`Speak ONLY in language code "${spec.fixedLanguage}" for the entire call, regardless of what language the caller uses.`);
  }

  nodes.push({
    id: "agent-1",
    type: "agentNode",
    position: { x: 600, y: 0 },
    data: {
      name: spec.name,
      prompt: promptParts.join("\n\n"),
      allow_interrupt: spec.controls.allowBargeIn,
      vad_sensitivity: spec.controls.vadSensitivity,
      extraction_enabled: true,
      extraction_variables: [
        { name: "call_summary", type: "string", prompt: "Summarize the call in 2-3 sentences: what the caller wanted and what was agreed." },
        { name: "outcome", type: "string", prompt: "One-word outcome: booked, qualified, not-interested, message-taken, payment-promised, payment-link-sent, dispute, dnc-requested, transferred, or other." },
        { name: "callback_requested", type: "boolean", prompt: "Did the caller ask for a human or a callback?" },
        { name: "caller_name", type: "string", prompt: "The caller's name if they gave it, else empty." },
        { name: "caller_sentiment", type: "string", prompt: "positive, neutral or negative." },
      ],
      ...(hints
        ? { stt: sttHint(spec), tts: ttsHint(spec), llm: llmHint(spec), tools: buildToolNodeConfigs(spec) }
        : {}),
    },
  });

  // Multi-agent handoff 1: booking specialist node (greeting → qualification → FAQ → booking).
  if (has("CALENDAR_BOOKING")) {
    nodes.push({
      id: "booking-1",
      type: "agentNode",
      position: { x: 600, y: 250 },
      data: {
        name: "Booking specialist",
        prompt: `You are the scheduling specialist. The caller wants to book, reschedule or cancel an appointment. Collect: full name, phone number, preferred date and time, and reason. Check availability and book using the book_appointment tool. Always repeat the final booking details back. Business: ${spec.name}.`,
        allow_interrupt: true,
        ...(hints ? { tools: buildToolNodeConfigs({ ...spec, tools: spec.tools.filter((t) => t.tool === "CALENDAR_BOOKING") }) } : {}),
      },
    });
    edges.push({
      id: "edge-agent-booking",
      source: "agent-1",
      target: "booking-1",
      data: {
        label: "Booking intent",
        condition: "The caller wants to book, reschedule or cancel an appointment",
        transition_speech: "Let me help you with the booking.",
      },
    });
    edges.push({
      id: "edge-booking-agent",
      source: "booking-1",
      target: "agent-1",
      data: { label: "Booking done", condition: "The booking is confirmed or the caller changes topic" },
    });
  }

  // Multi-agent handoff 2: human transfer node (sentiment/intent branch).
  if (has("HUMAN_TRANSFER")) {
    nodes.push({
      id: "transfer-1",
      type: "agentNode",
      position: { x: 600, y: 500 },
      data: {
        name: "Human handoff",
        prompt: "The caller needs a human. Apologize for the trouble, say you are connecting them to the team right now, then invoke the transfer_to_human tool. If no human answers, take a message and promise a callback.",
        allow_interrupt: true,
        ...(hints ? { tools: buildToolNodeConfigs({ ...spec, tools: spec.tools.filter((t) => t.tool === "HUMAN_TRANSFER") }) } : {}),
      },
    });
    edges.push({
      id: "edge-agent-transfer",
      source: "agent-1",
      target: "transfer-1",
      data: {
        label: "Escalation",
        condition: "The caller explicitly asks for a human, or caller_sentiment is negative after two failed attempts to help",
        transition_speech: "Please hold while I connect you to our team.",
      },
    });
  }

  nodes.push({
    id: "webhook-1",
    type: "webhook",
    position: { x: 900, y: 0 },
    data: {
      name: "Sync to Vaani",
      enabled: true,
      http_method: "POST",
      endpoint_url: `${appUrl}/api/webhooks/dograh`,
      custom_headers: [{ key: "x-webhook-secret", value: secret }],
      payload_template: {
        event: "call.ended",
        data: {
          run_id: "{{run_id}}",
          workflow_id: "{{workflow_id}}",
          from_number: "{{from_number}}",
          to_number: "{{to_number}}",
          duration_seconds: "{{call_duration_seconds}}",
          summary: "{{call_summary}}",
          outcome: "{{outcome}}",
          caller_name: "{{caller_name}}",
          sentiment: "{{caller_sentiment}}",
          transcript_url: "{{transcript_url}}",
          recording_url: "{{recording_public_url}}",
        },
      },
    },
  });
  edges.push({
    id: "edge-agent-webhook",
    source: "agent-1",
    target: "webhook-1",
    data: { label: "Conversation complete", condition: "The caller's need is fully handled or they want to end the call" },
  });

  nodes.push({
    id: "end-1",
    type: "endCall",
    position: { x: 1200, y: 0 },
    data: { name: "End", prompt: "Thank the caller warmly and say goodbye in their language." },
  });
  edges.push({
    id: "edge-webhook-end",
    source: "webhook-1",
    target: "end-1",
    data: { label: "Synced", condition: "Always" },
  });

  return { nodes, edges };
}

/** Structural validation — used by unit tests and as a pre-publish sanity check. */
export function validateWorkflowDefinition(def: WorkflowDefinition): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));
  const starts = def.nodes.filter((n) => n.type === "startCall" || n.type === "trigger");
  if (starts.length !== 1) errors.push(`expected exactly 1 startCall/trigger node, got ${starts.length}`);
  if (!def.nodes.some((n) => n.type === "endCall")) errors.push("missing endCall node");
  if (!def.nodes.some((n) => n.type === "agentNode")) errors.push("missing agentNode");
  for (const n of def.nodes) {
    if (!n.data.name) errors.push(`node ${n.id} missing data.name`);
    // prompt is required on conversational nodes; webhook nodes carry endpoint config instead
    if (["startCall", "agentNode", "endCall"].includes(n.type) && !n.data.prompt) {
      errors.push(`node ${n.id} missing data.prompt`);
    }
  }
  for (const e of def.edges) {
    if (!ids.has(e.source)) errors.push(`edge ${e.id}: unknown source ${e.source}`);
    if (!ids.has(e.target)) errors.push(`edge ${e.id}: unknown target ${e.target}`);
  }
  return { valid: errors.length === 0, errors };
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx tsx -e "
import('tsx/cjs').then(async () => {
  const { buildAgentWorkflow, validateWorkflowDefinition, DEFAULT_CONTROLS } = await import('./src/lib/workflow-builder');
  const def = buildAgentWorkflow({ name:'t', greeting:'hi', systemPrompt:'you are a test agent with prompt', languageMode:'caller-select', voiceId:'anushka', llmModel:'m', maxCallSeconds:600, controls:DEFAULT_CONTROLS, kbGuardrail:true, tools:[{tool:'CALENDAR_BOOKING',config:{}},{tool:'HUMAN_TRANSFER',config:{}}] });
  const r = validateWorkflowDefinition(def);
  console.log('nodes:', def.nodes.length, 'edges:', def.edges.length, 'valid:', r.valid, r.errors.join(';'));
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** typecheck exit 0; then `nodes: 7 edges: 7 valid: true` (empty errors).
**If it fails:** the error names the line — fix against the file above; once more,
then STOP and report.

---

## Step 5: Extend `src/lib/dograh.ts` (test runs + UI deep links)

Guide 04 created this file. Do NOT rewrite it — make these three precise additions.

**Edit 1:** in the `PATHS` object, add one line (anywhere inside the object):

```ts
  createTestRun: (id: number) => `/api/v1/workflow/${id}/runs`,
```

**Edit 2:** append at the END of `src/lib/dograh.ts`:

```ts
// ---------- Guide 05 additions ----------

export type DograhTestRun = {
  id: number;
  workflow_id: number;
  status: string;
  [k: string]: unknown;
};

/**
 * Create a test run — executes the workflow WITHOUT placing a real phone call
 * (Dograh API: "Create Test Run"). The operator then talks to the agent in the
 * Dograh web UI (web-call / WebRTC widget). If this path 404s on your Dograh
 * version, fetch `curl -s $DOGRAH_BASE_URL/openapi.json | grep -o '"/api/v1/[^"]*runs[^"]*"'`,
 * update ONLY the PATHS.createTestRun line, and report the deviation.
 */
export async function dograhCreateTestRun(workflowId: number): Promise<DograhTestRun> {
  return request("POST", PATHS.createTestRun(workflowId), {});
}

/** Deep link into the Dograh WEB UI (visual flow editor / browser test call). */
export function dograhWorkflowUiUrl(dograhWorkflowId: string | number): string {
  const ui = (process.env.DOGRAH_UI_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${ui}/workflow/${dograhWorkflowId}`;
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && grep -c "createTestRun" src/lib/dograh.ts
```
**Expected:** typecheck exit 0; count `2`.

> **OPERATOR GATE (advanced flow editor route):** open the Dograh web UI, click into
> any workflow, and copy the browser URL. If it is NOT `…/workflow/<id>`, change the
> path template inside `dograhWorkflowUiUrl()` to match what you see (one-line edit)
> and note it in your report. The button in our UI simply opens this URL in a new tab.

---

## Step 6: Version-control + A/B pure logic

**File `src/lib/versions.ts`** (pure functions — unit-tested):

```ts
/** Version snapshot logic. Pure — no DB, no Dograh. Unit-tested in tests/versions.test.ts. */

export type AgentSnapshot = {
  systemPrompt: string;
  greeting: string;
  config: {
    voiceId: string;
    llmModel: string;
    languageMode: string;
    fixedLanguage: string | null;
    maxCallSeconds: number;
    conversationConfig: unknown;
    tools: { tool: string; config: unknown }[];
  };
};

/** What we freeze into an AgentVersion row on publish. */
export function snapshotAgent(agent: {
  systemPrompt: string;
  greeting: string;
  voiceId: string;
  llmModel: string;
  languageMode: string;
  fixedLanguage: string | null;
  maxCallSeconds: number;
  conversationConfig: unknown;
  toolConfigs: { tool: string; config: unknown }[];
}): AgentSnapshot {
  return {
    systemPrompt: agent.systemPrompt,
    greeting: agent.greeting,
    config: {
      voiceId: agent.voiceId,
      llmModel: agent.llmModel,
      languageMode: agent.languageMode,
      fixedLanguage: agent.fixedLanguage,
      maxCallSeconds: agent.maxCallSeconds,
      conversationConfig: agent.conversationConfig ?? null,
      tools: agent.toolConfigs.map((t) => ({ tool: t.tool, config: t.config })),
    },
  };
}

/** Next version number from existing rows. */
export function nextVersionNumber(existing: { version: number }[]): number {
  return existing.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

/**
 * Validate an A/B split. Rules (v1): at most ONE A/B variant per agent; the variant
 * gets abTrafficPercent in 1..99; the main published version gets the remainder.
 */
export function validateAbSplit(params: {
  existingAbVariants: { id: string }[];
  trafficPercent: number;
}): { ok: true } | { ok: false; error: string } {
  if (params.existingAbVariants.length >= 1) {
    return { ok: false, error: "This agent already has an A/B variant. Remove it first (v1 supports one)." };
  }
  if (!Number.isInteger(params.trafficPercent) || params.trafficPercent < 1 || params.trafficPercent > 99) {
    return { ok: false, error: "A/B traffic must be a whole number between 1 and 99 (the main version gets the rest)." };
  }
  return { ok: true };
}
```

**File `src/lib/ab-test.ts`** (pure — exported for guides 06/07):

```ts
import { createHash } from "crypto";

/**
 * A/B resolver — called at CALL START by guide 06 (inbound) and guide 07 (outbound)
 * to pick which published AgentVersion (and therefore which Dograh workflow) serves
 * this call. Deterministic: the same caller always lands in the same bucket.
 */

export type AbCandidate = {
  id: string; // AgentVersion id
  isAbVariant: boolean;
  abTrafficPercent: number | null;
  dograhWorkflowId: string | null;
  dograhWorkflowUuid: string | null;
};

/** Deterministic bucket 0..99 for (agentId, phone). */
export function abBucket(agentId: string, callerPhone: string): number {
  const digest = createHash("sha256").update(`${agentId}:${callerPhone}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Pick the serving version. `published` = all PUBLISHED versions of the agent
 * (the main one has isAbVariant=false; at most one A/B variant exists).
 * Falls back to the main published version when no A/B variant or no phone given.
 */
export function resolveServingVersion(
  published: AbCandidate[],
  agentId: string,
  callerPhone?: string,
): AbCandidate | null {
  const main = published.find((v) => !v.isAbVariant) ?? null;
  const variant = published.find((v) => v.isAbVariant) ?? null;
  if (!variant || !callerPhone) return main;
  const pct = variant.abTrafficPercent ?? 0;
  if (pct <= 0) return main;
  return abBucket(agentId, callerPhone) < pct ? variant : main;
}

/**
 * Full resolution for call-start: which Dograh workflow should handle this call.
 * Returns null when nothing usable is published (caller must NOT dial then).
 */
export function resolveAgentForCall(input: {
  agentId: string;
  callerPhone?: string;
  publishedVersions: AbCandidate[];
}): { versionId: string; dograhWorkflowId: string; dograhWorkflowUuid: string | null } | null {
  const v = resolveServingVersion(input.publishedVersions, input.agentId, input.callerPhone);
  if (!v || !v.dograhWorkflowId) return null;
  return { versionId: v.id, dograhWorkflowId: v.dograhWorkflowId, dograhWorkflowUuid: v.dograhWorkflowUuid };
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx tsx -e "
import('tsx/cjs').then(async () => {
  const { abBucket, resolveServingVersion } = await import('./src/lib/ab-test');
  const pubs=[{id:'main',isAbVariant:false,abTrafficPercent:null,dograhWorkflowId:'1',dograhWorkflowUuid:'a'},{id:'var',isAbVariant:true,abTrafficPercent:50,dograhWorkflowId:'2',dograhWorkflowUuid:'b'}];
  const picks=new Set(); for(let i=0;i<20;i++){ picks.add(resolveServingVersion(pubs,'agent1','+9199'+i).id); }
  console.log('bucket stable:', abBucket('a','p')===abBucket('a','p'), 'both picked:', picks.size===2, 'no phone main:', resolveServingVersion(pubs,'agent1').id==='main');
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** typecheck exit 0; `bucket stable: true both picked: true no phone → main: true`.
**If it fails:** re-copy the file; once more, then STOP and report.

---

## Step 7: Server actions — agent CRUD + versions + publish/rollback + A/B + test call

This REPLACES `src/server/actions/agents.ts` from the old guide (superset — same
action names plus new ones). Full content:

**File `src/server/actions/agents.ts`:**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getTemplate } from "@/lib/templates";
import {
  buildAgentWorkflow,
  validateWorkflowDefinition,
  DEFAULT_CONTROLS,
  type ConversationControls,
} from "@/lib/workflow-builder";
import { llmFallbackChain } from "@/lib/voices";
import { nextVersionNumber, snapshotAgent, validateAbSplit } from "@/lib/versions";
import {
  dograhCreateWorkflow,
  dograhUpdateWorkflow,
  dograhPublishWorkflow,
  dograhCreateTestRun,
  dograhWorkflowUiUrl,
  DograhError,
} from "@/lib/dograh";

export type ActionResult = { ok: boolean; error?: string; id?: string; url?: string };

// ---------- Zod schemas (boundaries) ----------

const conversationConfigSchema = z.object({
  allowBargeIn: z.boolean().default(true),
  vadSensitivity: z.enum(["low", "medium", "high"]).default("medium"),
  silenceTimeoutSec: z.coerce.number().int().min(5).max(120).default(20),
  fillerPhrases: z.array(z.string().max(60)).max(6).default(DEFAULT_CONTROLS.fillerPhrases),
  speakingPace: z.enum(["slow", "normal", "fast"]).default("normal"),
  voiceMap: z.record(z.string(), z.string()).default({}),
});

const agentSchema = z.object({
  name: z.string().min(2).max(80),
  template: z.string().optional(),
  greeting: z.string().min(5).max(500),
  systemPrompt: z.string().min(20).max(8000),
  languageMode: z.enum(["auto", "fixed", "caller-select"]),
  fixedLanguage: z.string().max(10).optional(),
  voiceId: z.string().min(1).max(40),
  llmModel: z.string().min(3).max(120),
  maxCallSeconds: z.coerce.number().int().min(60).max(3600),
  kbGuardrail: z.coerce.boolean().default(false),
  conversationConfig: conversationConfigSchema.default(conversationConfigSchema.parse({})),
});

// ---------- Plan gate (guide 09 owns billing; we only enforce maxAgents) ----------

async function assertAgentQuota(workspaceId: string): Promise<string | null> {
  const [count, sub] = await Promise.all([
    db.agent.count({ where: { workspaceId, NOT: { status: "ARCHIVED" } } }),
    db.subscription.findUnique({ where: { workspaceId }, include: { plan: true } }),
  ]);
  const max = sub?.plan.maxAgents ?? 2; // no subscription → starter-equivalent
  if (count >= max) {
    return `Your plan allows ${max} agent${max === 1 ? "" : "s"}. Archive one or upgrade in Billing.`;
  }
  return null;
}

// ---------- Helpers ----------

async function loadAgent(workspaceId: string, agentId: string) {
  return db.agent.findFirst({
    where: { id: agentId, workspaceId },
    include: { toolConfigs: { where: { enabled: true } } },
  });
}

function controlsOf(agent: { conversationConfig: unknown }): ConversationControls {
  const parsed = conversationConfigSchema.safeParse(agent.conversationConfig ?? {});
  return parsed.success ? parsed.data : conversationConfigSchema.parse({});
}

/** Build + validate the Dograh workflow JSON for an agent row (or version snapshot). */
function workflowFor(input: {
  name: string;
  greeting: string;
  systemPrompt: string;
  languageMode: string;
  fixedLanguage: string | null;
  voiceId: string;
  llmModel: string;
  maxCallSeconds: number;
  kbGuardrail: boolean;
  conversationConfig: unknown;
  tools: { tool: string; config: unknown }[];
  businessName: string;
}) {
  const fill = (t: string) => t.replaceAll("{{business_name}}", input.businessName);
  const def = buildAgentWorkflow({
    name: input.name,
    greeting: fill(input.greeting),
    systemPrompt: fill(input.systemPrompt),
    languageMode: input.languageMode as "auto" | "fixed" | "caller-select",
    fixedLanguage: input.fixedLanguage,
    voiceId: input.voiceId,
    llmModel: input.llmModel,
    llmFallbacks: llmFallbackChain(input.llmModel),
    maxCallSeconds: Math.min(1200, input.maxCallSeconds), // Dograh cap
    controls: controlsOf({ conversationConfig: input.conversationConfig }),
    kbGuardrail: input.kbGuardrail,
    tools: input.tools.map((t) => ({ tool: t.tool, config: (t.config ?? {}) as Record<string, unknown> })),
  });
  const check = validateWorkflowDefinition(def);
  if (!check.valid) throw new Error(`workflow invalid: ${check.errors.join("; ")}`);
  return def;
}

/** Push a workflow definition to Dograh: update existing workflow or create new. */
async function pushToDograh(
  existingId: string | null,
  name: string,
  definition: Record<string, unknown>,
  maxCallSeconds: number,
): Promise<{ id: string; uuid: string | null }> {
  if (existingId) {
    await dograhUpdateWorkflow(Number(existingId), {
      name,
      workflow_definition: definition,
      workflow_configurations: { max_call_duration: Math.min(1200, maxCallSeconds) },
    });
    await dograhPublishWorkflow(Number(existingId));
    const uuid = await db.agentVersion
      .findFirst({ where: { dograhWorkflowId: existingId }, select: { dograhWorkflowUuid: true } })
      .then((r) => r?.dograhWorkflowUuid ?? null);
    return { id: existingId, uuid };
  }
  const wf = await dograhCreateWorkflow(name, definition);
  await dograhPublishWorkflow(wf.id);
  return { id: String(wf.id), uuid: wf.workflow_uuid ?? null };
}

// ---------- CRUD ----------

export async function createAgentAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = agentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please check the form fields." };
    const quotaError = await assertAgentQuota(ctx.workspaceId);
    if (quotaError) return { ok: false, error: quotaError };

    const { kbGuardrail, conversationConfig, ...fields } = parsed.data;
    const agent = await db.agent.create({
      data: {
        ...fields,
        workspaceId: ctx.workspaceId,
        status: "DRAFT",
        conversationConfig: { ...conversationConfig, kbGuardrail },
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.create", entity: "Agent", entityId: agent.id,
      metadata: { name: agent.name },
    });
    revalidatePath("/agents");
    return { ok: true, id: agent.id };
  } catch (e) {
    return handleError(e);
  }
}

export async function createAgentFromTemplateAction(templateCode: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const t = getTemplate(templateCode);
    if (!t) return { ok: false, error: "Unknown template." };
    const quotaError = await assertAgentQuota(ctx.workspaceId);
    if (quotaError) return { ok: false, error: quotaError };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });

    const agent = await db.agent.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: `${t.name} — ${workspace.name}`,
        template: t.code,
        greeting: t.greeting,
        systemPrompt: t.systemPrompt,
        languageMode: "auto",
        voiceId: t.suggestedVoice,
        llmModel: t.suggestedLlm,
        status: "DRAFT",
        conversationConfig: { ...DEFAULT_CONTROLS, kbGuardrail: false },
      },
    });
    // Suggested tools from the template → enabled AgentToolConfig rows.
    if (t.suggestedTools.length > 0) {
      await db.agentToolConfig.createMany({
        data: t.suggestedTools.map((tool) => ({ agentId: agent.id, tool, enabled: true, config: {} })),
      });
    }
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.create_from_template", entity: "Agent", entityId: agent.id,
      metadata: { template: templateCode },
    });
    revalidatePath("/agents");
    return { ok: true, id: agent.id };
  } catch (e) {
    return handleError(e);
  }
}

export async function updateAgentAction(agentId: string, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = agentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please check the form fields." };

    const { kbGuardrail, conversationConfig, ...fields } = parsed.data;
    // Tenant scope: the WHERE includes workspaceId — an id from the URL is not enough.
    const updated = await db.agent.updateMany({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      data: {
        ...fields,
        conversationConfig: { ...conversationConfig, kbGuardrail },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return { ok: false, error: "Agent not found." };

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.update", entity: "Agent", entityId: agentId,
    });
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: agentId };
  } catch (e) {
    return handleError(e);
  }
}

export async function cloneAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const quotaError = await assertAgentQuota(ctx.workspaceId);
    if (quotaError) return { ok: false, error: quotaError };
    const agent = await loadAgent(ctx.workspaceId, agentId);
    if (!agent) return { ok: false, error: "Agent not found." };
    // never clone Dograh linkage — the copy publishes its own workflow later
    const { id, dograhWorkflowId, dograhWorkflowUuid, createdAt, updatedAt, toolConfigs, ...rest } = agent;
    const copy = await db.agent.create({
      data: { ...rest, name: `${agent.name} (copy)`, status: "DRAFT", version: 1 },
    });
    if (toolConfigs.length > 0) {
      await db.agentToolConfig.createMany({
        data: toolConfigs.map((t) => ({ agentId: copy.id, tool: t.tool, enabled: t.enabled, config: t.config ?? {} })),
      });
    }
    revalidatePath("/agents");
    return { ok: true, id: copy.id };
  } catch (e) {
    return handleError(e);
  }
}

export async function archiveAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:delete");
    const updated = await db.agent.updateMany({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      data: { status: "ARCHIVED" },
    });
    if (updated.count === 0) return { ok: false, error: "Agent not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.archive", entity: "Agent", entityId: agentId,
    });
    revalidatePath("/agents");
    return { ok: true };
  } catch (e) {
    return handleError(e);
  }
}

// ---------- Version control: publish / rollback / A/B ----------

/**
 * Publish the CURRENT draft: freeze a new AgentVersion snapshot, push its workflow
 * to Dograh, mark the version PUBLISHED, mirror ids onto the Agent row.
 */
export async function publishAgentAction(agentId: string, label?: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const agent = await loadAgent(ctx.workspaceId, agentId);
    if (!agent) return { ok: false, error: "Agent not found." };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    const kbGuardrail =
      (agent.conversationConfig as { kbGuardrail?: boolean } | null)?.kbGuardrail === true;

    const definition = workflowFor({
      ...agent,
      kbGuardrail,
      tools: agent.toolConfigs,
      businessName: workspace.name,
    });

    const versions = await db.agentVersion.findMany({
      where: { agentId: agent.id, workspaceId: ctx.workspaceId },
      select: { version: true },
    });
    const snapshot = snapshotAgent(agent);

    // A/B safety: publishing a new main version removes any stale A/B variant.
    await db.agentVersion.updateMany({
      where: { agentId: agent.id, workspaceId: ctx.workspaceId, isAbVariant: true, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    });

    const pushed = await pushToDograh(null, agent.name, definition as Record<string, unknown>, agent.maxCallSeconds);

    const version = await db.agentVersion.create({
      data: {
        agentId: agent.id,
        workspaceId: ctx.workspaceId,
        version: nextVersionNumber(versions),
        status: "PUBLISHED",
        label: label ?? null,
        systemPrompt: snapshot.systemPrompt,
        greeting: snapshot.greeting,
        config: { ...snapshot.config, kbGuardrail },
        dograhWorkflowId: pushed.id,
        dograhWorkflowUuid: pushed.uuid,
        publishedAt: new Date(),
        createdByUserId: ctx.user.id,
      },
    });

    await db.agent.update({
      where: { id: agent.id },
      data: { status: "PUBLISHED", dograhWorkflowId: pushed.id, dograhWorkflowUuid: pushed.uuid },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.publish", entity: "Agent", entityId: agent.id,
      metadata: { version: version.version, dograhWorkflowId: pushed.id },
    });
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: version.id };
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Rollback (one click): re-publish an OLDER version — its stored snapshot is pushed
 * back to Dograh (reusing its Dograh workflow id), the version flips to PUBLISHED,
 * and the Agent's editable fields are overwritten with the snapshot so the UI shows
 * exactly what is live.
 */
export async function rollbackAgentAction(agentId: string, versionId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const version = await db.agentVersion.findFirst({
      where: { id: versionId, agentId, workspaceId: ctx.workspaceId },
    });
    if (!version) return { ok: false, error: "Version not found." };
    if (version.isAbVariant) return { ok: false, error: "Cannot roll back to an A/B variant." };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    const cfg = (version.config ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(cfg.tools) ? (cfg.tools as { tool: string; config: unknown }[]) : [];

    const definition = workflowFor({
      name: `rollback-v${version.version}`,
      greeting: version.greeting,
      systemPrompt: version.systemPrompt,
      languageMode: String(cfg.languageMode ?? "auto"),
      fixedLanguage: (cfg.fixedLanguage as string | null) ?? null,
      voiceId: String(cfg.voiceId ?? "anushka"),
      llmModel: String(cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct"),
      maxCallSeconds: Number(cfg.maxCallSeconds ?? 600),
      kbGuardrail: cfg.kbGuardrail === true,
      conversationConfig: cfg.conversationConfig ?? {},
      tools,
      businessName: workspace.name,
    });

    const pushed = await pushToDograh(
      version.dograhWorkflowId,
      `rollback-v${version.version}`,
      definition as Record<string, unknown>,
      Number(cfg.maxCallSeconds ?? 600),
    );
    const uuid = pushed.uuid ?? version.dograhWorkflowUuid;

    await db.$transaction([
      db.agentVersion.updateMany({
        where: { agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      }),
      db.agentVersion.update({
        where: { id: version.id },
        data: { status: "PUBLISHED", publishedAt: new Date(), dograhWorkflowId: pushed.id, dograhWorkflowUuid: uuid },
      }),
      db.agent.update({
        where: { id: agentId },
        data: {
          status: "PUBLISHED",
          dograhWorkflowId: pushed.id,
          dograhWorkflowUuid: uuid,
          systemPrompt: version.systemPrompt,
          greeting: version.greeting,
          voiceId: String(cfg.voiceId ?? "anushka"),
          llmModel: String(cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct"),
          languageMode: String(cfg.languageMode ?? "auto"),
          fixedLanguage: (cfg.fixedLanguage as string | null) ?? null,
          maxCallSeconds: Number(cfg.maxCallSeconds ?? 600),
        },
      }),
    ]);
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.rollback", entity: "Agent", entityId: agentId,
      metadata: { toVersion: version.version, dograhWorkflowId: pushed.id },
    });
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: version.id };
  } catch (e) {
    return handleError(e);
  }
}

/** Create an A/B variant from a published version with a traffic split (1–99%). */
export async function createAbVariantAction(
  agentId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = z
      .object({
        fromVersionId: z.string().min(1),
        abTrafficPercent: z.coerce.number().int(),
        label: z.string().max(80).optional(),
        systemPrompt: z.string().min(20).max(8000).optional(),
        greeting: z.string().min(5).max(500).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the A/B form fields." };

    const existing = await db.agentVersion.findMany({
      where: { agentId, workspaceId: ctx.workspaceId, isAbVariant: true, status: "PUBLISHED" },
      select: { id: true },
    });
    const split = validateAbSplit({ existingAbVariants: existing, trafficPercent: parsed.data.abTrafficPercent });
    if (!split.ok) return { ok: false, error: split.error };

    const source = await db.agentVersion.findFirst({
      where: { id: parsed.data.fromVersionId, agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
    });
    if (!source) return { ok: false, error: "Source version not found or not published." };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    const cfg = (source.config ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(cfg.tools) ? (cfg.tools as { tool: string; config: unknown }[]) : [];

    const systemPrompt = parsed.data.systemPrompt ?? source.systemPrompt;
    const greeting = parsed.data.greeting ?? source.greeting;
    const definition = workflowFor({
      name: `ab-variant`,
      greeting, systemPrompt,
      languageMode: String(cfg.languageMode ?? "auto"),
      fixedLanguage: (cfg.fixedLanguage as string | null) ?? null,
      voiceId: String(cfg.voiceId ?? "anushka"),
      llmModel: String(cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct"),
      maxCallSeconds: Number(cfg.maxCallSeconds ?? 600),
      kbGuardrail: cfg.kbGuardrail === true,
      conversationConfig: cfg.conversationConfig ?? {},
      tools,
      businessName: workspace.name,
    });
    const pushed = await pushToDograh(null, "ab-variant", definition as Record<string, unknown>, Number(cfg.maxCallSeconds ?? 600));

    const versions = await db.agentVersion.findMany({
      where: { agentId, workspaceId: ctx.workspaceId }, select: { version: true },
    });
    const variant = await db.agentVersion.create({
      data: {
        agentId,
        workspaceId: ctx.workspaceId,
        version: nextVersionNumber(versions),
        status: "PUBLISHED",
        label: parsed.data.label ?? `A/B variant (${parsed.data.abTrafficPercent}% traffic)`,
        systemPrompt,
        greeting,
        config: { ...cfg },
        dograhWorkflowId: pushed.id,
        dograhWorkflowUuid: pushed.uuid,
        isAbVariant: true,
        abTrafficPercent: parsed.data.abTrafficPercent,
        publishedAt: new Date(),
        createdByUserId: ctx.user.id,
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.ab_variant", entity: "Agent", entityId: agentId,
      metadata: { variantVersion: variant.version, pct: parsed.data.abTrafficPercent },
    });
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: variant.id };
  } catch (e) {
    return handleError(e);
  }
}

/** End the A/B test: archive the variant; the main version serves 100% again. */
export async function removeAbVariantAction(agentId: string, variantId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const updated = await db.agentVersion.updateMany({
      where: { id: variantId, agentId, workspaceId: ctx.workspaceId, isAbVariant: true },
      data: { status: "ARCHIVED" },
    });
    if (updated.count === 0) return { ok: false, error: "Variant not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.ab_variant_end", entity: "Agent", entityId: agentId,
      metadata: { variantId },
    });
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (e) {
    return handleError(e);
  }
}

// ---------- Test-in-browser (readme §4.1) ----------

/**
 * "Test call" button: create a Dograh test run (no real phone call) and return the
 * Dograh web-UI URL where the operator talks to the agent via the web-call/WebRTC
 * widget. The agent must be published first (needs a Dograh workflow id).
 */
export async function createTestRunAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:read");
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
    });
    if (!agent) return { ok: false, error: "Agent not found." };
    if (!agent.dograhWorkflowId) {
      return { ok: false, error: "Publish the agent first — test calls run against the Dograh workflow." };
    }
    await dograhCreateTestRun(Number(agent.dograhWorkflowId));
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.test_run", entity: "Agent", entityId: agentId,
    });
    return { ok: true, id: agent.id, url: dograhWorkflowUiUrl(agent.dograhWorkflowId) };
  } catch (e) {
    return handleError(e);
  }
}

/** Deep link for the "Open advanced flow editor" button. */
export async function advancedEditorUrlAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:read");
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      select: { dograhWorkflowId: true },
    });
    if (!agent) return { ok: false, error: "Agent not found." };
    if (!agent.dograhWorkflowId) return { ok: false, error: "Publish the agent first." };
    return { ok: true, url: dograhWorkflowUiUrl(agent.dograhWorkflowId) };
  } catch (e) {
    return handleError(e);
  }
}

// ---------- Errors ----------

function handleError(e: unknown): ActionResult {
  if (e instanceof DograhError) {
    console.error(e);
    return { ok: false, error: "Voice engine error. Check Dograh is running (guide 04)." };
  }
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false, error: "You need a higher role for this (see the permission matrix)." };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** both exit 0.
**If it fails:** the compiler names the file/line — fix against the listing above
(common: a missed import or an unclosed template string); once more, then STOP and report.

---

## Step 8: Test-in-browser — OPERATOR GATE

The "Test call" button (Step 19 wires it into the editor header) works like this:

1. `createTestRunAction` calls Dograh's **Create Test Run** API (executes the workflow
   without a phone call) and returns the Dograh web-UI URL for that workflow.
2. The operator's browser opens the Dograh UI, where Dograh's **web call** widget
   (WebRTC — see `dograh_api_docs.txt`: "Your First Agent in 5 Minutes… using Web
   Calls — no telephony setup required") lets you talk to the agent live.

> **OPERATOR GATE — verify once with the Dograh UI:** (a) open `DOGRAH_UI_URL`,
> (b) open the workflow Vaani published, (c) confirm a "Talk"/"Web call"/"Test"
> button exists and works from your browser (mic permission). If the test-run API
> path 404s or the UI route differs, adjust `PATHS.createTestRun` /
> `dograhWorkflowUiUrl()` per Step 5 and report. No telephony, no cost.

**Verify (Hermes, after an agent is published in Step 14's browser test):**
```bash
source /root/vaani-ai/.env
WF_ID=$(docker exec vaani-db psql -U vaani -d vaani -t -A -c \
 'SELECT "dograhWorkflowId" FROM "Agent" WHERE "workspaceId"=(SELECT id FROM "Workspace" WHERE slug='"'"'demo-clinic'"'"') AND "dograhWorkflowId" IS NOT NULL LIMIT 1;')
echo "workflow id: $WF_ID"
[ -n "$WF_ID" ] && curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "X-API-Key: $DOGRAH_API_KEY" -H "Content-Type: application/json" \
  "$DOGRAH_BASE_URL/api/v1/workflow/$WF_ID/runs" -d '{}'
```
**Expected:** a workflow id printed, then `200` or `201`. `404` → OPERATOR GATE
above (path differs on this Dograh version). No published agent yet → skip and
return after the Step 14 browser test.

---

## Step 9: Support libraries — MinIO storage (KB bucket), Vobiz messaging, calendar, payments

> **COORDINATION NOTE (storage.ts):** this guide CREATES `src/lib/storage.ts`.
> Guide 08 does NOT recreate it — guide 08 APPENDS recording helpers to THIS file
> (`RECORDINGS_BUCKET`, `ensureBucket`, `recordingUrl`, `ingestRecording` are already
> present here, unchanged in behavior).

**File `src/lib/storage.ts`** (full content):

```ts
import * as Minio from "minio";

const ENDPOINT = new URL(process.env.S3_ENDPOINT ?? "http://localhost:9000");

export const s3 = new Minio.Client({
  endPoint: ENDPOINT.hostname,
  port: Number(ENDPOINT.port || 9000),
  useSSL: ENDPOINT.protocol === "https:",
  accessKey: process.env.S3_ACCESS_KEY ?? "",
  secretKey: process.env.S3_SECRET_KEY ?? "",
});

export const RECORDINGS_BUCKET = process.env.S3_BUCKET_RECORDINGS ?? "vaani-recordings";
export const KB_BUCKET = process.env.S3_BUCKET_KB ?? "vaani-knowledge";

const bootstrapped = new Set<string>();
export async function ensureBucket(bucket: string = RECORDINGS_BUCKET) {
  if (bootstrapped.has(bucket)) return;
  const exists = await s3.bucketExists(bucket).catch(() => false);
  if (!exists) await s3.makeBucket(bucket);
  bootstrapped.add(bucket);
}

/** Upload a buffer to any bucket; returns the storage key used. */
export async function putObject(
  bucket: string,
  key: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  await ensureBucket(bucket);
  await s3.putObject(bucket, key, buf, buf.length, { "Content-Type": contentType });
  return key;
}

/** Presigned GET URL, valid 15 minutes. */
export async function recordingUrl(key: string): Promise<string> {
  await ensureBucket();
  return s3.presignedGetObject(RECORDINGS_BUCKET, key, 15 * 60);
}

/** Presigned GET for a knowledge-base file (admin preview). */
export async function kbFileUrl(key: string): Promise<string> {
  await ensureBucket(KB_BUCKET);
  return s3.presignedGetObject(KB_BUCKET, key, 15 * 60);
}

/** Download a remote recording (from Dograh/Vobiz URL) and store it in MinIO. */
export async function ingestRecording(sourceUrl: string, key: string): Promise<void> {
  await ensureBucket();
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) throw new Error(`recording fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await s3.putObject(RECORDINGS_BUCKET, key, buf, buf.length, {
    "Content-Type": res.headers.get("content-type") ?? "audio/wav",
  });
}
```

**Edit `src/lib/vobiz.ts` — APPEND one function (do NOT rewrite the file).**
Guard: `src/lib/vobiz.ts` MUST already exist from guide 04 Step 16 (it owns the Vobiz
client: `VobizError`, `sendWhatsAppTemplate({to, templateName, languageCode?, components?})`).
If it does not exist, STOP and report — guide 04 is not complete. Verify first:

```bash
grep -c "sendWhatsAppTemplate\|VobizError" src/lib/vobiz.ts   # expect ≥ 2
```

**Do:** append the following EXACT block at the END of `src/lib/vobiz.ts`
(anchor: after the closing `}` of `sendWhatsAppTemplate`, which is the last function
in the file). It follows guide 04's style: env-configurable path, Basic auth,
E.164 validation, `{providerMessageId, raw}` result. DRY-RUN simulation lives in the
tool executor (Step 12), NOT in this library — this client always tells the truth.

```ts

// ---------- Guide 05 addition: transactional SMS ----------

export type SmsInput = {
  /** Recipient, E.164, e.g. "+919812345678". */
  to: string;
  /** SMS body (truncated to 900 chars). */
  message: string;
  /** Override sender id; default VOBIZ_SMS_SENDER env. */
  senderId?: string;
};

export type SmsSendResult = {
  providerMessageId: string | null;
  raw: unknown;
};

/**
 * Send a transactional SMS via Vobiz (readme §4.4 send_sms agent tool).
 * OPERATOR GATE: VOBIZ_SMS_PATH defaults to "/v1/sms/messages". Confirm the exact
 * path/payload from https://vobiz.ai/docs before the first LIVE send; adjust ONLY
 * VOBIZ_SMS_PATH / VOBIZ_API_BASE in .env if Vobiz documents a different path.
 */
export async function sendSms(input: SmsInput): Promise<SmsSendResult> {
  const base = (process.env.VOBIZ_API_BASE ?? "https://api.vobiz.ai").replace(/\/$/, "");
  const path = process.env.VOBIZ_SMS_PATH ?? "/v1/sms/messages";
  const authId = process.env.VOBIZ_AUTH_ID ?? "";
  const authToken = process.env.VOBIZ_AUTH_TOKEN ?? "";
  const sender = input.senderId ?? process.env.VOBIZ_SMS_SENDER ?? "";
  if (!authId || !authToken) throw new VobizError(0, "VOBIZ_AUTH_ID/VOBIZ_AUTH_TOKEN not set");
  if (!sender) throw new VobizError(0, "VOBIZ_SMS_SENDER not set");
  if (!/^\+[1-9]\d{6,14}$/.test(input.to)) throw new VobizError(0, `bad recipient: ${input.to}`);

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`,
    },
    body: JSON.stringify({ from: sender, to: input.to, type: "sms", text: input.message.slice(0, 900) }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new VobizError(res.status, text.slice(0, 500));
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  const r = raw as { message_id?: string; id?: string } | null;
  return { providerMessageId: r?.message_id ?? r?.id ?? null, raw };
}
```

**File `src/lib/vobiz.sms.test.ts`** (NEW — guide 04 owns `src/lib/vobiz.test.ts`;
do not touch it. This file tests ONLY the appended `sendSms`):

```ts
import { describe, it, expect, afterEach, vi } from "vitest";

async function load() {
  vi.resetModules();
  process.env.VOBIZ_API_BASE = "https://vobiz.test";
  process.env.VOBIZ_SMS_PATH = "/v1/sms/messages";
  process.env.VOBIZ_AUTH_ID = "aid";
  process.env.VOBIZ_AUTH_TOKEN = "atok";
  process.env.VOBIZ_SMS_SENDER = "VAANIAI";
  return await import("./vobiz");
}

function fakeResponse(status: number, json: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => (typeof json === "string" ? json : JSON.stringify(json)),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("sendSms (guide 05)", () => {
  it("sends the SMS shape with Basic auth and returns providerMessageId", async () => {
    const { sendSms } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { message_id: "sms.123" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendSms({ to: "+919812345678", message: "Your booking is confirmed" });
    expect(res.providerMessageId).toBe("sms.123");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://vobiz.test/v1/sms/messages");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("aid:atok").toString("base64")}`);
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("VAANIAI");
    expect(body.to).toBe("+919812345678");
    expect(body.text).toBe("Your booking is confirmed");
  });

  it("401 → throws VobizError with status", async () => {
    const { sendSms, VobizError } = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(401, "unauthorized")));
    await expect(sendSms({ to: "+919812345678", message: "x" })).rejects.toBeInstanceOf(VobizError);
  });

  it("missing sender config → throws before any fetch", async () => {
    vi.resetModules();
    process.env.VOBIZ_AUTH_ID = "aid";
    process.env.VOBIZ_AUTH_TOKEN = "atok";
    delete process.env.VOBIZ_SMS_SENDER;
    const { sendSms } = await import("./vobiz");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSms({ to: "+919812345678", message: "x" })).rejects.toThrow(/VOBIZ_SMS_SENDER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed recipient numbers before sending", async () => {
    const { sendSms } = await load();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSms({ to: "9812345678", message: "x" })).rejects.toThrow(/bad recipient/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

**File `src/lib/calendar.ts`** (Google Calendar full; other providers gated stubs):

```ts
/**
 * Calendar availability + booking for the CALENDAR_BOOKING agent tool.
 * Google Calendar: full implementation via googleapis (OAuth tokens live in
 * CalendarConnection — connect flow in Step 20).
 * MICROSOFT / CALENDLY / CALCOM: config-driven stubs — OPERATOR GATE (below).
 */
import { google, calendar_v3 } from "googleapis";
import type { CalendarConnection } from "@prisma/client";

function oauthClient(): InstanceType<typeof google.auth.OAuth2> {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/calendar/google/callback`,
  );
}

/** URL the "Connect Google Calendar" button redirects to. */
export function googleCalendarAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
    state,
  });
}

/** Exchange an OAuth code for tokens (callback route). */
export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}> {
  const { tokens } = await oauthClient().getToken(code);
  if (!tokens.access_token) throw new Error("no access_token from Google");
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
}

async function googleCalendar(conn: CalendarConnection): Promise<calendar_v3.Calendar> {
  const auth = oauthClient();
  auth.setCredentials({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken ?? undefined,
    expiry_date: conn.tokenExpiresAt?.getTime(),
  });
  return google.calendar({ version: "v3", auth });
}

export type Slot = { start: string; end: string }; // ISO

/** Free 30-minute slots within the next `days` days, business hours 09:00–19:00 local. */
export async function getAvailability(
  conn: CalendarConnection,
  opts: { days?: number; slotMinutes?: number } = {},
): Promise<Slot[]> {
  if (conn.provider !== "GOOGLE") return providerStub(conn.provider, "getAvailability");
  const cal = await googleCalendar(conn);
  const days = opts.days ?? 7;
  const slotMinutes = opts.slotMinutes ?? 30;
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const fb = await cal.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: conn.primaryCalendarId ?? "primary" }],
    },
  });
  const busy = (fb.data.calendars?.[conn.primaryCalendarId ?? "primary"]?.busy ?? [])
    .map((b) => ({ start: new Date(b.start ?? ""), end: new Date(b.end ?? "") }))
    .filter((b) => !isNaN(b.start.getTime()));

  const slots: Slot[] = [];
  for (let t = new Date(now); t < end && slots.length < 20; t = new Date(t.getTime() + slotMinutes * 60000)) {
    const h = t.getHours();
    if (h < 9 || h >= 19) continue; // business hours
    const sEnd = new Date(t.getTime() + slotMinutes * 60000);
    const clash = busy.some((b) => t < b.end && sEnd > b.start);
    if (!clash && t > now) slots.push({ start: t.toISOString(), end: sEnd.toISOString() });
  }
  return slots;
}

/** Create a calendar event (the actual booking). Returns the event id + link. */
export async function bookSlot(
  conn: CalendarConnection,
  input: { startIso: string; endIso: string; summary: string; attendeeName?: string; attendeePhone?: string; description?: string },
): Promise<{ eventId: string; htmlLink: string | null }> {
  if (conn.provider !== "GOOGLE") return providerStub(conn.provider, "bookSlot");
  const cal = await googleCalendar(conn);
  const evt = await cal.events.insert({
    calendarId: conn.primaryCalendarId ?? "primary",
    requestBody: {
      summary: input.summary,
      description: [input.description, input.attendeeName ? `Name: ${input.attendeeName}` : null, input.attendeePhone ? `Phone: ${input.attendeePhone}` : null]
        .filter(Boolean)
        .join("\n"),
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
    },
  });
  return { eventId: evt.data.id ?? "", htmlLink: evt.data.htmlLink ?? null };
}

/** OPERATOR GATE — MICROSOFT / CALENDLY / CALCOM.
 *  These providers follow the same CalendarConnection token storage; the OAuth +
 *  API calls are provider-specific. v1 ships config-driven stubs that fail loudly
 *  and clearly. To enable one: implement its calls here (same Slot/bookSlot shapes),
 *  verify against the provider's sandbox, and remove it from this list. */
function providerStub(provider: string, fn: string): never {
  throw new Error(
    `Calendar provider ${provider} is not enabled in v1 (${fn}). OPERATOR GATE: implement ${fn} for ${provider} in src/lib/calendar.ts — the connection row, UI and tool wiring already exist.`,
  );
}
```

**File `src/lib/payments.ts`** (Razorpay payment links — `razorpay@2.9.4` already installed since guide 01):

```ts
/**
 * Payment collection for the PAYMENT_LINK agent tool (readme §4.4):
 * create a Razorpay payment link, read out / send it, confirm status.
 * VAANI_DRY_RUN=true (default) simulates link creation — no real links, no money.
 */
import Razorpay from "razorpay";

const DRY_RUN = () => process.env.VAANI_DRY_RUN !== "false";

function rz(): Razorpay {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID ?? "",
    key_secret: process.env.RAZORPAY_KEY_SECRET ?? "",
  });
}

export type PaymentLinkResult = {
  id: string;
  shortUrl: string;
  status: string;
  simulated?: boolean;
};

/** Create a payment link for integer paise (money rule: never floats). */
export async function createPaymentLink(input: {
  amountPaise: number;
  description: string;
  customerPhone?: string;
  referenceId?: string;
}): Promise<PaymentLinkResult> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
    throw new Error("amountPaise must be an integer >= 100 (₹1)");
  }
  if (DRY_RUN()) {
    return {
      id: `plink_dry_${Date.now()}`,
      shortUrl: "https://rzp.io/l/dry-run-simulated",
      status: "created",
      simulated: true,
    };
  }
  const link = await rz().paymentLink.create({
    amount: input.amountPaise,
    currency: "INR",
    description: input.description.slice(0, 200),
    reference_id: input.referenceId,
    customer: input.customerPhone ? { contact: input.customerPhone } : undefined,
    notify: { sms: false, email: false }, // we send the link ourselves via SMS/WhatsApp tool
  });
  return { id: link.id, shortUrl: String(link.short_url), status: String(link.status) };
}

/** Confirm payment status (the "confirm payment status" part of the flow). */
export async function getPaymentLinkStatus(paymentLinkId: string): Promise<string> {
  if (DRY_RUN() || paymentLinkId.startsWith("plink_dry_")) return "created";
  const link = await rz().paymentLink.fetch(paymentLinkId);
  return String(link.status); // created | partially_paid | paid | expired | cancelled
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx vitest run src/lib/vobiz.test.ts src/lib/vobiz.sms.test.ts && npx tsx -e "
import('tsx/cjs').then(async () => {
  const { createPaymentLink } = await import('./src/lib/payments');
  const p = await createPaymentLink({ amountPaise: 150000, description: 'EMI June' });
  console.log('plink:', p.id.startsWith('plink_dry_'), p.status, p.simulated===true);
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** typecheck exit 0; BOTH vobiz suites pass (4+4 tests — guide 04's
WhatsApp suite must still pass untouched); then `plink: true created true`.
**If it fails:** `sendSms` missing → the append above was skipped/misplaced; re-do it
once. `VAANI_DRY_RUN` error → Step 0 env block. Otherwise the error names the line —
fix once, then STOP and report.

---

## Step 10: Knowledge Base — document library + server actions (readme §4.3)

Flow: upload PDF/DOCX, paste FAQ text, or add a URL → file to MinIO (uploads only) +
`KnowledgeDocument` row → Dograh KB sync. Scoping: `agentId` set = that agent only;
`agentId` null = shared across all agents in the workspace.

> **OPERATOR GATE (Dograh knowledge-base sync):** the Dograh API reference
> (`dograh_api_docs.txt`) exposes NO knowledge-base REST endpoints — KB upload is a
> Dograh UI feature ("Knowledge Base" page). So: our DB + MinIO + UI + status +
> re-index pipeline is fully built here; the operator performs a ONE-TIME MANUAL
> SYNC per document: open the agent's workflow in the Dograh UI (Step 5 deep link) →
> Knowledge Base → upload the same file / paste the same text → then click
> **"Mark indexed"** in our UI (action below). If a future Dograh version adds a KB
> API, implement `pushToDograhKnowledgeBase()` in `src/lib/knowledge.ts` (stub
> provided) and remove the gate.

**File `src/lib/knowledge.ts`:**

```ts
import mime from "mime-types";

export const KB_ACCEPT = [".pdf", ".docx"];
export const KB_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** MinIO key for an uploaded KB file. */
export function kbStorageKey(workspaceId: string, docId: string, filename: string): string {
  const safe = filename.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
  return `${workspaceId}/${docId}/${safe}`;
}

export function kbContentType(filename: string): string {
  return mime.lookup(filename) || "application/octet-stream";
}

export function validateKbUpload(filename: string, sizeBytes: number): { ok: true } | { ok: false; error: string } {
  const lower = filename.toLowerCase();
  if (!KB_ACCEPT.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: `Only ${KB_ACCEPT.join(" and ")} files are supported (FAQ text and URLs use their own forms).` };
  }
  if (sizeBytes > KB_MAX_BYTES) return { ok: false, error: "File too large (max 10 MB)." };
  if (sizeBytes === 0) return { ok: false, error: "Empty file." };
  return { ok: true };
}

/** Naive HTML → text for URL documents (good enough for FAQ/pricing pages). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50000);
}

/** Fetch + extract text from a URL document. Throws on network errors. */
export async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`URL fetch failed: HTTP ${res.status}`);
  const text = htmlToText(await res.text());
  if (text.length < 20) throw new Error("Page had no usable text content.");
  return text;
}

/**
 * OPERATOR GATE — see Step 10 note. When Dograh ships a KB API, implement the push
 * here and flip status to INDEXED on success; the re-index worker (Step 11) already
 * calls this.
 */
export async function pushToDograhKnowledgeBase(_doc: {
  id: string;
  title: string;
  type: string;
  contentText: string | null;
  storageKey: string | null;
}): Promise<{ pushed: false; reason: string }> {
  return { pushed: false, reason: "Dograh KB API not available — manual sync via Dograh UI (OPERATOR GATE, guide 05 Step 10)." };
}
```

**File `src/server/actions/knowledge.ts`:**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { putObject, KB_BUCKET } from "@/lib/storage";
import {
  kbStorageKey,
  kbContentType,
  validateKbUpload,
  fetchUrlText,
} from "@/lib/knowledge";

export type KbResult = { ok: boolean; error?: string; id?: string };

/** agentId null/undefined = workspace-shared document (all agents). */
async function assertAgentOwnership(workspaceId: string, agentId?: string | null) {
  if (!agentId) return;
  const a = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
  if (!a) throw new Error("Agent not found.");
}

/** Upload a PDF/DOCX (FormData: file, title, agentId?). */
export async function uploadKbDocumentAction(formData: FormData): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const file = formData.get("file");
    const title = String(formData.get("title") ?? "").trim();
    const agentId = String(formData.get("agentId") ?? "") || null;
    if (!(file instanceof File)) return { ok: false, error: "No file uploaded." };
    if (title.length < 2) return { ok: false, error: "Give the document a title." };
    const check = validateKbUpload(file.name, file.size);
    if (!check.ok) return { ok: false, error: check.error };
    await assertAgentOwnership(ctx.workspaceId, agentId);

    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: ctx.workspaceId,
        agentId,
        type: file.name.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF",
        title,
        status: "PENDING",
      },
    });
    const buf = Buffer.from(await file.arrayBuffer());
    const key = kbStorageKey(ctx.workspaceId, doc.id, file.name);
    await putObject(KB_BUCKET, key, buf, kbContentType(file.name));

    // PDF/DOCX text extraction runs inside Dograh's KB (operator sync) — we store
    // the binary and leave contentText null.
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { storageKey: key } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.upload", entity: "KnowledgeDocument", entityId: doc.id,
      metadata: { title, type: doc.type },
    });
    revalidatePath(agentId ? `/agents/${agentId}` : "/knowledge");
    return { ok: true, id: doc.id };
  } catch (e) {
    return handleKbError(e);
  }
}

/** Paste FAQ / policy text directly. */
export async function addFaqDocumentAction(input: unknown): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const parsed = z
      .object({
        title: z.string().min(2).max(120),
        contentText: z.string().min(10).max(50000),
        agentId: z.string().optional(),
        reindexIntervalHours: z.coerce.number().int().min(1).max(720).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the FAQ form fields." };
    await assertAgentOwnership(ctx.workspaceId, parsed.data.agentId ?? null);

    const hours = parsed.data.reindexIntervalHours ?? null;
    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: ctx.workspaceId,
        agentId: parsed.data.agentId ?? null,
        type: "FAQ",
        title: parsed.data.title,
        contentText: parsed.data.contentText,
        status: "INDEXED", // text lives in our DB; operator syncs to Dograh KB UI
        lastIndexedAt: new Date(),
        reindexIntervalHours: hours,
        nextReindexAt: hours ? new Date(Date.now() + hours * 3600 * 1000) : null,
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.add_faq", entity: "KnowledgeDocument", entityId: doc.id,
    });
    revalidatePath(parsed.data.agentId ? `/agents/${parsed.data.agentId}` : "/knowledge");
    return { ok: true, id: doc.id };
  } catch (e) {
    return handleKbError(e);
  }
}

/** Add a URL document — we fetch and store the text now; re-index on schedule. */
export async function addUrlDocumentAction(input: unknown): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const parsed = z
      .object({
        title: z.string().min(2).max(120),
        sourceUrl: z.string().url().max(1000),
        agentId: z.string().optional(),
        reindexIntervalHours: z.coerce.number().int().min(1).max(720).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the URL form fields." };
    await assertAgentOwnership(ctx.workspaceId, parsed.data.agentId ?? null);

    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: ctx.workspaceId,
        agentId: parsed.data.agentId ?? null,
        type: "URL",
        title: parsed.data.title,
        sourceUrl: parsed.data.sourceUrl,
        status: "INDEXING",
      },
    });
    try {
      const text = await fetchUrlText(parsed.data.sourceUrl);
      const hours = parsed.data.reindexIntervalHours ?? 24; // URLs default to daily re-index
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          contentText: text,
          status: "INDEXED",
          lastIndexedAt: new Date(),
          error: null,
          reindexIntervalHours: hours,
          nextReindexAt: new Date(Date.now() + hours * 3600 * 1000),
        },
      });
    } catch (err) {
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : "fetch failed" },
      });
      return { ok: false, error: "Could not fetch that URL. It was saved as FAILED — check it and re-index." };
    }
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.add_url", entity: "KnowledgeDocument", entityId: doc.id,
      metadata: { sourceUrl: parsed.data.sourceUrl },
    });
    revalidatePath(parsed.data.agentId ? `/agents/${parsed.data.agentId}` : "/knowledge");
    return { ok: true, id: doc.id };
  } catch (e) {
    return handleKbError(e);
  }
}

/** Re-fetch a URL document now (also used by the scheduler). */
export async function reindexDocumentAction(docId: string): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const doc = await db.knowledgeDocument.findFirst({
      where: { id: docId, workspaceId: ctx.workspaceId },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.type !== "URL" || !doc.sourceUrl) {
      return { ok: false, error: "Only URL documents re-fetch; PDF/DOCX/FAQ are synced via the Dograh UI." };
    }
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "INDEXING" } });
    try {
      const text = await fetchUrlText(doc.sourceUrl);
      const hours = doc.reindexIntervalHours;
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          contentText: text,
          status: "INDEXED",
          lastIndexedAt: new Date(),
          error: null,
          nextReindexAt: hours ? new Date(Date.now() + hours * 3600 * 1000) : null,
        },
      });
      return { ok: true, id: doc.id };
    } catch (err) {
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : "fetch failed" },
      });
      return { ok: false, error: "Re-index failed (see document error)." };
    }
  } catch (e) {
    return handleKbError(e);
  }
}

/** Operator confirms the Dograh-UI KB sync is done (OPERATOR GATE, Step 10). */
export async function markDocIndexedAction(docId: string): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const updated = await db.knowledgeDocument.updateMany({
      where: { id: docId, workspaceId: ctx.workspaceId },
      data: { status: "INDEXED", lastIndexedAt: new Date(), error: null },
    });
    if (updated.count === 0) return { ok: false, error: "Document not found." };
    revalidatePath("/knowledge");
    return { ok: true, id: docId };
  } catch (e) {
    return handleKbError(e);
  }
}

export async function deleteKbDocumentAction(docId: string): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const deleted = await db.knowledgeDocument.deleteMany({
      where: { id: docId, workspaceId: ctx.workspaceId },
    });
    if (deleted.count === 0) return { ok: false, error: "Document not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.delete", entity: "KnowledgeDocument", entityId: docId,
    });
    revalidatePath("/knowledge");
    revalidatePath("/agents");
    return { ok: true };
  } catch (e) {
    return handleKbError(e);
  }
}

function handleKbError(e: unknown): KbResult {
  if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "Agent not found.")) {
    return { ok: false, error: e.message === "FORBIDDEN" ? "You need the knowledge:write permission for this (Admin or Owner)." : e.message };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.

---

## Step 11: KB re-index scheduler (node-cron worker)

URL documents with `reindexIntervalHours` set are re-fetched when `nextReindexAt`
passes. (Dograh-side KB refresh remains the OPERATOR GATE from Step 10;
`pushToDograhKnowledgeBase` is the single hook to implement later.)

**File `src/worker/kb-reindex.ts`:**

```ts
/**
 * KB re-index worker. Run: npm run worker:kb
 * Every 15 minutes: re-fetch due URL documents, bump their schedule.
 * Idempotent and safe to run alongside the campaign worker.
 */
import cron from "node-cron";
import { db } from "../lib/db";
import { fetchUrlText, pushToDograhKnowledgeBase } from "../lib/knowledge";

const TICK = "*/15 * * * *";

export async function reindexDue(): Promise<number> {
  const due = await db.knowledgeDocument.findMany({
    where: { type: "URL", status: { not: "INDEXING" }, nextReindexAt: { lte: new Date() } },
    take: 25,
  });
  let done = 0;
  for (const doc of due) {
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "INDEXING" } });
    try {
      const text = doc.sourceUrl ? await fetchUrlText(doc.sourceUrl) : "";
      const push = await pushToDograhKnowledgeBase(doc); // OPERATOR GATE — no-op today
      const hours = doc.reindexIntervalHours;
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          contentText: text || doc.contentText,
          status: "INDEXED",
          lastIndexedAt: new Date(),
          error: push.pushed ? null : doc.error, // gate: keep prior error, don't fail the doc
          nextReindexAt: hours ? new Date(Date.now() + hours * 3600 * 1000) : null,
        },
      });
      done++;
    } catch (err) {
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: "FAILED",
          error: err instanceof Error ? err.message.slice(0, 400) : "reindex failed",
          nextReindexAt: doc.reindexIntervalHours
            ? new Date(Date.now() + doc.reindexIntervalHours * 3600 * 1000)
            : null,
        },
      });
    }
  }
  return done;
}

if (require.main === module) {
  console.log(`[kb-reindex] starting, schedule "${TICK}"`);
  cron.schedule(TICK, async () => {
    try {
      const n = await reindexDue();
      if (n > 0) console.log(`[kb-reindex] re-indexed ${n} document(s)`);
    } catch (e) {
      console.error("[kb-reindex] tick failed:", e);
    }
  });
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx tsx -e "
import('tsx/cjs').then(async () => {
  const { reindexDue } = await import('./src/worker/kb-reindex');
  const n = await reindexDue();
  console.log('due processed:', n);
  process.exit(0);
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** typecheck exit 0; `due processed: 0` (seed doc's `nextReindexAt` is 24h out).
**If it fails:** `Cannot find module 'node-cron'` → Step 0 install was skipped; run it
once. Otherwise fix the named line once, then STOP and report.

---

## Step 12: Tools & actions — config schemas, server actions, executor route (readme §4.4)

All 8 `AgentToolType` tools are driven by `AgentToolConfig` rows (one per tool per
agent). During a call, Dograh invokes our `/api/tools/execute` endpoint (HTTP API
tool nodes generated by the workflow builder) for everything except
`HUMAN_TRANSFER` (Dograh's native Call Transfer tool — guide 06 owns the queue UI;
the contract is: workflow contains the transfer node, and when a transfer happens
the Dograh webhook receiver in guide 06 creates the `TransferRequest` row with
`queue`/`skill`/`reason`/`contextSnapshot`).

**File `src/lib/tool-configs.ts`** (zod schemas — boundaries, unit-tested):

```ts
import { z } from "zod";
import type { AgentToolType } from "@prisma/client";

/** Per-tool config schemas (stored as AgentToolConfig.config JSON). */
export const TOOL_CONFIG_SCHEMAS: Record<AgentToolType, z.ZodTypeAny> = {
  CALENDAR_BOOKING: z.object({
    provider: z.enum(["google", "microsoft", "calendly", "calcom"]).default("google"),
    calendarId: z.string().max(200).default("primary"),
    slotMinutes: z.coerce.number().int().min(10).max(120).default(30),
    eventTitle: z.string().max(120).default("Appointment"),
  }),
  HUMAN_TRANSFER: z.object({
    queue: z.string().max(60).default("support"),
    skill: z.string().max(60).default(""),
    fallbackNumber: z.string().max(20).default(""), // E.164 static transfer target (optional)
    whisperSummary: z.coerce.boolean().default(true),
  }),
  SMS: z.object({
    messageTemplate: z.string().min(5).max(500).default("Namaste {{name}}, {{details}} — {{business_name}}"),
  }),
  WHATSAPP: z.object({
    templateName: z.string().min(2).max(120),
    paramsHint: z.string().max(300).default(""),
  }),
  CRM_WRITE: z.object({
    provider: z.enum(["HUBSPOT", "ZOHO", "SALESFORCE", "LEADSQUARED", "FRESHSALES", "PIPEDRIVE"]).optional(),
    objectType: z.enum(["contact", "lead"]).default("contact"),
    logCallOutcome: z.coerce.boolean().default(true),
  }),
  PAYMENT_LINK: z.object({
    amountPaise: z.coerce.number().int().min(100).optional(), // fixed-amount agents (EMI)
    description: z.string().max(200).default("Payment"),
    sendVia: z.enum(["sms", "whatsapp", "readout"]).default("whatsapp"),
  }),
  CUSTOM_WEBHOOK: z.object({
    url: z.string().url().max(1000),
    method: z.enum(["GET", "POST"]).default("POST"),
    authHeader: z.string().max(500).optional(),
    requestTemplate: z.record(z.string(), z.unknown()).default({}),
    responseMapping: z.record(z.string(), z.string()).default({}), // {ourField: "json.path"}
  }),
  VOICEMAIL: z.object({
    transcribe: z.coerce.boolean().default(true),
    notifyEmail: z.string().email().optional().or(z.literal("")),
  }),
};

export type ToolConfigValidation = { ok: true; config: unknown } | { ok: false; error: string };

export function validateToolConfig(tool: AgentToolType, config: unknown): ToolConfigValidation {
  const parsed = TOOL_CONFIG_SCHEMAS[tool].safeParse(config ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Invalid ${tool} config: ${parsed.error.issues[0]?.message ?? "check fields"}` };
  }
  return { ok: true, config: parsed.data };
}

/** Metadata for the editor UI (labels + which tools have a dry-run test). */
export const TOOL_META: { tool: AgentToolType; label: string; description: string; testable: boolean }[] = [
  { tool: "CALENDAR_BOOKING", label: "Book appointment", description: "Availability check + booking via connected calendar", testable: true },
  { tool: "HUMAN_TRANSFER", label: "Transfer to human", description: "Warm transfer with context whisper (guide 06 queue)", testable: false },
  { tool: "SMS", label: "Send SMS", description: "Confirmation / details via Vobiz SMS", testable: true },
  { tool: "WHATSAPP", label: "Send WhatsApp", description: "Template message via Vobiz WhatsApp Business API", testable: true },
  { tool: "CRM_WRITE", label: "CRM write", description: "Create/update lead, log call outcome in connected CRM", testable: true },
  { tool: "PAYMENT_LINK", label: "Payment collection", description: "Razorpay payment link: read out, send, confirm", testable: true },
  { tool: "CUSTOM_WEBHOOK", label: "Custom webhook", description: "Any REST endpoint with auth + response mapping", testable: true },
  { tool: "VOICEMAIL", label: "Take a message", description: "Voicemail capture with transcription + notify", testable: false },
];

/** Resolve a JSON path like "data.order.status" from a webhook response. */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Apply CUSTOM_WEBHOOK responseMapping to a response body. */
export function applyResponseMapping(
  mapping: Record<string, string>,
  responseBody: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [ourField, path] of Object.entries(mapping)) {
    out[ourField] = resolveJsonPath(responseBody, path);
  }
  return out;
}
```

**File `src/server/actions/tools.ts`:**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { validateToolConfig } from "@/lib/tool-configs";
import type { AgentToolType } from "@prisma/client";

export type ToolResult = { ok: boolean; error?: string; output?: string };

const TOOLS: AgentToolType[] = [
  "CALENDAR_BOOKING", "HUMAN_TRANSFER", "SMS", "WHATSAPP",
  "CRM_WRITE", "PAYMENT_LINK", "CUSTOM_WEBHOOK", "VOICEMAIL",
];

export async function upsertToolConfigAction(
  agentId: string,
  input: unknown,
): Promise<ToolResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = z
      .object({ tool: z.enum(TOOLS as [AgentToolType, ...AgentToolType[]]), enabled: z.coerce.boolean(), config: z.unknown() })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the tool form." };

    const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!agent) return { ok: false, error: "Agent not found." };

    const check = validateToolConfig(parsed.data.tool, parsed.data.config);
    if (!check.ok) return { ok: false, error: check.error };

    await db.agentToolConfig.upsert({
      where: { agentId_tool: { agentId, tool: parsed.data.tool } },
      update: { enabled: parsed.data.enabled, config: check.config as object },
      create: { agentId, tool: parsed.data.tool, enabled: parsed.data.enabled, config: check.config as object },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.tool_config", entity: "Agent", entityId: agentId,
      metadata: { tool: parsed.data.tool, enabled: parsed.data.enabled },
    });
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Dry-run "Test tool" button: executes the tool with safe sample input through the
 * SAME executor used in live calls (api/tools/execute route handler, imported here
 * as a plain function). VAANI_DRY_RUN=true (default) keeps it free.
 */
export async function testToolAction(agentId: string, tool: AgentToolType): Promise<ToolResult> {
  try {
    const ctx = await requirePermission("agents:read");
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      include: { toolConfigs: true },
    });
    if (!agent) return { ok: false, error: "Agent not found." };
    const row = agent.toolConfigs.find((t) => t.tool === tool);
    if (!row || !row.enabled) return { ok: false, error: "Enable and save the tool first." };

    const { executeTool } = await import("@/lib/tool-executor");
    const sample = sampleInput(tool);
    const result = await executeTool({
      workspaceId: ctx.workspaceId,
      agentId,
      tool,
      config: (row.config ?? {}) as Record<string, unknown>,
      input: sample,
    });
    return { ok: result.ok, error: result.error, output: JSON.stringify(result.data ?? result, null, 2).slice(0, 1500) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function sampleInput(tool: AgentToolType): Record<string, unknown> {
  switch (tool) {
    case "CALENDAR_BOOKING": return { action: "check" };
    case "SMS": return { to: "+919900000001", message: "Test message from Vaani AI (dry run)" };
    case "WHATSAPP": return { to: "+919900000001", template: "hello_world", params: ["Test"] };
    case "CRM_WRITE": return { lead: { name: "Test Lead", phone: "+919900000001", note: "dry run from Vaani" } };
    case "PAYMENT_LINK": return { amountPaise: 10000, description: "Test payment (dry run)", phone: "+919900000001" };
    case "CUSTOM_WEBHOOK": return { test: true };
    default: return {};
  }
}
```

**File `src/lib/tool-executor.ts`** (the single executor — used by the live-call
route AND the dry-run button):

```ts
/**
 * Tool executor — runs agent tools with validated config + workspace-scoped data.
 * Called by /api/tools/execute (Dograh HTTP API tools, live calls) and by
 * testToolAction (dry-run button). Every branch honours VAANI_DRY_RUN.
 */
import { db } from "@/lib/db";
import { sendSms, sendWhatsAppTemplate } from "@/lib/vobiz";
import { getAvailability, bookSlot } from "@/lib/calendar";
import { createPaymentLink } from "@/lib/payments";
import { getCrmProvider } from "@/lib/integrations/crm";
import { applyResponseMapping } from "@/lib/tool-configs";
import type { AgentToolType } from "@prisma/client";

export type ToolExecResult = { ok: boolean; error?: string; data?: unknown };

/** Dry-run guard: VAANI_DRY_RUN=true (default) simulates SMS/WhatsApp sends —
 *  nothing is dispatched, no money spent. The Vobiz library itself (guide 04) always
 *  tells the truth; simulation lives HERE, at the tool boundary. */
const DRY_RUN = () => process.env.VAANI_DRY_RUN !== "false";

function simulated(channel: string, payload: Record<string, unknown>) {
  return { simulated: true, channel, ...payload };
}

/** WhatsApp body parameters in the WhatsApp Business Cloud API component shape. */
function waComponents(params: string[]): Array<Record<string, unknown>> {
  return params.length
    ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
    : [];
}

export async function executeTool(args: {
  workspaceId: string;
  agentId: string;
  tool: AgentToolType;
  config: Record<string, unknown>;
  input: Record<string, unknown>;
}): Promise<ToolExecResult> {
  const { workspaceId, config, input } = args;
  try {
    switch (args.tool) {
      case "CALENDAR_BOOKING": {
        const provider = String(config.provider ?? "google").toUpperCase() as "GOOGLE" | "MICROSOFT" | "CALENDLY" | "CALCOM";
        const conn = await db.calendarConnection.findFirst({
          where: { workspaceId, provider, active: true },
        });
        if (!conn) return { ok: false, error: `No active ${provider} calendar connection (Settings → Integrations).` };
        if (input.action === "book") {
          const evt = await bookSlot(conn, {
            startIso: String(input.startIso),
            endIso: String(input.endIso),
            summary: String(config.eventTitle ?? "Appointment"),
            attendeeName: input.name ? String(input.name) : undefined,
            attendeePhone: input.phone ? String(input.phone) : undefined,
          });
          return { ok: true, data: evt };
        }
        const slots = await getAvailability(conn, { slotMinutes: Number(config.slotMinutes ?? 30) });
        return { ok: true, data: { slots: slots.slice(0, 5) } };
      }
      case "SMS": {
        const to = String(input.to ?? "");
        const message = String(input.message ?? config.messageTemplate ?? "");
        if (!to || !message) return { ok: false, error: "SMS needs to + message." };
        if (DRY_RUN()) return { ok: true, data: simulated("sms", { to, message }) };
        return { ok: true, data: await sendSms({ to, message }) };
      }
      case "WHATSAPP": {
        const to = String(input.to ?? "");
        const templateName = String(input.template ?? config.templateName ?? "");
        const params = Array.isArray(input.params) ? (input.params as string[]) : [];
        if (!to || !templateName) return { ok: false, error: "WhatsApp needs to + template." };
        if (DRY_RUN()) return { ok: true, data: simulated("whatsapp", { to, templateName, params }) };
        return { ok: true, data: await sendWhatsAppTemplate({ to, templateName, components: waComponents(params) }) };
      }
      case "CRM_WRITE": {
        const provider = (config.provider as "HUBSPOT" | "ZOHO" | undefined) ?? undefined;
        const conn = await db.crmConnection.findFirst({
          where: { workspaceId, active: true, ...(provider ? { provider } : {}) },
          orderBy: { updatedAt: "desc" },
        });
        if (!conn) return { ok: false, error: "No active CRM connection (Settings → Integrations)." };
        const crm = getCrmProvider(conn.provider);
        const lead = (input.lead ?? input) as Record<string, unknown>;
        const out = await crm.pushLead(conn, {
          name: String(lead.name ?? ""),
          phone: String(lead.phone ?? ""),
          email: lead.email ? String(lead.email) : undefined,
          note: lead.note ? String(lead.note) : undefined,
          outcome: input.outcome ? String(input.outcome) : undefined,
        });
        return { ok: true, data: out };
      }
      case "PAYMENT_LINK": {
        const amountPaise = Number(input.amountPaise ?? config.amountPaise ?? 0);
        const link = await createPaymentLink({
          amountPaise,
          description: String(input.description ?? config.description ?? "Payment"),
          customerPhone: input.phone ? String(input.phone) : undefined,
          referenceId: `${args.agentId}:${Date.now()}`,
        });
        // Optionally send the link immediately (simulated under VAANI_DRY_RUN).
        let sentVia: string = "readout";
        if (input.phone && config.sendVia !== "readout") {
          sentVia = String(config.sendVia ?? "readout");
          if (!DRY_RUN()) {
            if (config.sendVia === "sms") {
              await sendSms({ to: String(input.phone), message: `Pay here: ${link.shortUrl}` });
            } else if (config.sendVia === "whatsapp" && config.templateName) {
              await sendWhatsAppTemplate({
                to: String(input.phone),
                templateName: String(config.templateName),
                components: waComponents([link.shortUrl]),
              });
            }
          }
        }
        return { ok: true, data: { ...link, sentVia: DRY_RUN() && sentVia !== "readout" ? `simulated-${sentVia}` : sentVia } };
      }
      case "CUSTOM_WEBHOOK": {
        const url = String(config.url ?? "");
        if (!url) return { ok: false, error: "Webhook URL not configured." };
        const res = await fetch(url, {
          method: String(config.method ?? "POST"),
          headers: {
            "Content-Type": "application/json",
            ...(config.authHeader ? { Authorization: String(config.authHeader) } : {}),
          },
          body: String(config.method ?? "POST") === "POST"
            ? JSON.stringify({ ...(config.requestTemplate as object), ...input })
            : undefined,
          signal: AbortSignal.timeout(15000),
        });
        const bodyText = await res.text();
        let body: unknown = bodyText;
        try { body = JSON.parse(bodyText); } catch { /* non-JSON body */ }
        const mapped = applyResponseMapping((config.responseMapping ?? {}) as Record<string, string>, body);
        return { ok: res.ok, error: res.ok ? undefined : `webhook HTTP ${res.status}`, data: { status: res.status, mapped, raw: bodyText.slice(0, 500) } };
      }
      case "VOICEMAIL": {
        await db.voicemailMessage.create({
          data: {
            workspaceId,
            fromNumber: String(input.caller_phone ?? input.from ?? "unknown"),
            transcript: [input.caller_name ? `Name: ${input.caller_name}` : null, input.message ? String(input.message) : null]
              .filter(Boolean).join("\n") || null,
          },
        });
        return { ok: true, data: { captured: true } };
      }
      case "HUMAN_TRANSFER":
        // Executed by Dograh's native Call Transfer tool; TransferRequest rows are
        // created by the guide-06 webhook receiver. Nothing to do here.
        return { ok: true, data: { delegated: "dograh_call_transfer" } };
      default:
        return { ok: false, error: `Unknown tool.` };
    }
  } catch (e) {
    console.error(`tool ${args.tool} failed:`, e);
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "tool failed" };
  }
}
```

**File `src/app/api/tools/execute/route.ts`** (called by Dograh mid-call; auth =
same shared secret as the Dograh webhook):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AgentToolType } from "@prisma/client";
import { db } from "@/lib/db";
import { executeTool } from "@/lib/tool-executor";

const bodySchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
  tool: z.nativeEnum(AgentToolType),
  input: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Dograh HTTP API tools POST here mid-call. Auth: static shared secret header
 * (x-tool-secret), same value Dograh already uses for webhooks. Cross-tenant safety:
 * the AgentToolConfig row is loaded with BOTH workspaceId and agentId from the body
 * — a mismatched pair yields 404.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.DOGRAH_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-tool-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const { workspaceId, agentId, tool, input } = parsed.data;

  const row = await db.agentToolConfig.findFirst({
    where: { agentId, tool, enabled: true, agent: { workspaceId } },
  });
  if (!row) {
    return NextResponse.json({ ok: false, error: "tool not enabled for this agent" }, { status: 404 });
  }

  const result = await executeTool({
    workspaceId, agentId, tool,
    config: (row.config ?? {}) as Record<string, unknown>,
    input,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
```

**Edit `src/middleware.ts` (guide 03) — unblock the tool endpoint.** The route above
authenticates via `x-tool-secret` (no cookies), but guide 03's middleware redirects
cookie-less requests to `/login` (307) — without this edit every mid-call tool AND
the Step 22d curl tests fail. In `src/middleware.ts`, find the `PUBLIC_PREFIXES`
array and the line:

```ts
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
```

and insert IMMEDIATELY AFTER it:

```ts
  "/api/tools/",      // Dograh mid-call tool executor — guarded by x-tool-secret, not cookies
```

So the block becomes:

```ts
const PUBLIC_PREFIXES = [
  "/api/webhooks/",   // Dograh/Razorpay webhooks have their own signature checks
  "/api/auth/",       // SSO start + callback routes set the cookie themselves
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
  "/api/tools/",      // Dograh mid-call tool executor — guarded by x-tool-secret, not cookies
  "/invite/",         // invite acceptance page handles its own auth logic
  "/_next/",
  "/favicon.ico",
];
```

**Verify:**
```bash
grep -n '"/api/tools/"' src/middleware.ts
```
**Expected:** the inserted line printed exactly once. If `/api/v1/` is not found,
STOP and report — guide 03 Step 9 (middleware rewrite) is not in place.

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** both exit 0; build route table includes `/api/tools/execute`.
**If it fails:** the compiler names the file — fix against the listings; once more,
then STOP and report. (`@/lib/integrations/crm` is created in Step 13 — if you are
verifying out of order, do Step 13 first, then re-run this step's verify.)

---

## Step 13: CRM integration framework (readme §9) — provider interface + HubSpot + Zoho

Six files under `src/lib/integrations/crm/`. HubSpot and Zoho are FULL
implementations (OAuth, token refresh, push lead, pull updates, list fields).
Salesforce, LeadSquared, Freshsales and Pipedrive are documented config-driven
adapters following the same interface — OPERATOR GATE for app credentials.

**File `src/lib/integrations/crm/types.ts`:**

```ts
import type { CrmConnection, CrmProvider as CrmProviderEnum } from "@prisma/client";

export type CrmLead = {
  name: string;
  phone: string; // E.164
  email?: string;
  note?: string;
  outcome?: string; // call outcome to log, e.g. "qualified"
};

export type CrmPushResult = { externalId: string; created: boolean };

export type CrmUpdate = {
  externalId: string;
  name?: string;
  phone?: string;
  email?: string;
  raw?: unknown;
};

export type CrmTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  instanceUrl?: string | null;
};

/** The provider contract. EVERY CRM adapter implements this. */
export interface CrmProvider {
  readonly provider: CrmProviderEnum;
  /** OAuth consent URL (state carries our signed payload). */
  getAuthUrl(state: string): string;
  /** Exchange the OAuth code for tokens. */
  exchangeCode(code: string): Promise<CrmTokens>;
  /** Refresh an expired access token; returns fresh tokens. */
  refreshTokens(conn: CrmConnection): Promise<CrmTokens>;
  /** Create or update (by phone) a contact/lead. */
  pushLead(conn: CrmConnection, lead: CrmLead): Promise<CrmPushResult>;
  /** Pull records modified since `since` (two-way sync worker). */
  pullUpdates(conn: CrmConnection, since: Date): Promise<CrmUpdate[]>;
  /** List writable fields for the field-mapping editor. */
  listFields(conn: CrmConnection): Promise<string[]>;
}
```

**File `src/lib/integrations/crm/field-mapping.ts`** (pure — unit-tested):

```ts
/**
 * Field-mapping applier. CrmConnection.fieldMapping maps OUR canonical keys to
 * CRM-native property names, e.g.:
 *   {"contact.name":"firstname","contact.phone":"phone","call.outcome":"hs_lead_status"}
 * Pure function — unit-tested in tests/crm-mapping.test.ts.
 */
import type { CrmLead } from "./types";

export type FieldMapping = Record<string, string>;

export const CANONICAL_KEYS = [
  "contact.name",
  "contact.phone",
  "contact.email",
  "contact.note",
  "call.outcome",
] as const;

/** Sensible per-provider presets shown in the mapping editor. */
export const FIELD_MAPPING_PRESETS: Record<string, FieldMapping> = {
  HUBSPOT: {
    "contact.name": "firstname",
    "contact.phone": "phone",
    "contact.email": "email",
    "contact.note": "hs_lead_notes",
    "call.outcome": "hs_lead_status",
  },
  ZOHO: {
    // name intentionally unmapped: the payload builder splits into First_Name/Last_Name
    "contact.phone": "Phone",
    "contact.email": "Email",
    "contact.note": "Description",
  },
  SALESFORCE: { "contact.name": "LastName", "contact.phone": "Phone", "contact.email": "Email" },
  LEADSQUARED: { "contact.name": "FirstName", "contact.phone": "Phone", "contact.email": "EmailAddress" },
  FRESHSALES: { "contact.name": "first_name", "contact.phone": "work_number", "contact.email": "email" },
  PIPEDRIVE: { "contact.name": "name", "contact.phone": "phone", "contact.email": "email" },
};

/** Split "Ravi Kumar" → { first: "Ravi", last: "Kumar" } (CRMs want split names). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") || parts[0] || "Unknown" };
}

/**
 * Apply a mapping to a lead → flat { crmProperty: value } payload.
 * Unknown canonical keys in the mapping are ignored; missing values are omitted.
 */
export function applyFieldMapping(
  mapping: FieldMapping | null | undefined,
  lead: CrmLead,
): Record<string, string> {
  const canonical: Record<string, string | undefined> = {
    "contact.name": lead.name,
    "contact.phone": lead.phone,
    "contact.email": lead.email,
    "contact.note": lead.note,
    "call.outcome": lead.outcome,
  };
  const out: Record<string, string> = {};
  for (const [ourKey, crmKey] of Object.entries(mapping ?? {})) {
    const value = canonical[ourKey];
    if (value !== undefined && value !== "" && crmKey) out[crmKey] = value;
  }
  return out;
}

/** Validate a mapping from the JSON editor: keys must be canonical, values strings. */
export function validateFieldMapping(input: unknown): { ok: true; mapping: FieldMapping } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Mapping must be a JSON object like {\"contact.phone\":\"phone\"}." };
  }
  const out: FieldMapping = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(CANONICAL_KEYS as readonly string[]).includes(k)) {
      return { ok: false, error: `Unknown key "${k}". Allowed: ${CANONICAL_KEYS.join(", ")}` };
    }
    if (typeof v !== "string" || v.length === 0 || v.length > 120) {
      return { ok: false, error: `Value for "${k}" must be a CRM property name (string).` };
    }
    out[k] = v;
  }
  return { ok: true, mapping: out };
}
```

**File `src/lib/integrations/crm/hubspot.ts`** (FULL implementation):

```ts
import type { CrmConnection } from "@prisma/client";
import type { CrmLead, CrmProvider, CrmPushResult, CrmTokens, CrmUpdate } from "./types";
import { applyFieldMapping, splitName, FIELD_MAPPING_PRESETS } from "./field-mapping";

const API = "https://api.hubapi.com";
const CLIENT_ID = () => process.env.HUBSPOT_CLIENT_ID ?? "";
const CLIENT_SECRET = () => process.env.HUBSPOT_CLIENT_SECRET ?? "";
const REDIRECT = () =>
  `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/crm/hubspot/callback`;

async function hs<T>(path: string, init: RequestInit, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Exact payload shape HubSpot expects (unit-tested with a mocked fetch). */
export function hubspotContactPayload(mapping: Record<string, string> | null, lead: CrmLead): {
  properties: Record<string, string>;
} {
  const props = applyFieldMapping(mapping ?? FIELD_MAPPING_PRESETS.HUBSPOT, lead);
  const { first, last } = splitName(lead.name);
  if (!props.firstname) props.firstname = first;
  if (!props.lastname && last) props.lastname = last;
  if (!props.phone) props.phone = lead.phone;
  return { properties: props };
}

export const hubspotProvider: CrmProvider = {
  provider: "HUBSPOT",

  getAuthUrl(state: string): string {
    const scope = encodeURIComponent("crm.objects.contacts.read crm.objects.contacts.write");
    return `https://app.hubspot.com/oauth/authorize?client_id=${encodeURIComponent(CLIENT_ID())}&redirect_uri=${encodeURIComponent(REDIRECT())}&scope=${scope}&state=${encodeURIComponent(state)}`;
  },

  async exchangeCode(code: string): Promise<CrmTokens> {
    const res = await fetch(`${API}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        redirect_uri: REDIRECT(),
        code,
      }),
    });
    if (!res.ok) throw new Error(`HubSpot OAuth failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  },

  async refreshTokens(conn: CrmConnection): Promise<CrmTokens> {
    if (!conn.refreshToken) throw new Error("HubSpot connection has no refresh token — reconnect.");
    const res = await fetch(`${API}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        refresh_token: conn.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`HubSpot refresh failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? conn.refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  },

  async pushLead(conn: CrmConnection, lead: CrmLead): Promise<CrmPushResult> {
    const mapping = (conn.fieldMapping ?? null) as Record<string, string> | null;
    const payload = hubspotContactPayload(mapping, lead);
    // Upsert by phone: search first, PATCH if found, POST otherwise.
    const found = await hs<{ results?: { id: string }[] }>(
      "/crm/v3/objects/contacts/search",
      { method: "POST", body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: lead.phone }] }], properties: ["phone"], limit: 1 }) },
      conn.accessToken,
    );
    const existing = found.results?.[0]?.id;
    if (existing) {
      await hs(`/crm/v3/objects/contacts/${existing}`, { method: "PATCH", body: JSON.stringify(payload) }, conn.accessToken);
      return { externalId: existing, created: false };
    }
    const created = await hs<{ id: string }>(
      "/crm/v3/objects/contacts",
      { method: "POST", body: JSON.stringify(payload) },
      conn.accessToken,
    );
    return { externalId: created.id, created: true };
  },

  async pullUpdates(conn: CrmConnection, since: Date): Promise<CrmUpdate[]> {
    const res = await hs<{ results?: { id: string; properties: Record<string, string | null> }[] }>(
      "/crm/v3/objects/contacts/search",
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GTE", value: String(since.getTime()) }] }],
          properties: ["firstname", "lastname", "phone", "email"],
          limit: 100,
        }),
      },
      conn.accessToken,
    );
    return (res.results ?? []).map((r) => ({
      externalId: r.id,
      name: [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") || undefined,
      phone: r.properties.phone ?? undefined,
      email: r.properties.email ?? undefined,
      raw: r.properties,
    }));
  },

  async listFields(_conn: CrmConnection): Promise<string[]> {
    // Static curated list keeps this deterministic (HubSpot's /properties API varies
    // by portal). The editor is a JSON editor anyway — these are suggestions.
    return ["firstname", "lastname", "phone", "email", "hs_lead_status", "hs_lead_notes", "company", "website", "lifecyclestage"];
  },
};
```

**File `src/lib/integrations/crm/zoho.ts`** (FULL implementation with token refresh):

```ts
import type { CrmConnection } from "@prisma/client";
import type { CrmLead, CrmProvider, CrmPushResult, CrmTokens, CrmUpdate } from "./types";
import { applyFieldMapping, splitName, FIELD_MAPPING_PRESETS } from "./field-mapping";

const ACCOUNTS = "https://accounts.zoho.com";
const API = () => "https://www.zohoapis.com"; // region note: .eu/.in tenants set instanceUrl
const CLIENT_ID = () => process.env.ZOHO_CLIENT_ID ?? "";
const CLIENT_SECRET = () => process.env.ZOHO_CLIENT_SECRET ?? "";
const REDIRECT = () =>
  `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/crm/zoho/callback`;

function apiBase(conn: CrmConnection): string {
  return (conn.instanceUrl ?? API()).replace(/\/$/, "");
}

async function zh<T>(conn: CrmConnection, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase(conn)}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Zoho-oauthtoken ${conn.accessToken}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoho ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Exact Zoho Leads payload (unit-tested). */
export function zohoLeadPayload(mapping: Record<string, string> | null, lead: CrmLead): {
  data: Record<string, string>[];
} {
  const props = applyFieldMapping(mapping ?? FIELD_MAPPING_PRESETS.ZOHO, lead);
  const { first, last } = splitName(lead.name);
  if (!props.Last_Name) props.Last_Name = last;
  if (!props.First_Name && first) props.First_Name = first;
  if (!props.Phone) props.Phone = lead.phone;
  return { data: [props] };
}

async function zohoTokenRequest(params: Record<string, string>): Promise<CrmTokens> {
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${new URLSearchParams(params)}`, { method: "POST" });
  if (!res.ok) throw new Error(`Zoho token request failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; api_domain?: string; error?: string };
  if (!data.access_token) throw new Error(`Zoho OAuth error: ${data.error ?? "no access_token"}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    instanceUrl: data.api_domain ?? null,
  };
}

export const zohoProvider: CrmProvider = {
  provider: "ZOHO",

  getAuthUrl(state: string): string {
    const scope = encodeURIComponent("ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.UPDATE");
    return `${ACCOUNTS}/oauth/v2/auth?scope=${scope}&client_id=${encodeURIComponent(CLIENT_ID())}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT())}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  },

  exchangeCode(code: string): Promise<CrmTokens> {
    return zohoTokenRequest({
      grant_type: "authorization_code",
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      redirect_uri: REDIRECT(),
      code,
    });
  },

  refreshTokens(conn: CrmConnection): Promise<CrmTokens> {
    if (!conn.refreshToken) throw new Error("Zoho connection has no refresh token — reconnect.");
    return zohoTokenRequest({
      grant_type: "refresh_token",
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      refresh_token: conn.refreshToken,
    });
  },

  async pushLead(conn: CrmConnection, lead: CrmLead): Promise<CrmPushResult> {
    const payload = zohoLeadPayload((conn.fieldMapping ?? null) as Record<string, string> | null, lead);
    const res = await zh<{ data?: { details?: { id?: string }; status?: string; code?: string }[] }>(
      conn,
      "/crm/v2/Leads/upsert",
      { method: "POST", body: JSON.stringify(payload) },
    );
    const row = res.data?.[0];
    const id = row?.details?.id;
    if (!id) throw new Error(`Zoho upsert rejected: ${row?.code ?? "unknown"}`);
    return { externalId: id, created: row?.code === "SUCCESS" };
  },

  async pullUpdates(conn: CrmConnection, since: Date): Promise<CrmUpdate[]> {
    const iso = since.toISOString().replace(/\.\d{3}Z$/, "+05:30");
    const res = await zh<{ data?: { id: string; First_Name?: string; Last_Name?: string; Phone?: string; Email?: string }[] }>(
      conn,
      `/crm/v2/Leads?fields=First_Name,Last_Name,Phone,Email&per_page=100`,
      { method: "GET", headers: { "If-Modified-Since": iso } },
    ).catch(() => ({ data: [] }));
    return (res.data ?? []).map((r) => ({
      externalId: r.id,
      name: [r.First_Name, r.Last_Name].filter(Boolean).join(" ") || undefined,
      phone: r.Phone,
      email: r.Email,
      raw: r,
    }));
  },

  async listFields(_conn: CrmConnection): Promise<string[]> {
    return ["First_Name", "Last_Name", "Phone", "Email", "Company", "Description", "Lead_Status", "Lead_Source"];
  },
};
```

**File `src/lib/integrations/crm/stubs.ts`** (config-driven adapters — OPERATOR GATE):

```ts
import type { CrmConnection, CrmProvider as CrmProviderEnum } from "@prisma/client";
import type { CrmProvider, CrmTokens, CrmLead, CrmPushResult, CrmUpdate } from "./types";

/**
 * OPERATOR GATE — SALESFORCE / LEADSQUARED / FRESHSALES / PIPEDRIVE.
 * These adapters follow the exact CrmProvider interface (see hubspot.ts/zoho.ts).
 * The DB rows, OAuth routes, settings UI and field-mapping editor already work for
 * them; only the provider-specific HTTP calls need real app credentials + endpoint
 * verification. To enable a provider:
 *   1. Operator creates an OAuth app with the CRM vendor; add CLIENT_ID/SECRET to .env.
 *   2. Implement the four methods below in a new file (copy zoho.ts as the template).
 *   3. Register it in src/lib/integrations/crm/index.ts and delete the stub here.
 * Until then every method fails loudly and explains this.
 */
function gate(provider: CrmProviderEnum): never {
  throw new Error(
    `${provider} adapter is not enabled in v1. OPERATOR GATE (guide 05 Step 13, stubs.ts): the CrmProvider interface, OAuth routes, UI and sync worker are ready — implement the provider's HTTP calls with real vendor app credentials.`,
  );
}

class StubProvider implements CrmProvider {
  constructor(public readonly provider: CrmProviderEnum) {}
  getAuthUrl(): string { return gate(this.provider); }
  exchangeCode(): Promise<CrmTokens> { return gate(this.provider); }
  refreshTokens(_conn: CrmConnection): Promise<CrmTokens> { return gate(this.provider); }
  pushLead(_conn: CrmConnection, _lead: CrmLead): Promise<CrmPushResult> { return gate(this.provider); }
  pullUpdates(_conn: CrmConnection, _since: Date): Promise<CrmUpdate[]> { return gate(this.provider); }
  listFields(_conn: CrmConnection): Promise<string[]> { return gate(this.provider); }
}

export const salesforceProvider = new StubProvider("SALESFORCE");
export const leadsquaredProvider = new StubProvider("LEADSQUARED");
export const freshsalesProvider = new StubProvider("FRESHSALES");
export const pipedriveProvider = new StubProvider("PIPEDRIVE");
```

**File `src/lib/integrations/crm/index.ts`** (registry):

```ts
import type { CrmProvider as CrmProviderEnum } from "@prisma/client";
import type { CrmProvider } from "./types";
import { hubspotProvider } from "./hubspot";
import { zohoProvider } from "./zoho";
import { salesforceProvider, leadsquaredProvider, freshsalesProvider, pipedriveProvider } from "./stubs";

const REGISTRY: Record<CrmProviderEnum, CrmProvider> = {
  HUBSPOT: hubspotProvider,
  ZOHO: zohoProvider,
  SALESFORCE: salesforceProvider,
  LEADSQUARED: leadsquaredProvider,
  FRESHSALES: freshsalesProvider,
  PIPEDRIVE: pipedriveProvider,
};

export function getCrmProvider(provider: CrmProviderEnum): CrmProvider {
  return REGISTRY[provider];
}

export const CRM_PROVIDERS: { provider: CrmProviderEnum; label: string; implemented: boolean }[] = [
  { provider: "HUBSPOT", label: "HubSpot", implemented: true },
  { provider: "ZOHO", label: "Zoho CRM", implemented: true },
  { provider: "SALESFORCE", label: "Salesforce", implemented: false },
  { provider: "LEADSQUARED", label: "LeadSquared", implemented: false },
  { provider: "FRESHSALES", label: "Freshsales", implemented: false },
  { provider: "PIPEDRIVE", label: "Pipedrive", implemented: false },
];

export type { CrmProvider, CrmLead, CrmPushResult, CrmUpdate, CrmTokens } from "./types";
export { applyFieldMapping, validateFieldMapping, FIELD_MAPPING_PRESETS, splitName } from "./field-mapping";
export { hubspotProvider, hubspotContactPayload } from "./hubspot";
export { zohoProvider, zohoLeadPayload } from "./zoho";
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.
**If it fails:** the compiler names the file/line — fix against the listings; once
more, then STOP and report. (Note: Step 12's `tool-executor.ts` imports this module —
if you ran Step 12's verify before this step, re-run it now: `npm run typecheck && npm run build`.)

---

## Step 14: OAuth routes — CRM connect/callback + Google Calendar connect/callback

**File `src/lib/integrations/oauth-state.ts`** (signed OAuth state — no extra deps):

```ts
import { createHmac, timingSafeEqual } from "crypto";

/** OAuth state = `${workspaceId}.${hmac}` — proves the callback belongs to this tenant. */
export function signOAuthState(workspaceId: string): string {
  const sig = createHmac("sha256", process.env.SESSION_SECRET ?? "dev").update(workspaceId).digest("hex");
  return `${workspaceId}.${sig}`;
}

export function verifyOAuthState(state: string): string | null {
  const [workspaceId, sig] = state.split(".");
  if (!workspaceId || !sig) return null;
  const expected = signOAuthState(workspaceId).split(".")[1];
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? workspaceId : null;
}
```

**File `src/app/api/integrations/crm/[provider]/connect/route.ts`:**

```ts
import { NextRequest, NextResponse } from "next/server";
import { CrmProvider as CrmProviderEnum } from "@prisma/client";
import { requireWorkspace } from "@/lib/auth";
import { getCrmProvider } from "@/lib/integrations/crm";
import { signOAuthState } from "@/lib/integrations/oauth-state";

export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const provider = params.provider.toUpperCase();
  if (!Object.values(CrmProviderEnum).includes(provider as CrmProviderEnum)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  try {
    const url = getCrmProvider(provider as CrmProviderEnum).getAuthUrl(signOAuthState(ctx.workspaceId));
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "provider unavailable";
    return NextResponse.redirect(new URL(`/settings/integrations?error=${encodeURIComponent(msg.slice(0, 120))}`, req.url));
  }
}
```

**File `src/app/api/integrations/crm/[provider]/callback/route.ts`:**

```ts
import { NextRequest, NextResponse } from "next/server";
import { CrmProvider as CrmProviderEnum } from "@prisma/client";
import { db } from "@/lib/db";
import { getCrmProvider } from "@/lib/integrations/crm";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/settings/integrations?error=${encodeURIComponent(msg)}`, req.url));

  const workspaceId = verifyOAuthState(state);
  if (!workspaceId || !code) return fail("Invalid OAuth state — try connecting again.");

  const provider = params.provider.toUpperCase();
  if (!Object.values(CrmProviderEnum).includes(provider as CrmProviderEnum)) return fail("unknown provider");

  try {
    const tokens = await getCrmProvider(provider as CrmProviderEnum).exchangeCode(code);
    await db.crmConnection.upsert({
      where: { workspaceId_provider: { workspaceId, provider: provider as CrmProviderEnum } },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        instanceUrl: tokens.instanceUrl ?? undefined,
        active: true,
      },
      create: {
        workspaceId,
        provider: provider as CrmProviderEnum,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        instanceUrl: tokens.instanceUrl ?? null,
        active: true,
      },
    });
    await audit({ workspaceId, action: "crm.connect", entity: "CrmConnection", metadata: { provider } });
    return NextResponse.redirect(new URL(`/settings/integrations?connected=${provider}`, req.url));
  } catch (e) {
    console.error(e);
    return fail("OAuth exchange failed — check app credentials, then retry.");
  }
}
```

**File `src/app/api/integrations/calendar/google/connect/route.ts`:**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { googleCalendarAuthUrl } from "@/lib/calendar";
import { signOAuthState } from "@/lib/integrations/oauth-state";

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.redirect(googleCalendarAuthUrl(signOAuthState(ctx.workspaceId)));
}
```

**File `src/app/api/integrations/calendar/google/callback/route.ts`:**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exchangeGoogleCode } from "@/lib/calendar";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/settings/integrations?error=${encodeURIComponent(msg)}`, req.url));

  const workspaceId = verifyOAuthState(state);
  if (!workspaceId || !code) return fail("Invalid OAuth state — try connecting again.");

  try {
    const tokens = await exchangeGoogleCode(code);
    await db.calendarConnection.upsert({
      where: { workspaceId_provider: { workspaceId, provider: "GOOGLE" } },
      update: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt, active: true },
      create: {
        workspaceId, provider: "GOOGLE",
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt, primaryCalendarId: "primary", active: true,
      },
    });
    await audit({ workspaceId, action: "calendar.connect", entity: "CalendarConnection", metadata: { provider: "GOOGLE" } });
    return NextResponse.redirect(new URL("/settings/integrations?connected=GOOGLE_CALENDAR", req.url));
  } catch (e) {
    console.error(e);
    return fail("Google OAuth failed — check GOOGLE_CALENDAR_CLIENT_ID/SECRET, then retry.");
  }
}
```

**File `src/server/actions/integrations.ts`** (disconnect, mapping editor, sync toggle, test):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { CrmProvider as CrmProviderEnum, CalendarProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getCrmProvider, validateFieldMapping } from "@/lib/integrations/crm";

export type IntegrationResult = { ok: boolean; error?: string; output?: string };

const crmProviderSchema = z.nativeEnum(CrmProviderEnum);

export async function disconnectCrmAction(provider: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    await db.crmConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { active: false },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "crm.disconnect", entity: "CrmConnection", metadata: { provider: p } });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

/** Save a field mapping from the JSON editor (validates canonical keys). */
export async function updateCrmFieldMappingAction(provider: string, mappingJson: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    let parsed: unknown;
    try {
      parsed = JSON.parse(mappingJson);
    } catch {
      return { ok: false, error: "Invalid JSON." };
    }
    const check = validateFieldMapping(parsed);
    if (!check.ok) return { ok: false, error: check.error };
    const updated = await db.crmConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { fieldMapping: check.mapping },
    });
    if (updated.count === 0) return { ok: false, error: "Connect the CRM first." };
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

export async function toggleCrmTwoWaySyncAction(provider: string, enabled: boolean): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    const updated = await db.crmConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { twoWaySyncEnabled: enabled === true },
    });
    if (updated.count === 0) return { ok: false, error: "Connect the CRM first." };
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

/** "Test connection" — verifies the stored token by listing fields (refresh-on-401
 *  for Zoho). */
export async function testCrmConnectionAction(provider: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:read");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    const conn = await db.crmConnection.findFirst({
      where: { workspaceId: ctx.workspaceId, provider: p, active: true },
    });
    if (!conn) return { ok: false, error: "Not connected." };
    try {
      const fields = await getCrmProvider(p).listFields(conn);
      return { ok: true, output: `Token valid. ${fields.length} writable fields: ${fields.slice(0, 6).join(", ")}…` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Connection test failed." };
    }
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

export async function disconnectCalendarAction(provider: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = z.nativeEnum(CalendarProvider).parse(provider.toUpperCase());
    await db.calendarConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { active: false },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "calendar.disconnect", entity: "CalendarConnection", metadata: { provider: p } });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** both exit 0; route table includes `/api/integrations/crm/[provider]/connect`,
`/api/integrations/crm/[provider]/callback`, `/api/integrations/calendar/google/connect`,
`/api/integrations/calendar/google/callback`.
**If it fails:** the compiler names the file — fix against the listings; once more,
then STOP and report.

> **OPERATOR GATE (OAuth app credentials):** HubSpot: create an app at
> developers.hubspot.com → set redirect URL `https://<DOMAIN>/api/integrations/crm/hubspot/callback`
> → copy client id/secret into `.env`. Zoho: api-console.zoho.com → server-based app →
> same redirect pattern (`.../crm/zoho/callback`). Google: console.cloud.google.com →
> OAuth client (web) → redirect `https://<DOMAIN>/api/integrations/calendar/google/callback`.
> Until real credentials exist, connect buttons redirect back with a clear error —
> every other piece (UI, actions, worker) works.

---

## Step 15: CRM two-way sync worker (node-cron)

Pulls CRM-side updates into `Contact` rows (matched by `crmExternalId`, falling back
to phone) for every connection with `twoWaySyncEnabled`. Outbound pushes happen in
real time via the `CRM_WRITE` tool (Step 12) and after-call automation (guide 06);
failed outbound pushes surface in the tool result and `AuditLog`.

**File `src/worker/crm-sync.ts`:**

```ts
/**
 * CRM two-way sync worker. Run: npm run worker:crm-sync
 * Every 15 minutes: for each CrmConnection with twoWaySyncEnabled, pull updates
 * since lastSyncAt and upsert matching Contact rows. Tokens are refreshed
 * on-demand and persisted.
 */
import cron from "node-cron";
import { db } from "../lib/db";
import { getCrmProvider } from "../lib/integrations/crm";

const TICK = "*/15 * * * *";

export async function syncAll(): Promise<number> {
  const conns = await db.crmConnection.findMany({
    where: { active: true, twoWaySyncEnabled: true },
  });
  let touched = 0;
  for (const conn of conns) {
    try {
      const crm = getCrmProvider(conn.provider);
      // Refresh if expiring within 5 minutes.
      let working = conn;
      if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
        const tokens = await crm.refreshTokens(conn);
        working = await db.crmConnection.update({
          where: { id: conn.id },
          data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt },
        });
      }
      const since = conn.lastSyncAt ?? new Date(Date.now() - 24 * 3600 * 1000);
      const updates = await crm.pullUpdates(working, since);
      for (const u of updates) {
        const contact = await db.contact.findFirst({
          where: {
            workspaceId: conn.workspaceId,
            OR: [{ crmExternalId: u.externalId }, ...(u.phone ? [{ phone: u.phone }] : [])],
          },
        });
        if (contact) {
          await db.contact.update({
            where: { id: contact.id },
            data: {
              crmExternalId: u.externalId,
              ...(u.name && !contact.name ? { name: u.name } : {}),
            },
          });
          touched++;
        }
      }
      await db.crmConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
    } catch (e) {
      console.error(`[crm-sync] ${conn.provider} (${conn.workspaceId}) failed:`, e instanceof Error ? e.message : e);
    }
  }
  return touched;
}

if (require.main === module) {
  console.log(`[crm-sync] starting, schedule "${TICK}"`);
  cron.schedule(TICK, async () => {
    try {
      const n = await syncAll();
      if (n > 0) console.log(`[crm-sync] updated ${n} contact(s)`);
    } catch (e) {
      console.error("[crm-sync] tick failed:", e);
    }
  });
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx tsx -e "
import('tsx/cjs').then(async () => {
  const { syncAll } = await import('./src/worker/crm-sync');
  const n = await syncAll();
  console.log('contacts updated:', n);
  process.exit(0);
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** typecheck exit 0; `contacts updated: 0` (no two-way connections yet).
**If it fails:** fix the named line once, then STOP and report.

---

## Step 16: Template marketplace — actions (readme §15)

Public templates from ALL workspaces (`published=true`) are browsable; installing
clones into the caller's workspace as a DRAFT agent and bumps the install counter.
Cross-workspace READ of published templates is the intended exception to tenant
scoping — writes are always scoped to the caller's workspace.

**File `src/server/actions/marketplace.ts`:**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type MarketplaceResult = { ok: boolean; error?: string; id?: string };

/** Publish one of MY agents as a marketplace template. */
export async function publishTemplateAction(agentId: string, input: unknown): Promise<MarketplaceResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = z
      .object({
        name: z.string().min(3).max(80),
        industry: z.string().min(2).max(60),
        description: z.string().min(10).max(500),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the publish form fields." };

    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      include: { toolConfigs: { where: { enabled: true } } },
    });
    if (!agent) return { ok: false, error: "Agent not found." };

    const tpl = await db.marketplaceTemplate.create({
      data: {
        authorWorkspaceId: ctx.workspaceId,
        name: parsed.data.name,
        industry: parsed.data.industry,
        description: parsed.data.description,
        systemPrompt: agent.systemPrompt,
        greeting: agent.greeting,
        config: {
          voiceId: agent.voiceId,
          llmModel: agent.llmModel,
          languageMode: agent.languageMode,
          tools: agent.toolConfigs.map((t) => t.tool),
        },
        published: true,
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "marketplace.publish", entity: "MarketplaceTemplate", entityId: tpl.id,
      metadata: { agentId },
    });
    revalidatePath("/marketplace");
    return { ok: true, id: tpl.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Take MY template off the marketplace. */
export async function unpublishTemplateAction(templateId: string): Promise<MarketplaceResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const updated = await db.marketplaceTemplate.updateMany({
      where: { id: templateId, authorWorkspaceId: ctx.workspaceId },
      data: { published: false },
    });
    if (updated.count === 0) return { ok: false, error: "Template not found (only the author can unpublish)." };
    revalidatePath("/marketplace");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Install a published template into MY workspace as a new DRAFT agent. */
export async function installTemplateAction(templateId: string): Promise<MarketplaceResult> {
  try {
    const ctx = await requirePermission("agents:write");
    // Cross-workspace read is intended: only published templates.
    const tpl = await db.marketplaceTemplate.findFirst({ where: { id: templateId, published: true } });
    if (!tpl) return { ok: false, error: "Template not found." };

    const [count, sub] = await Promise.all([
      db.agent.count({ where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } } }),
      db.subscription.findUnique({ where: { workspaceId: ctx.workspaceId }, include: { plan: true } }),
    ]);
    const max = sub?.plan.maxAgents ?? 2;
    if (count >= max) {
      return { ok: false, error: `Your plan allows ${max} agents. Archive one or upgrade in Billing.` };
    }

    const cfg = (tpl.config ?? {}) as { voiceId?: string; llmModel?: string; languageMode?: string; tools?: string[] };
    const agent = await db.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: tpl.name,
          template: `marketplace:${tpl.id}`,
          greeting: tpl.greeting,
          systemPrompt: tpl.systemPrompt,
          voiceId: cfg.voiceId ?? "anushka",
          llmModel: cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct",
          languageMode: cfg.languageMode ?? "auto",
          status: "DRAFT",
        },
      });
      await tx.marketplaceTemplate.update({
        where: { id: tpl.id },
        data: { installs: { increment: 1 } },
      });
      return created;
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "marketplace.install", entity: "MarketplaceTemplate", entityId: tpl.id,
      metadata: { agentId: agent.id },
    });
    revalidatePath("/agents");
    revalidatePath("/marketplace");
    return { ok: true, id: agent.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.

---

## Step 17: Marketplace page + workspace Knowledge page + sidebar update

**File `src/app/(app)/marketplace/page.tsx`:**

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { installTemplateAction, unpublishTemplateAction } from "@/server/actions/marketplace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MarketplacePage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const templates = await db.marketplaceTemplate.findMany({
    where: { published: true },
    orderBy: [{ installs: "desc" }, { createdAt: "desc" }],
    include: { authorWorkspace: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Template marketplace</h1>
        <p className="text-sm text-muted-foreground">
          Community agent templates from all Vaani workspaces. Install → edit → publish.
        </p>
      </div>
      {templates.length === 0 ? (
        <p className="text-muted-foreground">No published templates yet — publish one of your agents from its editor page.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const mine = t.authorWorkspaceId === ctx.workspaceId;
            return (
              <Card key={t.id} data-testid={`marketplace-card-${t.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      {t.installs} installs
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.industry} · by {mine ? "your workspace" : t.authorWorkspace.name}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                  {mine ? (
                    <form
                      action={async () => {
                        "use server";
                        await unpublishTemplateAction(t.id);
                      }}
                    >
                      <Button variant="outline" size="sm" className="w-full" data-testid={`marketplace-unpublish-${t.id}`}>
                        Unpublish (yours)
                      </Button>
                    </form>
                  ) : (
                    <form
                      action={async () => {
                        "use server";
                        const res = await installTemplateAction(t.id);
                        if (res.ok && res.id) redirect(`/agents/${res.id}`);
                      }}
                    >
                      <Button size="sm" className="w-full" data-testid={`marketplace-install-${t.id}`}>
                        Install template
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**File `src/app/(app)/knowledge/page.tsx`** (workspace-shared KB documents):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { KnowledgeManager } from "./knowledge-manager";

export default async function KnowledgePage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const docs = await db.knowledgeDocument.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { agent: { select: { name: true } } },
  });
  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
    select: { id: true, name: true },
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Knowledge base</h1>
        <p className="text-sm text-muted-foreground">
          Documents your agents answer from. Documents with an agent are scoped to it;
          the rest are shared by all agents in this workspace.
        </p>
      </div>
      <KnowledgeManager docs={docs} agents={agents} />
    </div>
  );
}
```

**File `src/app/(app)/knowledge/knowledge-manager.tsx`** (client — upload/FAQ/URL
forms + status + actions; also reused on the agent editor's knowledge tab):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent, KnowledgeDocument } from "@prisma/client";
import {
  uploadKbDocumentAction,
  addFaqDocumentAction,
  addUrlDocumentAction,
  reindexDocumentAction,
  markDocIndexedAction,
  deleteKbDocumentAction,
} from "@/server/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-yellow-500/10 text-yellow-400",
  INDEXING: "bg-blue-500/10 text-blue-400",
  INDEXED: "bg-green-500/10 text-green-400",
  FAILED: "bg-red-500/10 text-red-400",
};

type DocRow = KnowledgeDocument & { agent: { name: string } | null };

export function KnowledgeManager({
  docs,
  agents,
  fixedAgentId,
}: {
  docs: DocRow[];
  agents: Pick<Agent, "id" | "name">[];
  fixedAgentId?: string; // when rendered on an agent page, scope uploads to it
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label); setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Upload PDF / DOCX</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (fixedAgentId) f.set("agentId", fixedAgentId);
                await run("upload", () => uploadKbDocumentAction(f));
                (e.target as HTMLFormElement).reset();
              }}
              className="space-y-3"
            >
              <Input name="title" placeholder="Title (e.g. Price list 2025)" required />
              <input name="file" type="file" accept=".pdf,.docx" required
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-primary-foreground" />
              {!fixedAgentId && (
                <select name="agentId" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">Shared (all agents)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <Button type="submit" size="sm" disabled={busy !== null} data-testid="kb-upload-btn">
                {busy === "upload" ? "Uploading…" : "Upload"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Paste FAQ text</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run("faq", () => addFaqDocumentAction({
                  title: f.get("title"),
                  contentText: f.get("contentText"),
                  agentId: fixedAgentId ?? (f.get("agentId") || undefined),
                  reindexIntervalHours: f.get("hours") || undefined,
                }));
                (e.target as HTMLFormElement).reset();
              }}
              className="space-y-3"
            >
              <Input name="title" placeholder="Title (e.g. Clinic FAQ)" required />
              <textarea name="contentText" required rows={4} placeholder="Q: …&#10;A: …"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
              <Input name="hours" type="number" placeholder="Re-index every N hours (optional)" min={1} max={720} />
              {!fixedAgentId && (
                <select name="agentId" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">Shared (all agents)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <Button type="submit" size="sm" disabled={busy !== null} data-testid="kb-faq-btn">Add FAQ</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Add a URL</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run("url", () => addUrlDocumentAction({
                  title: f.get("title"),
                  sourceUrl: f.get("sourceUrl"),
                  agentId: fixedAgentId ?? (f.get("agentId") || undefined),
                  reindexIntervalHours: f.get("hours") || undefined,
                }));
                (e.target as HTMLFormElement).reset();
              }}
              className="space-y-3"
            >
              <Input name="title" placeholder="Title (e.g. Pricing page)" required />
              <Input name="sourceUrl" type="url" placeholder="https://…" required />
              <Input name="hours" type="number" placeholder="Re-index every N hours (default 24)" min={1} max={720} />
              {!fixedAgentId && (
                <select name="agentId" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">Shared (all agents)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <Button type="submit" size="sm" disabled={busy !== null} data-testid="kb-url-btn">Fetch & add</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Documents ({docs.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {docs.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
          {docs.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              data-testid={`kb-doc-${d.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  {d.type} · {d.agent ? `agent: ${d.agent.name}` : "shared"} ·{" "}
                  {d.reindexIntervalHours ? `re-index every ${d.reindexIntervalHours}h` : "no schedule"}
                  {d.error ? ` · error: ${d.error.slice(0, 80)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[d.status]}`} data-testid={`kb-status-${d.id}`}>
                  {d.status}
                </span>
                {d.type === "URL" && (
                  <Button variant="ghost" size="sm" disabled={busy !== null}
                    data-testid={`kb-reindex-${d.id}`}
                    onClick={() => run("reindex", () => reindexDocumentAction(d.id))}>
                    Re-index
                  </Button>
                )}
                {d.status !== "INDEXED" && (
                  <Button variant="ghost" size="sm" disabled={busy !== null}
                    data-testid={`kb-mark-indexed-${d.id}`}
                    onClick={() => run("mark", () => markDocIndexedAction(d.id))}>
                    Mark indexed
                  </Button>
                )}
                <Button variant="destructive" size="sm" disabled={busy !== null}
                  onClick={() => run("delete", () => deleteKbDocumentAction(d.id))}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        PDF/DOCX: after uploading here, sync the same file into the agent's Knowledge
        Base in the Dograh UI (advanced flow editor link on the agent page), then click
        "Mark indexed" — OPERATOR GATE (guide 05 Step 10). FAQ/URL text is fetched and
        stored automatically.
      </p>
    </div>
  );
}
```

**File `src/app/(app)/layout.tsx`** (the app shell — sidebar + wallet; superset of
the old guide's shell: adds Marketplace + Knowledge):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money";
import {
  LayoutDashboard, Bot, PhoneOutgoing, Users, PhoneCall, Phone, BarChart3, Wallet, Settings, Store, BookOpen,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/campaigns", label: "Campaigns", icon: PhoneOutgoing },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/numbers", label: "Numbers", icon: Phone },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/billing", label: "Billing", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const wallet = await db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } });

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="p-5 text-lg font-bold">
          Vaani <span className="text-primary">AI</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-4">
          <p className="text-xs text-muted-foreground">Wallet</p>
          <p className="font-semibold text-primary">{formatINR(wallet?.balancePaise ?? 0)}</p>
          <p className="mt-2 truncate text-xs text-muted-foreground">{ctx.user.email}</p>
          <form action={logoutAction} className="mt-2">
            <Button variant="ghost" size="sm" className="w-full justify-start px-0">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** both exit 0; route table includes `/marketplace` and `/knowledge`.
**If it fails:** the compiler names the file — fix against the listings; once more,
then STOP and report.

---

## Step 18: Agents list page + template gallery (updated with test ids)

Replaces the old list page (same features + `data-testid`s + marketplace link).

**File `src/app/(app)/agents/page.tsx`:**

```tsx
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { AGENT_TEMPLATES } from "@/lib/templates";
import { createAgentFromTemplateAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  PUBLISHED: "bg-green-500/10 text-green-400",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export default async function AgentsPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
  });

  async function fromTemplate(formData: FormData) {
    "use server";
    const code = String(formData.get("template"));
    const res = await createAgentFromTemplateAction(code);
    if (res.ok && res.id) redirect(`/agents/${res.id}`);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">AI Agents</h1>
        <Button asChild data-testid="agents-new-btn"><Link href="/agents/new">New blank agent</Link></Button>
      </div>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">
          No agents yet. Start from a template below — you can be live in 30 minutes.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} data-testid={`agent-card-${a.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{a.name}</CardTitle>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>
                      {a.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p>Voice: {a.voiceId} · Lang: {a.languageMode}</p>
                  <p className="truncate">{a.llmModel}</p>
                  <p>v{a.version}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Template gallery</h2>
          <Link href="/marketplace" className="text-sm text-primary hover:underline">
            Community marketplace →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {AGENT_TEMPLATES.map((t) => (
            <Card key={t.code} data-testid={`template-card-${t.code}`}>
              <CardHeader>
                <CardTitle className="text-base">{t.name}</CardTitle>
                <p className="text-xs text-primary">{t.industry}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <form action={fromTemplate}>
                  <input type="hidden" name="template" value={t.code} />
                  <Button variant="outline" size="sm" className="w-full" data-testid={`template-use-${t.code}`}>
                    Use template
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
```

**File `src/app/(app)/agents/new/page.tsx`** (unchanged shape, one shared editor):

```tsx
import { AgentForm } from "../agent-form";

export default function NewAgentPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">New agent</h1>
      <AgentForm mode="create" />
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.

---

## Step 19: Agent editor — tabbed (general / voice / llm / knowledge / tools / versions)

One server page + one shared config form (client) + three data tabs. The config form
covers general, voice and LLM tabs (all fields save together through
`updateAgentAction`); knowledge, tools and versions tabs are independent panels.

**File `src/app/(app)/agents/[id]/page.tsx`:**

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { AgentForm } from "../agent-form";
import { VersionsTab } from "./versions-tab";
import { ToolsTab } from "./tools-tab";
import { EditorActions } from "./editor-actions";
import { KnowledgeManager } from "../../knowledge/knowledge-manager";

const TABS = ["general", "voice", "llm", "knowledge", "tools", "versions"] as const;
type Tab = (typeof TABS)[number];

export default async function EditAgentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? "")
    ? (searchParams.tab as Tab)
    : "general";

  const agent = await db.agent.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: { toolConfigs: true },
  });
  if (!agent) notFound();

  const [versions, docs, agents] = await Promise.all([
    tab === "versions"
      ? db.agentVersion.findMany({
          where: { agentId: agent.id, workspaceId: ctx.workspaceId },
          orderBy: { version: "desc" },
        })
      : Promise.resolve([]),
    tab === "knowledge"
      ? db.knowledgeDocument.findMany({
          where: { workspaceId: ctx.workspaceId, OR: [{ agentId: agent.id }, { agentId: null }] },
          orderBy: { createdAt: "desc" },
          include: { agent: { select: { name: true } } },
        })
      : Promise.resolve([]),
    tab === "knowledge"
      ? db.agent.findMany({
          where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <p className="text-sm text-muted-foreground">
            status: {agent.status} · v{agent.version}
            {agent.dograhWorkflowId ? ` · Dograh workflow ${agent.dograhWorkflowId}` : ""}
          </p>
        </div>
        <EditorActions
          agentId={agent.id}
          status={agent.status}
          published={Boolean(agent.dograhWorkflowId)}
        />
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/agents/${agent.id}?tab=${t}`}
            data-testid={`agent-tab-${t}`}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t}
          </Link>
        ))}
      </nav>

      {tab === "general" || tab === "voice" || tab === "llm" ? (
        <AgentForm mode="edit" agent={agent} section={tab} />
      ) : tab === "knowledge" ? (
        <KnowledgeManager docs={docs} agents={agents} fixedAgentId={agent.id} />
      ) : tab === "tools" ? (
        <ToolsTab agentId={agent.id} toolConfigs={agent.toolConfigs} />
      ) : (
        <VersionsTab agentId={agent.id} agentName={agent.name} versions={versions} />
      )}
    </div>
  );
}
```

**File `src/app/(app)/agents/[id]/editor-actions.tsx`** (publish / test call /
advanced editor / clone / archive — client):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  publishAgentAction,
  createTestRunAction,
  advancedEditorUrlAction,
  cloneAgentAction,
  archiveAgentAction,
} from "@/server/actions/agents";
import { Button } from "@/components/ui/button";

export function EditorActions({
  agentId,
  status,
  published,
}: {
  agentId: string;
  status: string;
  published: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; url?: string }>, openUrl = false) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(`${label} done.`);
    if (openUrl && res.url) window.open(res.url, "_blank", "noopener");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== null}
          data-testid="agent-publish-btn"
          onClick={() => run("Publish", () => publishAgentAction(agentId))}
        >
          {busy === "Publish" ? "Publishing…" : status === "PUBLISHED" ? "Publish new version" : "Publish"}
        </Button>
        <Button
          size="sm" variant="outline" disabled={busy !== null || !published}
          data-testid="agent-test-call-btn"
          title={published ? "Create a Dograh test run and open the browser call" : "Publish first"}
          onClick={() => run("Test run", () => createTestRunAction(agentId), true)}
        >
          Test call (browser)
        </Button>
        <Button
          size="sm" variant="outline" disabled={busy !== null || !published}
          data-testid="agent-advanced-editor-btn"
          title={published ? "Open Dograh's visual flow editor for this workflow" : "Publish first"}
          onClick={() => run("Open editor", () => advancedEditorUrlAction(agentId), true)}
        >
          Advanced flow editor ↗
        </Button>
        <Button
          size="sm" variant="ghost" disabled={busy !== null}
          onClick={() => run("Clone", () => cloneAgentAction(agentId))}
        >
          Clone
        </Button>
        <Button
          size="sm" variant="destructive" disabled={busy !== null}
          onClick={() => run("Archive", async () => {
            const r = await archiveAgentAction(agentId);
            if (r.ok) router.push("/agents");
            return r;
          })}
        >
          Archive
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-green-400">{notice}</p>}
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0. (The remaining tab components come in Step 19b/19c — verify
again after creating them; if typecheck complains about missing `./versions-tab` etc.,
those files are created next.)

### Step 19b: the shared config form (general + voice + llm sections)

Replaces the old `agent-form.tsx` (superset: conversation controls, guardrail toggle,
voice catalogue, per-language voice map, curated LLM list; `section` prop controls
which tab's fields are shown — all save together).

**File `src/app/(app)/agents/agent-form.tsx`:**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent } from "@prisma/client";
import { createAgentAction, updateAgentAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SARVAM_VOICES,
  SUPPORTED_LANGUAGES,
  LLM_MODELS,
  LANGUAGE_MODES,
  defaultVoiceForLanguage,
} from "@/lib/voices";
import { DEFAULT_CONTROLS, type ConversationControls } from "@/lib/workflow-builder";

type ControlsWithGuardrail = ConversationControls & { kbGuardrail?: boolean };

function controlsFrom(agent?: Agent): ControlsWithGuardrail {
  const raw = (agent?.conversationConfig ?? {}) as Partial<ControlsWithGuardrail>;
  return { ...DEFAULT_CONTROLS, ...raw, voiceMap: raw.voiceMap ?? {} };
}

export function AgentForm({
  mode,
  agent,
  section = "general",
}: {
  mode: "create" | "edit";
  agent?: Agent;
  section?: "general" | "voice" | "llm";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = controlsFrom(agent);

  function formData(e: React.FormEvent<HTMLFormElement>) {
    const f = new FormData(e.currentTarget);
    const voiceMap: Record<string, string> = {};
    for (const l of SUPPORTED_LANGUAGES) {
      const v = String(f.get(`vm-${l.code}`) ?? "");
      if (v) voiceMap[l.code] = v;
    }
    return {
      name: f.get("name"),
      greeting: f.get("greeting"),
      systemPrompt: f.get("systemPrompt"),
      languageMode: f.get("languageMode"),
      fixedLanguage: f.get("fixedLanguage") || undefined,
      voiceId: f.get("voiceId"),
      llmModel: f.get("llmModel"),
      maxCallSeconds: f.get("maxCallSeconds"),
      kbGuardrail: f.get("kbGuardrail") === "on",
      template: agent?.template ?? undefined,
      conversationConfig: {
        allowBargeIn: f.get("allowBargeIn") === "on",
        vadSensitivity: f.get("vadSensitivity") ?? "medium",
        silenceTimeoutSec: f.get("silenceTimeoutSec") ?? 20,
        fillerPhrases: String(f.get("fillerPhrases") ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean),
        speakingPace: f.get("speakingPace") ?? "normal",
        voiceMap,
      },
    };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const res =
      mode === "create"
        ? await createAgentAction(formData(e))
        : await updateAgentAction(agent!.id, formData(e));
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice("Saved.");
    router.refresh();
    if (mode === "create" && res.id) router.push(`/agents/${res.id}`);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {/* ----- general tab ----- */}
          <div className={section === "general" ? "space-y-4" : "hidden"} aria-hidden={section !== "general"}>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Agent name</span>
              <Input name="name" defaultValue={agent?.name} required={section === "general"} placeholder="Front Desk — Priya" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Greeting (first thing callers hear)</span>
              <textarea name="greeting" defaultValue={agent?.greeting} required={section === "general"} rows={2}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">System prompt (personality, rules, knowledge)</span>
              <textarea name="systemPrompt" defaultValue={agent?.systemPrompt} required={section === "general"} rows={12}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Max call length (seconds)</span>
                <Input name="maxCallSeconds" type="number" defaultValue={agent?.maxCallSeconds ?? 600} min={60} max={3600} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Silence timeout (seconds)</span>
                <Input name="silenceTimeoutSec" type="number" defaultValue={c.silenceTimeoutSec} min={5} max={120} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">VAD sensitivity</span>
                <select name="vadSensitivity" defaultValue={c.vadSensitivity}
                  className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="low">low (noisy lines)</option>
                  <option value="medium">medium (default)</option>
                  <option value="high">high (quiet callers)</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Speaking pace</span>
                <select name="speakingPace" defaultValue={c.speakingPace}
                  className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="slow">slow</option>
                  <option value="normal">normal</option>
                  <option value="fast">fast</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Filler phrases (comma-separated, spoken while thinking)</span>
              <Input name="fillerPhrases" defaultValue={(c.fillerPhrases ?? []).join(", ")} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allowBargeIn" defaultChecked={c.allowBargeIn} className="h-4 w-4" />
              Allow callers to interrupt (barge-in)
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="kbGuardrail" defaultChecked={c.kbGuardrail === true} className="mt-1 h-4 w-4"
                data-testid="agent-kb-guardrail" />
              <span>
                Knowledge-only guardrail — answer only from the knowledge base; otherwise say
                <em> "let me confirm and call you back"</em>
              </span>
            </label>
          </div>

          {/* ----- voice tab ----- */}
          <div className={section === "voice" ? "space-y-4" : "hidden"} aria-hidden={section !== "voice"}>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Language mode</span>
              <select name="languageMode" defaultValue={agent?.languageMode ?? "auto"}
                data-testid="agent-language-mode"
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                {LANGUAGE_MODES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Fixed language (only for fixed mode)</span>
              <select name="fixedLanguage" defaultValue={agent?.fixedLanguage ?? ""}
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                <option value="">—</option>
                {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Primary voice (Sarvam Bulbul v3)</span>
              <select name="voiceId" defaultValue={agent?.voiceId ?? "anushka"}
                data-testid="agent-voice-select"
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                {SARVAM_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.id} ({v.gender})</option>
                ))}
              </select>
            </label>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Per-language voice mapping — when auto-detect hears a language, switch to this voice
                (empty = use the language's recommended voice).
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SUPPORTED_LANGUAGES.map((l) => (
                  <label key={l.code} className="flex items-center justify-between gap-2 text-sm">
                    <span className="w-32">{l.label}</span>
                    <select name={`vm-${l.code}`}
                      defaultValue={c.voiceMap?.[l.code] ?? ""}
                      className="h-9 flex-1 rounded-md border border-border bg-card px-3 text-sm">
                      <option value="">auto ({defaultVoiceForLanguage(l.code)})</option>
                      {SARVAM_VOICES.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Caller-selectable mode generates a DTMF pre-flow ("Hindi ke liye 1
              dabaiye…") in the published workflow automatically.
            </p>
          </div>

          {/* ----- llm tab ----- */}
          <div className={section === "llm" ? "space-y-4" : "hidden"} aria-hidden={section !== "llm"}>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">LLM (OpenRouter) — with automatic failover chain</span>
              <select name="llmModel" defaultValue={agent?.llmModel ?? LLM_MODELS[2].id}
                data-testid="agent-llm-select"
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                {LLM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} — {m.useFor}</option>
                ))}
              </select>
            </label>
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">How to choose:</p>
              <p>· <code>:floor</code> models for simple FAQ/reminder agents (cheapest).</p>
              <p>· <code>:nitro</code> models when latency matters (&lt;800ms budget).</p>
              <p>· Premium models for complex sales conversations.</p>
              <p className="mt-1">Failover: if a provider rate-limits, the call falls back to Llama 3.1 70B → Gemini Flash → DeepSeek floor (configured in guide 04; the chain is passed per-agent on publish).</p>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-green-400">{notice}</p>}

          <Button type="submit" disabled={busy} data-testid="agent-save-btn">
            {busy ? "Saving…" : mode === "create" ? "Create agent" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0. (If `./versions-tab`/`./tools-tab` are still missing, create
them in Step 19c and re-run.)

### Step 19c: versions tab + tools tab

**File `src/app/(app)/agents/[id]/versions-tab.tsx`** (history table + rollback +
A/B + publish-as-template):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentVersion } from "@prisma/client";
import { rollbackAgentAction, createAbVariantAction, removeAbVariantAction } from "@/server/actions/agents";
import { publishTemplateAction } from "@/server/actions/marketplace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  PUBLISHED: "bg-green-500/10 text-green-400",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function VersionsTab({
  agentId,
  agentName,
  versions,
}: {
  agentId: string;
  agentName: string;
  versions: AgentVersion[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(`${label} done.`);
    router.refresh();
  }

  const published = versions.filter((v) => v.status === "PUBLISHED" && !v.isAbVariant);
  const abVariant = versions.find((v) => v.isAbVariant && v.status === "PUBLISHED");
  const mainLive = published[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No versions yet — hit "Publish" to freeze v1 and push it to the voice engine.
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="version-history-table">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Version</th>
                  <th>Status</th>
                  <th>Traffic</th>
                  <th>Published</th>
                  <th>Dograh wf</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-t border-border" data-testid={`version-row-${v.version}`}>
                    <td className="py-2">
                      v{v.version}
                      {v.isAbVariant ? " (A/B)" : ""}
                      {v.label ? <span className="block text-xs text-muted-foreground">{v.label}</span> : null}
                    </td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[v.status]}`}>{v.status}</span></td>
                    <td>{v.isAbVariant ? `${v.abTrafficPercent ?? 0}%` : v.status === "PUBLISHED" && !abVariant ? "100%" : "—"}</td>
                    <td className="text-xs text-muted-foreground">
                      {v.publishedAt ? new Date(v.publishedAt).toLocaleString("en-IN") : "—"}
                    </td>
                    <td className="text-xs text-muted-foreground">{v.dograhWorkflowId ?? "—"}</td>
                    <td className="text-right">
                      {!v.isAbVariant && v.status !== "PUBLISHED" && (
                        <Button size="sm" variant="outline" disabled={busy !== null}
                          data-testid={`version-rollback-${v.version}`}
                          onClick={() => run(`Rollback to v${v.version}`, () => rollbackAgentAction(agentId, v.id))}>
                          Roll back to this
                        </Button>
                      )}
                      {v.isAbVariant && v.status === "PUBLISHED" && (
                        <Button size="sm" variant="destructive" disabled={busy !== null}
                          data-testid="ab-remove-btn"
                          onClick={() => run("End A/B test", () => removeAbVariantAction(agentId, v.id))}>
                          End A/B test
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {notice && <p className="mt-2 text-sm text-green-400">{notice}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">A/B test (two published variants)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {abVariant ? (
            <p className="text-sm text-muted-foreground">
              A/B running: v{abVariant.version} serves {abVariant.abTrafficPercent}% of calls
              (deterministic per caller). Routing happens at call-start — guides 06/07 use
              `resolveAgentForCall()` from `src/lib/ab-test.ts`.
            </p>
          ) : mainLive ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run("Create A/B variant", () => createAbVariantAction(agentId, {
                  fromVersionId: mainLive.id,
                  abTrafficPercent: f.get("pct"),
                  label: f.get("label") || undefined,
                  systemPrompt: f.get("systemPrompt") || undefined,
                  greeting: f.get("greeting") || undefined,
                }));
              }}
              className="space-y-3"
            >
              <p className="text-sm text-muted-foreground">
                Clone the live version (v{mainLive.version}) as a variant with a different
                prompt/greeting. Callers are bucketed deterministically by phone number.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">Variant traffic %</span>
                  <Input name="pct" type="number" min={1} max={99} defaultValue={20} required data-testid="ab-traffic-input" />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">Label</span>
                  <Input name="label" placeholder="e.g. shorter greeting" />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Variant greeting (optional override)</span>
                <textarea name="greeting" rows={2} className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Variant system prompt (optional override)</span>
                <textarea name="systemPrompt" rows={5} className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono" />
              </label>
              <Button size="sm" disabled={busy !== null} data-testid="ab-create-btn">Create A/B variant</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Publish a version first — A/B needs a live version to clone.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Publish as marketplace template</CardTitle></CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run("Publish template", () => publishTemplateAction(agentId, {
                name: f.get("tplName"), industry: f.get("tplIndustry"), description: f.get("tplDescription"),
              }));
              (e.target as HTMLFormElement).reset();
            }}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="tplName" defaultValue={agentName} required data-testid="marketplace-publish-name" />
              <Input name="tplIndustry" placeholder="Industry (e.g. Healthcare)" required />
            </div>
            <textarea name="tplDescription" rows={2} required placeholder="What does this agent do?"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
            <Button size="sm" variant="outline" disabled={busy !== null} data-testid="marketplace-publish-btn">
              Publish to marketplace
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/agents/[id]/tools-tab.tsx`** (8 tool sections + dry-run tests):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentToolConfig, AgentToolType } from "@prisma/client";
import { upsertToolConfigAction, testToolAction } from "@/server/actions/tools";
import { TOOL_META } from "@/lib/tool-configs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** One config field schema per tool (drives simple inputs; CUSTOM_WEBHOOK uses JSON). */
const FIELDS: Record<AgentToolType, { name: string; label: string; kind: "text" | "number" | "checkbox" | "json" }[]> = {
  CALENDAR_BOOKING: [
    { name: "provider", label: "provider (google | microsoft | calendly | calcom)", kind: "text" },
    { name: "calendarId", label: "calendar id (google: 'primary')", kind: "text" },
    { name: "slotMinutes", label: "slot length (minutes)", kind: "number" },
    { name: "eventTitle", label: "event title", kind: "text" },
  ],
  HUMAN_TRANSFER: [
    { name: "queue", label: "queue (e.g. support, sales)", kind: "text" },
    { name: "skill", label: "skill (e.g. hindi, loans)", kind: "text" },
    { name: "fallbackNumber", label: "fallback transfer number (E.164, optional)", kind: "text" },
    { name: "whisperSummary", label: "whisper call summary to the human", kind: "checkbox" },
  ],
  SMS: [{ name: "messageTemplate", label: "message template ({{name}} {{details}} {{business_name}})", kind: "text" }],
  WHATSAPP: [
    { name: "templateName", label: "approved WhatsApp template name", kind: "text" },
    { name: "paramsHint", label: "parameter hint (what to fill)", kind: "text" },
  ],
  CRM_WRITE: [
    { name: "provider", label: "CRM (HUBSPOT | ZOHO …, empty = any connected)", kind: "text" },
    { name: "objectType", label: "object type (contact | lead)", kind: "text" },
    { name: "logCallOutcome", label: "log call outcome to CRM", kind: "checkbox" },
  ],
  PAYMENT_LINK: [
    { name: "amountPaise", label: "fixed amount in paise (optional; else asked on call)", kind: "number" },
    { name: "description", label: "payment description", kind: "text" },
    { name: "sendVia", label: "send link via (whatsapp | sms | readout)", kind: "text" },
  ],
  CUSTOM_WEBHOOK: [
    { name: "url", label: "endpoint URL", kind: "text" },
    { name: "method", label: "method (POST | GET)", kind: "text" },
    { name: "authHeader", label: "Authorization header value (optional)", kind: "text" },
    { name: "responseMapping", label: 'response mapping JSON, e.g. {"status":"data.order.status"}', kind: "json" },
  ],
  VOICEMAIL: [
    { name: "transcribe", label: "transcribe messages", kind: "checkbox" },
    { name: "notifyEmail", label: "notify email (optional)", kind: "text" },
  ],
};

export function ToolsTab({ agentId, toolConfigs }: { agentId: string; toolConfigs: AgentToolConfig[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; output?: string }>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(res.output ? `${label} OK:\n${res.output}` : `${label} done.`);
    router.refresh();
  }

  function readForm(form: HTMLFormElement, tool: AgentToolType) {
    const f = new FormData(form);
    const existing = toolConfigs.find((t) => t.tool === tool);
    const config: Record<string, unknown> = { ...((existing?.config ?? {}) as Record<string, unknown>) };
    for (const field of FIELDS[tool]) {
      if (field.kind === "checkbox") {
        config[field.name] = f.get(field.name) === "on";
      } else if (field.kind === "number") {
        const raw = String(f.get(field.name) ?? "");
        config[field.name] = raw === "" ? undefined : Number(raw);
      } else if (field.kind === "json") {
        const raw = String(f.get(field.name) ?? "").trim();
        if (raw) {
          try {
            config[field.name] = JSON.parse(raw);
          } catch {
            throw new Error(`Invalid JSON in "${field.label}".`);
          }
        }
      } else {
        const raw = String(f.get(field.name) ?? "");
        if (raw !== "") config[field.name] = raw;
      }
    }
    return { enabled: f.get("enabled") === "on", config };
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tools the agent can trigger mid-call. Saved tools are wired into the workflow
        on the next Publish. "Test tool" dry-runs the same executor used in live calls
        (VAANI_DRY_RUN=true — nothing is actually sent or charged).
      </p>
      {error && <p className="whitespace-pre-wrap text-sm text-red-400">{error}</p>}
      {notice && <p className="whitespace-pre-wrap text-sm text-green-400">{notice}</p>}
      {TOOL_META.map((meta) => {
        const row = toolConfigs.find((t) => t.tool === meta.tool);
        const cfg = (row?.config ?? {}) as Record<string, unknown>;
        return (
          <Card key={meta.tool} data-testid={`tool-section-${meta.tool}`}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{meta.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{meta.tool}</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const data = readForm(e.currentTarget, meta.tool);
                    await run(`Save ${meta.tool}`, () => upsertToolConfigAction(agentId, { tool: meta.tool, ...data }));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Check the form.");
                  }
                }}
                className="space-y-3"
              >
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? false}
                    className="h-4 w-4" data-testid={`tool-enable-${meta.tool}`} />
                  Enabled
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS[meta.tool].map((field) =>
                    field.kind === "checkbox" ? (
                      <label key={field.name} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name={field.name} defaultChecked={cfg[field.name] === true} className="h-4 w-4" />
                        {field.label}
                      </label>
                    ) : (
                      <label key={field.name} className="block space-y-1">
                        <span className="text-xs text-muted-foreground">{field.label}</span>
                        {field.kind === "json" ? (
                          <textarea name={field.name} rows={2}
                            defaultValue={cfg[field.name] ? JSON.stringify(cfg[field.name]) : ""}
                            className="w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs" />
                        ) : (
                          <Input name={field.name} type={field.kind === "number" ? "number" : "text"}
                            defaultValue={cfg[field.name] !== undefined ? String(cfg[field.name]) : ""} />
                        )}
                      </label>
                    ),
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" type="submit" disabled={busy !== null} data-testid={`tool-save-${meta.tool}`}>
                    Save {meta.label}
                  </Button>
                  {meta.testable && (
                    <Button size="sm" variant="outline" type="button" disabled={busy !== null}
                      data-testid={`tool-test-${meta.tool}`}
                      onClick={() => run(`Test ${meta.tool}`, () => testToolAction(agentId, meta.tool))}>
                      Test tool (dry run)
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Transfer queue UI is guide 06; campaign usage of agents is guide 07; payment
        links are Razorpay test-mode (VAANI_DRY_RUN). CRM_WRITE needs a connected CRM
        (Settings → Integrations).
      </p>
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** both exit 0; route table includes `/agents/[id]`.
**If it fails:** the compiler names the file/line — fix against the listings; once
more, then STOP and report.

---

## Step 20: Settings → Integrations page (CRM + calendar connections UI)

**File `src/app/(app)/settings/integrations/page.tsx`:**

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CRM_PROVIDERS, FIELD_MAPPING_PRESETS } from "@/lib/integrations/crm";
import { IntegrationsManager } from "./integrations-manager";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const [crmConns, calConns] = await Promise.all([
    db.crmConnection.findMany({ where: { workspaceId: ctx.workspaceId } }),
    db.calendarConnection.findMany({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          CRM (two-way lead sync) and calendar (appointment booking) connections for
          this workspace.
        </p>
      </div>
      {searchParams.connected && (
        <p className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-400">
          Connected: {searchParams.connected}
        </p>
      )}
      {searchParams.error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{searchParams.error}</p>
      )}
      <IntegrationsManager
        crmProviders={CRM_PROVIDERS}
        crmConnections={crmConns.map((c) => ({
          provider: c.provider,
          active: c.active,
          twoWaySyncEnabled: c.twoWaySyncEnabled,
          lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
          fieldMapping: (c.fieldMapping as Record<string, string> | null) ?? FIELD_MAPPING_PRESETS[c.provider] ?? {},
        }))}
        calendarConnections={calConns.map((c) => ({
          provider: c.provider,
          active: c.active,
          accountEmail: c.accountEmail,
          primaryCalendarId: c.primaryCalendarId,
        }))}
      />
    </div>
  );
}
```

**File `src/app/(app)/settings/integrations/integrations-manager.tsx`** (client):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  disconnectCrmAction,
  updateCrmFieldMappingAction,
  toggleCrmTwoWaySyncAction,
  testCrmConnectionAction,
  disconnectCalendarAction,
} from "@/server/actions/integrations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CrmConnRow = {
  provider: string;
  active: boolean;
  twoWaySyncEnabled: boolean;
  lastSyncAt: string | null;
  fieldMapping: Record<string, string>;
};

const CALENDAR_PROVIDERS = [
  { provider: "GOOGLE", label: "Google Calendar", implemented: true },
  { provider: "MICROSOFT", label: "Microsoft 365", implemented: false },
  { provider: "CALENDLY", label: "Calendly", implemented: false },
  { provider: "CALCOM", label: "Cal.com", implemented: false },
];

export function IntegrationsManager({
  crmProviders,
  crmConnections,
  calendarConnections,
}: {
  crmProviders: { provider: string; label: string; implemented: boolean }[];
  crmConnections: CrmConnRow[];
  calendarConnections: { provider: string; active: boolean; accountEmail: string | null; primaryCalendarId: string | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; output?: string }>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(res.output ?? `${label} done.`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="whitespace-pre-wrap text-sm text-green-400">{notice}</p>}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">CRM</h2>
        {crmProviders.map((p) => {
          const conn = crmConnections.find((c) => c.provider === p.provider);
          const connected = conn?.active === true;
          return (
            <Card key={p.provider} data-testid={`crm-card-${p.provider}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{p.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${connected ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {connected ? "CONNECTED" : p.implemented ? "NOT CONNECTED" : "V2 — OPERATOR GATE"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {!connected ? (
                    <Button size="sm" asChild={p.implemented} disabled={!p.implemented}
                      data-testid={`crm-connect-${p.provider}`}>
                      {p.implemented ? (
                        <a href={`/api/integrations/crm/${p.provider.toLowerCase()}/connect`}>Connect {p.label}</a>
                      ) : (
                        <span>Connect (guide 05 Step 13 gate)</span>
                      )}
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" disabled={busy !== null}
                        data-testid={`crm-test-${p.provider}`}
                        onClick={() => run(`Test ${p.label}`, () => testCrmConnectionAction(p.provider))}>
                        Test connection
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy !== null}
                        data-testid={`crm-disconnect-${p.provider}`}
                        onClick={() => run(`Disconnect ${p.label}`, () => disconnectCrmAction(p.provider))}>
                        Disconnect
                      </Button>
                    </>
                  )}
                </div>
                {connected && conn && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" defaultChecked={conn.twoWaySyncEnabled}
                        data-testid={`crm-twoway-${p.provider}`}
                        onChange={(e) => run("Toggle sync", () => toggleCrmTwoWaySyncAction(p.provider, e.target.checked))}
                        className="h-4 w-4" />
                      Two-way sync (pull CRM changes into Contacts every 15 min)
                      {conn.lastSyncAt && (
                        <span className="text-xs text-muted-foreground">
                          last sync {new Date(conn.lastSyncAt).toLocaleString("en-IN")}
                        </span>
                      )}
                    </label>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        run("Save mapping", () => updateCrmFieldMappingAction(p.provider, String(f.get("mapping"))));
                      }}
                      className="space-y-2"
                    >
                      <span className="text-xs text-muted-foreground">
                        Field mapping (our key → {p.label} property). Keys: contact.name,
                        contact.phone, contact.email, contact.note, call.outcome
                      </span>
                      <textarea name="mapping" rows={5} defaultValue={JSON.stringify(conn.fieldMapping, null, 2)}
                        data-testid={`crm-mapping-${p.provider}`}
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs" />
                      <Button size="sm" variant="outline" disabled={busy !== null}>Save mapping</Button>
                    </form>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Calendar</h2>
        {CALENDAR_PROVIDERS.map((p) => {
          const conn = calendarConnections.find((c) => c.provider === p.provider);
          const connected = conn?.active === true;
          return (
            <Card key={p.provider} data-testid={`calendar-card-${p.provider}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{p.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${connected ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {connected ? `CONNECTED${conn?.primaryCalendarId ? ` · ${conn.primaryCalendarId}` : ""}` : p.implemented ? "NOT CONNECTED" : "V2 — OPERATOR GATE"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!connected ? (
                  <Button size="sm" asChild={p.implemented} disabled={!p.implemented}
                    data-testid={`calendar-connect-${p.provider}`}>
                    {p.implemented ? (
                      <a href="/api/integrations/calendar/google/connect">Connect {p.label}</a>
                    ) : (
                      <span>Connect (guide 05 Step 9 gate — src/lib/calendar.ts)</span>
                    )}
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" disabled={busy !== null}
                    data-testid={`calendar-disconnect-${p.provider}`}
                    onClick={() => run(`Disconnect ${p.label}`, () => disconnectCalendarAction(p.provider))}>
                    Disconnect
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
```

**Add a link on the settings home** — **Edit `src/app/(app)/settings/page.tsx`** (if it
exists from an earlier guide): add an integrations card/link to
`/settings/integrations`. If no settings page exists yet, create
`src/app/(app)/settings/page.tsx`:

```tsx
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Link href="/settings/integrations" data-testid="settings-integrations-link">
        <Card className="transition-colors hover:border-primary/50">
          <CardHeader><CardTitle className="text-base">Integrations</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            CRM (HubSpot, Zoho, …) and calendar (Google, …) connections.
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** both exit 0; route table includes `/settings/integrations`.
**If it fails:** if `src/app/(app)/settings/page.tsx` already existed with different
content, ADD the integrations link to it instead of replacing; then re-run. Compiler
errors → fix the named line once, then STOP and report.

---

## Step 21: Vitest unit suites (all pure logic + mocked boundaries)

**File `tests/workflow-builder.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import {
  buildAgentWorkflow,
  validateWorkflowDefinition,
  buildCallerSelectPreflow,
  buildToolPromptSection,
  buildControlsPromptSection,
  KB_GUARDRAIL_PROMPT,
  DEFAULT_CONTROLS,
  type WorkflowSpec,
} from "../src/lib/workflow-builder";
import { AGENT_TEMPLATES } from "../src/lib/templates";

function spec(overrides: Partial<WorkflowSpec> = {}): WorkflowSpec {
  return {
    name: "Test Agent",
    greeting: "Namaste!",
    systemPrompt: "You are a helpful test agent with enough prompt text.",
    languageMode: "auto",
    fixedLanguage: null,
    voiceId: "anushka",
    llmModel: "meta-llama/llama-3.1-70b-instruct",
    llmFallbacks: ["google/gemini-flash-1.5"],
    maxCallSeconds: 600,
    controls: { ...DEFAULT_CONTROLS },
    kbGuardrail: false,
    tools: [],
    ...overrides,
  };
}

describe("buildAgentWorkflow — structure", () => {
  it("produces a valid definition: 1 startCall, agentNode(s), webhook, endCall", () => {
    const def = buildAgentWorkflow(spec());
    const r = validateWorkflowDefinition(def);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(def.nodes.map((n) => n.type)).toContain("webhook");
  });

  it("EVERY industry template generates a valid workflow", () => {
    for (const t of AGENT_TEMPLATES) {
      const def = buildAgentWorkflow(
        spec({
          name: t.name,
          greeting: t.greeting,
          systemPrompt: t.systemPrompt,
          voiceId: t.suggestedVoice,
          llmModel: t.suggestedLlm,
          tools: t.suggestedTools.map((tool) => ({ tool, config: {} })),
        }),
      );
      const r = validateWorkflowDefinition(def);
      expect(r.errors, `template ${t.code}`).toEqual([]);
      expect(r.valid, `template ${t.code}`).toBe(true);
    }
  });

  it("caller-select mode inserts the DTMF language pre-flow before the agent", () => {
    const def = buildAgentWorkflow(spec({ languageMode: "caller-select" }));
    const lang = def.nodes.find((n) => n.id === "lang-1");
    expect(lang).toBeDefined();
    expect(String(lang!.data.prompt)).toContain("dabaiye");
    expect(def.edges.some((e) => e.source === "start-1" && e.target === "lang-1")).toBe(true);
    expect(def.edges.some((e) => e.source === "lang-1" && e.target === "agent-1")).toBe(true);
    // and NO direct start→agent edge in caller-select mode
    expect(def.edges.some((e) => e.source === "start-1" && e.target === "agent-1")).toBe(false);
  });

  it("fixed mode pins the language in the prompt and STT hint", () => {
    const def = buildAgentWorkflow(spec({ languageMode: "fixed", fixedLanguage: "ta" }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect(String(agent.data.prompt)).toContain('"ta"');
    expect((agent.data.stt as { language_code: string }).language_code).toBe("ta");
  });

  it("auto mode uses Saarika language_code 'unknown'", () => {
    const def = buildAgentWorkflow(spec({ languageMode: "auto" }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect((agent.data.stt as { language_code: string }).language_code).toBe("unknown");
  });

  it("KB guardrail injects the guardrail module into the prompt", () => {
    const def = buildAgentWorkflow(spec({ kbGuardrail: true }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect(String(agent.data.prompt)).toContain("let me confirm and call you back");
    expect(String(agent.data.prompt)).toContain(KB_GUARDRAIL_PROMPT.slice(0, 40));
  });

  it("booking + transfer tools create specialist handoff nodes (multi-agent flow)", () => {
    const def = buildAgentWorkflow(
      spec({ tools: [{ tool: "CALENDAR_BOOKING", config: {} }, { tool: "HUMAN_TRANSFER", config: { queue: "sales" } }] }),
    );
    expect(def.nodes.some((n) => n.id === "booking-1")).toBe(true);
    expect(def.nodes.some((n) => n.id === "transfer-1")).toBe(true);
    expect(def.edges.some((e) => e.source === "agent-1" && e.target === "booking-1")).toBe(true);
    expect(def.edges.some((e) => e.source === "agent-1" && e.target === "transfer-1")).toBe(true);
    const r = validateWorkflowDefinition(def);
    expect(r.valid).toBe(true);
  });

  it("per-agent voice/LLM hints land on the agent node", () => {
    const def = buildAgentWorkflow(spec({ voiceId: "kavya", llmModel: "deepseek/deepseek-chat:floor" }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect((agent.data.tts as { voice_id: string }).voice_id).toBe("kavya");
    expect((agent.data.llm as { model: string }).model).toBe("deepseek/deepseek-chat:floor");
    expect((agent.data.llm as { fallbacks: string[] }).fallbacks).toContain("google/gemini-flash-1.5");
  });

  it("barge-in control maps to allow_interrupt", () => {
    const off = buildAgentWorkflow(spec({ controls: { ...DEFAULT_CONTROLS, allowBargeIn: false } }));
    expect(off.nodes.find((n) => n.id === "agent-1")!.data.allow_interrupt).toBe(false);
  });
});

describe("prompt modules", () => {
  it("buildCallerSelectPreflow enumerates languages with DTMF digits", () => {
    const { node } = buildCallerSelectPreflow([
      { code: "hi", label: "Hindi" },
      { code: "ta", label: "Tamil" },
    ]);
    expect(String(node.data.prompt)).toContain("Hindi ke liye 1 dabaiye");
    expect(String(node.data.prompt)).toContain("Tamil ke liye 2 dabaiye");
  });

  it("buildToolPromptSection lists only enabled tools", () => {
    const s = buildToolPromptSection([{ tool: "PAYMENT_LINK", config: {} }]);
    expect(s).toContain("PAYMENT COLLECTION");
    expect(s).not.toContain("TRANSFER TO HUMAN");
    expect(buildToolPromptSection([])).toBe("");
  });

  it("buildControlsPromptSection reflects pace + fillers + silence", () => {
    const s = buildControlsPromptSection({ ...DEFAULT_CONTROLS, speakingPace: "slow", silenceTimeoutSec: 30 });
    expect(s).toContain("slowly");
    expect(s).toContain("30 seconds");
  });
});
```

**File `tests/versions.test.ts`:**

```ts
import { describe, expect, it, vi } from "vitest";
import { snapshotAgent, nextVersionNumber, validateAbSplit } from "../src/lib/versions";

describe("snapshotAgent", () => {
  it("freezes prompt, greeting and full config including tools", () => {
    const snap = snapshotAgent({
      systemPrompt: "sp",
      greeting: "g",
      voiceId: "anushka",
      llmModel: "m",
      languageMode: "auto",
      fixedLanguage: null,
      maxCallSeconds: 600,
      conversationConfig: { allowBargeIn: true },
      toolConfigs: [{ tool: "SMS", config: { messageTemplate: "x" } }],
    });
    expect(snap.systemPrompt).toBe("sp");
    expect(snap.config.tools).toEqual([{ tool: "SMS", config: { messageTemplate: "x" } }]);
    expect(snap.config.voiceId).toBe("anushka");
  });
});

describe("nextVersionNumber", () => {
  it("is max+1, starting at 1", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([{ version: 1 }, { version: 3 }])).toBe(4);
  });
});

describe("validateAbSplit", () => {
  it("rejects a second variant and out-of-range percents", () => {
    expect(validateAbSplit({ existingAbVariants: [{ id: "x" }], trafficPercent: 20 }).ok).toBe(false);
    expect(validateAbSplit({ existingAbVariants: [], trafficPercent: 0 }).ok).toBe(false);
    expect(validateAbSplit({ existingAbVariants: [], trafficPercent: 100 }).ok).toBe(false);
    expect(validateAbSplit({ existingAbVariants: [], trafficPercent: 50 }).ok).toBe(true);
  });
});

/**
 * Publish → new version → rollback sequencing, with the Dograh client MOCKED.
 * Mirrors the transitions in publishAgentAction / rollbackAgentAction
 * (src/server/actions/agents.ts) without Next.js runtime or a database.
 */
describe("publish/rollback sequencing (mocked Dograh)", () => {
  it("publish freezes v1, publish again freezes v2, rollback re-publishes v1", async () => {
    const dograh = { create: vi.fn(), update: vi.fn(), publish: vi.fn() };
    let wfCounter = 0;
    dograh.create.mockImplementation(() => ({ id: ++wfCounter, workflow_uuid: `uuid-${wfCounter}` }));

    type V = { version: number; status: string; dograhWorkflowId: string | null };
    const versions: V[] = [];

    // publish v1
    versions.push({ version: nextVersionNumber(versions), status: "PUBLISHED", dograhWorkflowId: String((dograh.create()).id) });
    // publish v2 (new Dograh workflow per version)
    versions.push({ version: nextVersionNumber(versions), status: "PUBLISHED", dograhWorkflowId: String((dograh.create()).id) });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1].dograhWorkflowId).toBe("2");

    // rollback to v1: archive all published, flip v1 back, re-publish its workflow
    for (const v of versions) if (v.status === "PUBLISHED") v.status = "ARCHIVED";
    const target = versions[0];
    dograh.update(Number(target.dograhWorkflowId), {});
    dograh.publish(Number(target.dograhWorkflowId));
    target.status = "PUBLISHED";

    expect(dograh.update).toHaveBeenCalledWith(1, {});
    expect(dograh.publish).toHaveBeenCalledWith(1);
    expect(versions[0].status).toBe("PUBLISHED");
    expect(versions[1].status).toBe("ARCHIVED");
    // after rollback, a subsequent publish continues numbering at v3
    expect(nextVersionNumber(versions)).toBe(3);
  });
});
```

**File `tests/ab.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { abBucket, resolveServingVersion, resolveAgentForCall, type AbCandidate } from "../src/lib/ab-test";

const pubs = (pct: number): AbCandidate[] => [
  { id: "main", isAbVariant: false, abTrafficPercent: null, dograhWorkflowId: "1", dograhWorkflowUuid: "u1" },
  { id: "var", isAbVariant: true, abTrafficPercent: pct, dograhWorkflowId: "2", dograhWorkflowUuid: "u2" },
];

describe("abBucket", () => {
  it("is deterministic and within 0..99", () => {
    const b = abBucket("agent1", "+919900000001");
    expect(b).toBe(abBucket("agent1", "+919900000001"));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });

  it("different agents bucket the same phone differently (usually)", () => {
    expect(abBucket("a", "p") !== abBucket("b", "p") || abBucket("a", "p2") !== abBucket("b", "p2")).toBe(true);
  });
});

describe("resolveServingVersion", () => {
  it("same caller always gets the same variant", () => {
    const a = resolveServingVersion(pubs(50), "agent1", "+919900000042")!.id;
    for (let i = 0; i < 10; i++) {
      expect(resolveServingVersion(pubs(50), "agent1", "+919900000042")!.id).toBe(a);
    }
  });

  it("0% variant always serves main; no phone serves main", () => {
    for (let i = 0; i < 20; i++) {
      expect(resolveServingVersion(pubs(0), "agent1", `+9199000000${i}`)!.id).toBe("main");
    }
    expect(resolveServingVersion(pubs(50), "agent1")!.id).toBe("main");
  });

  it("rough split at 50% over many callers", () => {
    let variant = 0;
    const n = 500;
    for (let i = 0; i < n; i++) {
      if (resolveServingVersion(pubs(50), "agent1", `+9199${String(i).padStart(8, "0")}`)!.id === "var") variant++;
    }
    expect(variant).toBeGreaterThan(n * 0.35);
    expect(variant).toBeLessThan(n * 0.65);
  });
});

describe("resolveAgentForCall", () => {
  it("returns workflow ids of the chosen version; null when nothing published", () => {
    const r = resolveAgentForCall({ agentId: "agent1", callerPhone: "+919900000001", publishedVersions: pubs(100) });
    // 100% variant → the variant's workflow
    expect(r).toEqual({ versionId: "var", dograhWorkflowId: "2", dograhWorkflowUuid: "u2" });
    expect(resolveAgentForCall({ agentId: "a", publishedVersions: [] })).toBeNull();
    expect(
      resolveAgentForCall({
        agentId: "a",
        publishedVersions: [{ id: "x", isAbVariant: false, abTrafficPercent: null, dograhWorkflowId: null, dograhWorkflowUuid: null }],
      }),
    ).toBeNull();
  });
});
```

**File `tests/voices.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import {
  SARVAM_VOICES,
  SUPPORTED_LANGUAGES,
  resolveVoiceForLanguage,
  defaultVoiceForLanguage,
  llmFallbackChain,
  LLM_MODELS,
  getVoice,
} from "../src/lib/voices";
import { AGENT_TEMPLATES } from "../src/lib/templates";

describe("voice catalogue", () => {
  it("has 39 unique voices", () => {
    expect(SARVAM_VOICES.length).toBe(39);
    expect(new Set(SARVAM_VOICES.map((v) => v.id)).size).toBe(39);
  });

  it("every template references a real voice and a real LLM", () => {
    for (const t of AGENT_TEMPLATES) {
      expect(getVoice(t.suggestedVoice), t.code).toBeDefined();
      expect(LLM_MODELS.some((m) => m.id === t.suggestedLlm), t.code).toBeDefined();
    }
  });

  it("11 supported languages", () => {
    expect(SUPPORTED_LANGUAGES.length).toBe(11);
  });
});

describe("resolveVoiceForLanguage", () => {
  it("uses the map for known languages, falls back otherwise", () => {
    const map = { ta: "kavya", hi: "ritu" };
    expect(resolveVoiceForLanguage(map, "ta", "anushka")).toBe("kavya");
    expect(resolveVoiceForLanguage(map, "bn", "anushka")).toBe("anushka");
    expect(resolveVoiceForLanguage(null, "ta", "anushka")).toBe("anushka");
    expect(resolveVoiceForLanguage(map, null, "anushka")).toBe("anushka");
    // garbage ids in the map are ignored
    expect(resolveVoiceForLanguage({ ta: "not-a-voice" }, "ta", "anushka")).toBe("anushka");
  });

  it("defaultVoiceForLanguage always returns a catalogue voice", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      expect(getVoice(defaultVoiceForLanguage(l.code))).toBeDefined();
    }
  });
});

describe("llmFallbackChain", () => {
  it("always includes the floor model and never duplicates", () => {
    for (const m of LLM_MODELS) {
      const chain = llmFallbackChain(m.id);
      expect(chain[0]).toBe(m.id);
      expect(chain).toContain("deepseek/deepseek-chat:floor");
      expect(chain).toContain("meta-llama/llama-3.1-70b-instruct");
      expect(new Set(chain).size).toBe(chain.length);
    }
  });
});
```

**File `tests/tool-configs.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { validateToolConfig, resolveJsonPath, applyResponseMapping, TOOL_META } from "../src/lib/tool-configs";

describe("validateToolConfig", () => {
  it("applies defaults for empty config", () => {
    const r = validateToolConfig("CALENDAR_BOOKING", {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.config as { provider: string }).provider).toBe("google");
      expect((r.config as { slotMinutes: number }).slotMinutes).toBe(30);
    }
  });

  it("rejects invalid CUSTOM_WEBHOOK (no URL) and accepts a valid one", () => {
    expect(validateToolConfig("CUSTOM_WEBHOOK", {}).ok).toBe(false);
    expect(validateToolConfig("CUSTOM_WEBHOOK", { url: "https://example.com/hook" }).ok).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(validateToolConfig("CALENDAR_BOOKING", { slotMinutes: 5 }).ok).toBe(false);
    expect(validateToolConfig("PAYMENT_LINK", { amountPaise: 50 }).ok).toBe(false);
  });

  it("accepts all 8 tools with valid configs", () => {
    const valid: Record<string, unknown>[] = [
      {}, // CALENDAR_BOOKING
      { queue: "sales" }, // HUMAN_TRANSFER
      { messageTemplate: "Hi {{name}}" }, // SMS
      { templateName: "booking_confirm" }, // WHATSAPP
      { provider: "HUBSPOT" }, // CRM_WRITE
      { amountPaise: 150000 }, // PAYMENT_LINK
      { url: "https://example.com" }, // CUSTOM_WEBHOOK
      { transcribe: true }, // VOICEMAIL
    ];
    TOOL_META.forEach((meta, i) => {
      expect(validateToolConfig(meta.tool, valid[i]).ok, meta.tool).toBe(true);
    });
  });
});

describe("response mapping", () => {
  const body = { data: { order: { status: "shipped", id: "O1" } }, ok: true };
  it("resolveJsonPath walks dotted paths", () => {
    expect(resolveJsonPath(body, "data.order.status")).toBe("shipped");
    expect(resolveJsonPath(body, "data.missing.deep")).toBeUndefined();
  });
  it("applyResponseMapping projects only mapped fields", () => {
    const out = applyResponseMapping({ status: "data.order.status", id: "data.order.id" }, body);
    expect(out).toEqual({ status: "shipped", id: "O1" });
  });
});
```

**File `tests/crm-mapping.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import {
  applyFieldMapping,
  validateFieldMapping,
  splitName,
  FIELD_MAPPING_PRESETS,
} from "../src/lib/integrations/crm/index";

const lead = { name: "Ravi Kumar", phone: "+919900000001", email: "r@x.in", note: "wants 2BHK", outcome: "qualified" };

describe("applyFieldMapping", () => {
  it("maps canonical keys to CRM properties, skipping empties", () => {
    const out = applyFieldMapping(FIELD_MAPPING_PRESETS.HUBSPOT, lead);
    expect(out.firstname).toBe("Ravi Kumar");
    expect(out.phone).toBe("+919900000001");
    expect(out.hs_lead_status).toBe("qualified");
  });

  it("omits missing values and ignores unknown canonical keys", () => {
    const out = applyFieldMapping(
      { "contact.email": "email", "bogus.key": "x" } as Record<string, string>,
      { name: "A", phone: "+91" },
    );
    expect(out).toEqual({});
  });

  it("null mapping → empty object", () => {
    expect(applyFieldMapping(null, lead)).toEqual({});
  });
});

describe("validateFieldMapping", () => {
  it("accepts canonical keys, rejects others", () => {
    expect(validateFieldMapping({ "contact.phone": "phone" }).ok).toBe(true);
    expect(validateFieldMapping({ "contact.phonee": "phone" }).ok).toBe(false);
    expect(validateFieldMapping("nope").ok).toBe(false);
    expect(validateFieldMapping({ "contact.phone": 5 }).ok).toBe(false);
  });
});

describe("splitName", () => {
  it("splits full names sensibly", () => {
    expect(splitName("Ravi Kumar")).toEqual({ first: "Ravi", last: "Kumar" });
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "Cher" });
    expect(splitName("A B C")).toEqual({ first: "A", last: "B C" });
  });
});
```

**File `tests/hubspot.test.ts`:**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { hubspotContactPayload, hubspotProvider, zohoLeadPayload } from "../src/lib/integrations/crm";
import type { CrmConnection } from "@prisma/client";

const conn = {
  id: "c1",
  workspaceId: "w1",
  provider: "HUBSPOT",
  instanceUrl: null,
  accessToken: "tok",
  refreshToken: "ref",
  tokenExpiresAt: null,
  fieldMapping: null,
  twoWaySyncEnabled: false,
  lastSyncAt: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as CrmConnection;

const lead = { name: "Ravi Kumar", phone: "+919900000001", note: "test", outcome: "qualified" };

describe("hubspotContactPayload", () => {
  it("applies the default preset and name split", () => {
    const p = hubspotContactPayload(null, lead);
    expect(p.properties.firstname).toBe("Ravi Kumar");
    expect(p.properties.lastname).toBe("Kumar");
    expect(p.properties.phone).toBe("+919900000001");
    expect(p.properties.hs_lead_status).toBe("qualified");
    expect(p.properties.email).toBeUndefined();
  });
});

describe("hubspotProvider.pushLead (mocked fetch)", () => {
  const calls: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "hs-123" }), { status: 201 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("searches by phone then POSTs a contact with Bearer auth", async () => {
    const r = await hubspotProvider.pushLead(conn, lead);
    expect(r).toEqual({ externalId: "hs-123", created: true });
    expect(calls[0].url).toContain("/crm/v3/objects/contacts/search");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(calls[1].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.properties.phone).toBe("+919900000001");
  });

  it("PATCHes instead when the contact exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/search")) {
        return new Response(JSON.stringify({ results: [{ id: "hs-9" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "hs-9" }), { status: 200 });
    }));
    const r = await hubspotProvider.pushLead(conn, lead);
    expect(r).toEqual({ externalId: "hs-9", created: false });
    expect(calls[1].init.method).toBe("PATCH");
    expect(calls[1].url).toContain("/crm/v3/objects/contacts/hs-9");
  });
});

describe("zohoLeadPayload", () => {
  it("produces the Zoho data[] shape with split names", () => {
    const p = zohoLeadPayload(null, lead);
    expect(p.data.length).toBe(1);
    expect(p.data[0].Last_Name).toBe("Kumar");
    expect(p.data[0].First_Name).toBe("Ravi");
    expect(p.data[0].Phone).toBe("+919900000001");
  });
});
```

**Run all suites:**
```bash
cd /root/vaani-ai && npx vitest run
```
**Expected:** all test files PASS (7 files: money, workflow-builder, versions, ab,
voices, tool-configs, crm-mapping, hubspot — plus any from earlier guides). Summary
line shows `Test Files  … passed`.
**If it fails:** the failing assertion names the file/test — fix the SOURCE file
against this guide (never weaken the test); once more, then STOP and report.

---

## Step 22: Functional + integration tests (dev server, browser table, curl, psql)

```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15
```

### 22a: Browser test (operator, via SSH tunnel `ssh -L 3000:localhost:3000 root@<VPS_IP>`)

Login as `demo@vaani.ai / demo1234`.

| # | Action | Expected |
|---|---|---|
| 1 | Open `/agents` | Seed agent "Front Desk — Priya" (DRAFT); **10** template cards; sidebar shows ₹1,000.00 wallet; sidebar has Marketplace + Knowledge |
| 2 | Click **Use template** on "Real Estate Lead Qualifier" (`data-testid="template-use-real-estate-qualifier"`) | Redirected to editor; name pre-filled; tools CRM_WRITE + CALENDAR_BOOKING pre-enabled on the tools tab |
| 3 | General tab: change greeting, toggle barge-in off, check KB guardrail → **Save changes** (`agent-save-btn`) | Green "Saved."; version counter increments |
| 4 | Voice tab: language mode = caller-selectable; primary voice `vidya`; map Tamil → `kavya` → Save | Saved; on publish the workflow contains a `lang-1` node (verify in 22c) |
| 5 | LLM tab: pick "DeepSeek Chat (:floor)" → Save | Saved |
| 6 | Click **Publish** (`agent-publish-btn`) | Dograh up: green notice, status PUBLISHED, "Dograh workflow N" in subtitle. Dograh down: red "Voice engine error…" — also a correct result; note it |
| 7 | Versions tab (`agent-tab-versions`) | v1 row PUBLISHED with Dograh wf id + 100% traffic |
| 8 | Edit greeting again → Save → Publish | v2 appears PUBLISHED |
| 9 | Versions tab: **Roll back to this** on v1 (`version-rollback-1`) | Green notice; v1 row PUBLISHED again, v2 ARCHIVED; agent greeting reverts to v1's |
| 10 | Versions tab: create A/B variant (20% traffic) (`ab-create-btn`) | Variant row appears "(A/B)", PUBLISHED, 20% traffic |
| 11 | **Test call (browser)** (`agent-test-call-btn`) | New tab opens the Dograh UI workflow page (OPERATOR GATE Step 8: talk to the agent via Dograh's web-call widget) |
| 12 | **Advanced flow editor ↗** (`agent-advanced-editor-btn`) | New tab opens the same Dograh workflow in the visual editor (OPERATOR GATE Step 5) |
| 13 | Knowledge tab: paste a small FAQ → Add FAQ (`kb-faq-btn`) | Document row appears INDEXED, scoped to this agent |
| 14 | `/knowledge`: add URL `https://example.com` (`kb-url-btn`) | Document row INDEXED (or FAILED with a clear error if the site blocks fetches) |
| 15 | Tools tab: enable SMS with a template → Save → **Test tool (dry run)** (`tool-test-SMS`) | Green output showing `"simulated": true` |
| 16 | Tools tab: PAYMENT_LINK amount 15000 (paise) → Save → Test | Green output with `plink_dry_…` id |
| 17 | `/settings/integrations` | 6 CRM cards + 4 calendar cards; Connect on HubSpot/Google redirects to provider (or returns a clear credentials error if Step 14 gate not done) |
| 18 | Versions tab: **Publish to marketplace** (`marketplace-publish-btn`) | Green notice |
| 19 | `/marketplace` | Template card visible with "0 installs" and "by your workspace" |
| 20 | Register a SECOND workspace (private window), open `/marketplace`, click **Install template** | Redirected to a new DRAFT agent cloned from the template; back in workspace 1 the card shows "1 installs" |
| 21 | Login as the VIEWER user created in 22e, open `/agents/new`, fill the form, click **Create agent** | Red error "You need a higher role…" (403 FORBIDDEN from `requirePermission("agents:write")`); no agent created (count in 22e unchanged) |

### 22b: DB verification (Hermes runs)

```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 'SELECT a.name, a.status, v.version, v.status, v."isAbVariant", v."abTrafficPercent", v."dograhWorkflowId" IS NOT NULL AS pushed
  FROM "AgentVersion" v JOIN "Agent" a ON a.id=v."agentId" ORDER BY v."createdAt";'
docker exec vaani-db psql -U vaani -d vaani -c \
 'SELECT type, title, status, "agentId" IS NULL AS shared FROM "KnowledgeDocument" ORDER BY "createdAt";'
docker exec vaani-db psql -U vaani -d vaani -c \
 'SELECT tool, enabled FROM "AgentToolConfig" ORDER BY "createdAt";'
docker exec vaani-db psql -U vaani -d vaani -c \
 'SELECT name, installs, published FROM "MarketplaceTemplate";'
docker exec vaani-db psql -U vaani -d vaani -c \
 'SELECT action, entity FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 12;'
```
**Expected:** version rows incl. an A/B variant with `abTrafficPercent=20` and per-version
`dograhWorkflowId`s; KB rows (FAQ INDEXED + URL); tool config rows; marketplace row with
`installs=1`; audit rows `agent.publish`, `agent.rollback`, `agent.ab_variant`,
`kb.add_faq`, `marketplace.install`, etc.

### 22c: Workflow JSON sanity (Hermes runs — proves caller-select DTMF + guardrail were published)

```bash
source /root/vaani-ai/.env
WF_ID=$(docker exec vaani-db psql -U vaani -d vaani -t -A -c \
 'SELECT "dograhWorkflowId" FROM "AgentVersion" WHERE "dograhWorkflowId" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1;')
echo "workflow: $WF_ID"
[ -n "$WF_ID" ] && curl -s -H "X-API-Key: $DOGRAH_API_KEY" \
  "$DOGRAH_BASE_URL/api/v1/workflow/fetch/$WF_ID" | grep -o -m1 -E "dabaiye|let me confirm and call you back|lang-1" | sort -u
```
**Expected:** at least one of `dabaiye`, `let me confirm and call you back`, `lang-1`
printed (depends what you published last). `404`/empty → Dograh down during publish —
note it and rely on 22b + unit tests.

### 22d: Tool executor route — scripted curl with NEGATIVE tests

```bash
SECRET=$(grep DOGRAH_WEBHOOK_SECRET /root/vaani-ai/.env | cut -d= -f2)
WS=$(docker exec vaani-db psql -U vaani -d vaani -t -A -c "SELECT id FROM \"Workspace\" WHERE slug='demo-clinic';")
AGENT=$(docker exec vaani-db psql -U vaani -d vaani -t -A -c \
 "SELECT id FROM \"Agent\" WHERE \"workspaceId\"='$WS' ORDER BY \"createdAt\" LIMIT 1;")
# enable SMS on that agent directly for this test
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"AgentToolConfig\" (id, \"agentId\", tool, enabled, config) VALUES ('tc_test', '$AGENT', 'SMS', true, '{\"messageTemplate\":\"Hi\"}') ON CONFLICT (\"agentId\", tool) DO UPDATE SET enabled=true;"

# 1) authorized execute (dry-run SMS) → simulated send
curl -s -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" -H "x-tool-secret: $SECRET" \
  -d "{\"workspaceId\":\"$WS\",\"agentId\":\"$AGENT\",\"tool\":\"SMS\",\"input\":{\"to\":\"+919900000001\",\"message\":\"hi\"}}"; echo

# 2) NEGATIVE: wrong/missing secret → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\":\"$WS\",\"agentId\":\"$AGENT\",\"tool\":\"SMS\",\"input\":{}}"

# 3) NEGATIVE: cross-tenant pair (valid agent id, wrong workspace id) → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" -H "x-tool-secret: $SECRET" \
  -d "{\"workspaceId\":\"ws_fake\",\"agentId\":\"$AGENT\",\"tool\":\"SMS\",\"input\":{}}"

# 4) NEGATIVE: tool not enabled → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" -H "x-tool-secret: $SECRET" \
  -d "{\"workspaceId\":\"$WS\",\"agentId\":\"$AGENT\",\"tool\":\"WHATSAPP\",\"input\":{}}"

docker exec vaani-db psql -U vaani -d vaani -c "DELETE FROM \"AgentToolConfig\" WHERE id='tc_test';"
```
**Expected:** 1) JSON with `"simulated":true` and HTTP 200; 2) `401`; 3) `404`; 4) `404`.
**If it fails:** 1) 502 with an error field → read it (e.g. Vobiz not configured is
fine ONLY if `VAANI_DRY_RUN=true` is missing from `.env` — add it); persistent 401 on
test 1 → `DOGRAH_WEBHOOK_SECRET` mismatch between `.env` and `$SECRET`; **a `307`
redirect to `/login` instead of 401/404 → the middleware edit in Step 12
(`"/api/tools/"` in PUBLIC_PREFIXES) is missing — apply it and re-run.**

### 22e: RBAC negative test — a VIEWER cannot create an agent (403)

Every guide-05 server action gates on `requirePermission("<domain>:<action>")`
(guide 03 vocabulary). Prove the gate end-to-end:

```bash
# 1) pure permission matrix check (guide 03's own resolver — VIEWER has only analytics:read)
cd /root/vaani-ai && npx tsx -e "
import('tsx/cjs').then(async () => {
  const { resolvePermissions } = await import('./src/lib/permissions');
  const viewer = resolvePermissions({ role: 'VIEWER', grantedPermissions: [], revokedPermissions: [] });
  const admin = resolvePermissions({ role: 'ADMIN', grantedPermissions: [], revokedPermissions: [] });
  console.log('viewer agents:write =', viewer.has('agents:write'),
              '| viewer knowledge:write =', viewer.has('knowledge:write'),
              '| admin agents:write =', admin.has('agents:write'));
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
# Expected: viewer agents:write = false | viewer knowledge:write = false | admin agents:write = true

# 2) seed a VIEWER member in the demo workspace (password hash reused from demo@vaani.ai)
docker exec vaani-db psql -U vaani -d vaani -c "
INSERT INTO \"User\" (id, email, \"passwordHash\", \"fullName\")
SELECT 'viewer_user', 'viewer@vaani.ai', \"passwordHash\", 'Vijay Viewer' FROM \"User\" WHERE email='demo@vaani.ai'
ON CONFLICT (email) DO NOTHING;
INSERT INTO \"Membership\" (id, \"userId\", \"workspaceId\", role)
SELECT 'viewer_membership', 'viewer_user', w.id, 'VIEWER' FROM \"Workspace\" w WHERE w.slug='demo-clinic'
ON CONFLICT (\"userId\", \"workspaceId\") DO NOTHING;"

docker exec vaani-db psql -U vaani -d vaani -t -A -c \
 "SELECT role FROM \"Membership\" m JOIN \"User\" u ON u.id=m.\"userId\" WHERE u.email='viewer@vaani.ai';"
# Expected: VIEWER

# 3) agent count BEFORE the browser attempt (row 21 in the table above):
docker exec vaani-db psql -U vaani -d vaani -t -A -c \
 "SELECT count(*) FROM \"Agent\" a JOIN \"Workspace\" w ON w.id=a.\"workspaceId\" WHERE w.slug='demo-clinic';"
# Then do browser row 21 (login viewer@vaani.ai — same password as demo — and try to
# create an agent). Re-run the count: it MUST be unchanged (403 FORBIDDEN, no insert).
```

**If it fails:** count increased → a server action is missing `requirePermission`
(grep -n "requirePermission" src/server/actions/agents.ts — every action must have it);
`resolvePermissions` import error → guide 03 Step 3 (`src/lib/permissions.ts`) is not
in place. Fix once, then STOP and report.

Stop dev server: `pkill -f "next dev" || true`.

---

## Step 23: Tenant-isolation negative test (do not skip)

The multi-tenancy rule: user A must never read/write workspace B's agent, versions,
knowledge, tools or marketplace installs.

```bash
cd /root/vaani-ai
grep -c "workspaceId" src/server/actions/agents.ts src/server/actions/knowledge.ts src/server/actions/tools.ts src/server/actions/marketplace.ts src/server/actions/integrations.ts
grep -c "workspaceId" src/app/\(app\)/agents/page.tsx src/app/\(app\)/agents/\[id\]/page.tsx src/app/api/tools/execute/route.ts
# marketplace writes are scoped to the caller's workspace; published-template READ is
# the documented cross-tenant exception — prove install only reads published=true:
grep -n "published: true" src/server/actions/marketplace.ts
```
**Expected:** first grep: counts ≥ 12, ≥ 5, ≥ 2, ≥ 3, ≥ 4 respectively. Second grep:
≥ 1, ≥ 1, ≥ 1. Third: the `findFirst({ where: { id: templateId, published: true } })`
line printed. Zero in any position = FAIL — fix before continuing.

---

## Step 24: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 05: agent builder — versions/A-B/publish, voices+LLM pickers, workflow builder, KB, 8 tools, CRM framework, marketplace"
```

---

## Acceptance Checklist

- [ ] `/agents` renders list + 10 templates; template → prefilled editor with suggested tools
- [ ] Tabbed editor (general/voice/llm/knowledge/tools/versions) saves all config
- [ ] Publish freezes an AgentVersion, pushes its workflow to Dograh (id + uuid on the version), mirrors to Agent (or clean error when Dograh down)
- [ ] Rollback re-publishes an older version in one click; A/B variant with % split works and routing is documented (`resolveAgentForCall`)
- [ ] Test-call + advanced-editor buttons deep-link into Dograh UI (OPERATOR GATE verified or noted)
- [ ] KB: PDF/DOCX upload → MinIO + row; FAQ/URL → INDEXED text; re-index worker runs; guardrail toggle lands in published prompt
- [ ] All 8 tools save config; dry-run tests return simulated/valid output; execute route 401/404 negatives pass
- [ ] CRM: HubSpot + Zoho OAuth routes, field-mapping editor, two-way sync worker; 4 stub adapters gated
- [ ] Marketplace: publish/install/unpublish + install counter; cross-tenant read is published-only
- [ ] `maxAgents` plan gate blocks creation with a clear upgrade message
- [ ] All vitest suites pass (incl. guide 04's `src/lib/vobiz.test.ts` AND new `src/lib/vobiz.sms.test.ts`); curl negatives (401/404/404), RBAC VIEWER negative (22e), tenant-isolation greps pass
- [ ] `npm run typecheck` + `npm run build` exit 0
- [ ] Git commit `phase 05: ...` exists

## FINAL REPORT format

```
STEP 0..24: PASS/FAIL/GATE — <one line of evidence each>
PUBLISH TEST: WORKED / DOGRAH-DOWN-EXPECTED-ERROR
TEST CALL: WORKED / GATE-NOT-VERIFIED
VITEST: n/n files passed
CURL NEGATIVES: 401/404/404 = PASS/FAIL
OPERATOR GATES OPEN: <list: Dograh KB sync, Dograh UI routes, Vobiz msg paths, OAuth credentials, 4 CRM adapters, 3 calendar providers, voice ids>
ACCEPTANCE: n/13 checked
NOTES: <deviations>
```
