# 04 — Voice Stack: Dograh + Vobiz + Sarvam + OpenRouter

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/04_dograh_vobiz_sarvam_openrouter_integration.md` exactly.
> The Dograh API contracts in this file were extracted from Dograh's official OpenAPI
> spec (see `/root/vaani-ai/plan/dograh_api_docs.txt`) — they are EXACT, not guesses.
> You may still verify them against the live instance where a step says VERIFY, and if
> the live instance genuinely differs, change ONLY the PATH constants in
> `src/lib/dograh.ts` and report the deviation. Steps marked **OPERATOR GATE** require
> confirmation from an external provider's docs/dashboard — do exactly the scripted
> part, then STOP and report what the operator must confirm. Never print full secret
> keys in your report (mask all but the last 4 chars). End with the FINAL REPORT.
> ---

---

## Goal

Self-hosted Dograh running on the VPS, connected to Sarvam.ai (STT/TTS), OpenRouter
(LLM), and Vobiz (telephony). A typed API client (`src/lib/dograh.ts`) with the REAL
Dograh endpoints, a retry wrapper, and a workflow-definition builder that encodes
per-agent voice/language/LLM-failover-chain, recording disclosure (first thing spoken),
hybrid pre-recorded audio, and the Phase-4 scaffolds. A webhook receiver that turns
post-call data into `Call`/`CallEvent` rows. Health-check and latency scripts, Vobiz
WhatsApp helper, BYOC SIP scaffold, MCP exposure scaffold.
**Final proof: a real phone call answered by the AI and visible in our database.**

**Spec coverage in this guide** (readme.md references):
- §2 / §4.2 latency budget (<800ms E2E, Vobiz ~80ms) → Step 12
- §4.2 per-agent LLM selection + failover chains (§12) → Steps 6–7
- §4.2 hybrid pre-recorded + TTS → Step 14
- §11 call recording disclosure (per jurisdiction) → Steps 6 (builder) + 14 (audio)
- §9 BYOC SIP → Step 15 · §9 Vobiz WhatsApp Business API → Step 16 · §9 MCP server → Step 17
- §12 reliability (health-checked trunks, retry w/ backoff + idempotency, redundant media) → Steps 6, 13
- §15 Phase 4: voice cloning + speech-to-speech scaffolding → Steps 6, 18

**Time estimate:** 4–6 hours (plus human waiting time for Vobiz KYC).
**Prerequisites:** guides 01–03 green. Human operator has: Vobiz account + 1 DID,
Sarvam API key, OpenRouter API key with ~$10 credit.

---

## The Dograh API contract (authoritative — extracted from the official OpenAPI spec)

Everything this project uses, with exact shapes:

| Purpose | Method & Path | Auth |
|---|---|---|
| Health | `GET /api/v1/health` | none |
| Create workflow | `POST /api/v1/workflow/create/definition` | `X-API-Key` header |
| Update workflow | `PUT /api/v1/workflow/{workflow_id}` | `X-API-Key` |
| Publish workflow | `POST /api/v1/workflow/{workflow_id}/publish` | `X-API-Key` |
| Fetch workflow | `GET /api/v1/workflow/fetch/{workflow_id}` | `X-API-Key` |
| **Trigger outbound call** | `POST /api/v1/public/agent/workflow/{workflow_uuid}` | `X-API-Key` (required) |
| Get run (transcript/recording/cost) | `GET /api/v1/workflow/{workflow_id}/runs/{run_id}` | `X-API-Key` |
| Usage runs (paginated) | `GET /api/v1/organizations/usage/runs` | `X-API-Key` |
| Create telephony config | `POST /api/v1/organizations/telephony-configs` | `X-API-Key` |
| Bind DID to workflow | `PUT /api/v1/organizations/telephony-configs/{config_id}/phone-numbers/{phone_number_id}` | `X-API-Key` |
| Create API key | `POST /api/v1/user/api-keys` | user session (do it in the Dograh UI) |

**Key field contracts:**
- Create/update workflow body: `{ "name": string, "workflow_definition": { "nodes": [...], "edges": [...] } }`.
  Response: `{ "id": <integer>, "name": ..., "status": ..., "workflow_uuid": <string|null>, ... }`.
  NOTE: two different identifiers — numeric `id` (update/publish/fetch/runs paths) and
  `workflow_uuid` (public call-trigger path). We store BOTH (Step 8 migration).
- `workflow_definition` node types: `startCall`, `agentNode`, `endCall`, `webhook`,
  `globalNode`, `qa`, `trigger`. Node data requires `name` + `prompt`. Edges:
  `{ id, source, target, data: { label, condition, transition_speech? } }`.
  Exactly one `startCall` (or `trigger`) entry node. `webhook` node data:
  `{ enabled, http_method, endpoint_url, custom_headers: [{key,value}], payload_template }`.
- Trigger call body: `{ "phone_number": "+91...", "initial_context": {...} }` →
  response `{ "status": string, "workflow_run_id": <integer>, "workflow_run_name": string }`.
- Run response fields: `is_completed`, `call_type` (`inbound|outbound`),
  `transcript_url`, `recording_url`, `recording_public_url`, `transcript_public_url`,
  `cost_info` (object), `usage_info` (object), `gathered_context` (object).
- Vobiz telephony config body:
  `{ "name": "...", "is_default_outbound": true, "config": { "provider": "vobiz", "auth_id": "...", "auth_token": "...", "application_id": "..."?, "from_numbers": ["+91..."] } }`.
- Phone-number bind body: `{ "inbound_workflow_id": <integer> }`
  (or `"clear_inbound_workflow": true` to unbind).

**Documented capabilities used later with OPERATOR GATEs** (listed in
`dograh_api_docs.txt` but whose exact request shapes are NOT in the contract table
above — confirm against the live instance before relying on them):
- List supported telephony providers + their credential fields (used Step 15, BYOC).
- Pre-recorded audio in workflows — `docs.dograh.com/voice-agent/pre-recorded-audio.md`
  (used Step 14).
- MCP server — `docs.dograh.com/integrations/mcp.md` (used Step 17).
- Model/inference-provider configurations incl. speech-to-speech —
  `docs.dograh.com/configurations/inference-providers.md` (used Step 18).
- Validate workflow / create test run (dry-run execution without a phone call) —
  useful for debugging; discover exact paths from the live `/openapi.json` if needed.

---

## Step 0 (HUMAN OPERATOR — Hermes cannot do this)

1. **Sarvam.ai:** `https://www.sarvam.ai/` → API keys → create key → into
   `/root/vaani-ai/.env` as `SARVAM_API_KEY=...`.
2. **OpenRouter:** `https://openrouter.ai/` → Keys → create key + $10 credit →
   `OPENROUTER_API_KEY=...`.
3. **Vobiz:** `https://www.vobiz.ai/` → KYC → rent ONE test DID → note the DID (E.164),
   and from the Vobiz dashboard: **Auth ID, Auth Token, Application ID**. Also ask
   Vobiz (or check the dashboard) for: **WhatsApp Business API access + sender number**
   (readme §9) and the **REST API base URL + WhatsApp send endpoint path** (OPERATOR
   GATE — needed in Steps 13/16).
4. **(Optional, readme §9 BYOC)** If the deployment needs bring-your-own-carrier SIP:
   collect the carrier's SIP host, port, username, password, transport (udp/tcp/tls).
5. Hermes verifies the two API keys:
```bash
cd /root/vaani-ai
source .env
curl -s https://api.sarvam.ai/v1/models -H "api-subscription-key: $SARVAM_API_KEY" | head -c 300
curl -s https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY" | head -c 200
```
**Expected:** JSON responses, not 401/403.

---

## Step 1: Install Dograh (self-hosted)

```bash
cd /root
git clone https://github.com/Dograh-hq/dograh.git dograh || git clone https://github.com/dograh-hq/dograh.git dograh
cd /root/dograh
ls
```
If both fail: `curl -s "https://api.github.com/search/repositories?q=dograh+voice" | grep '"full_name"' | head -5`,
clone the official one, report the URL.

Read the repo's README/docker docs and start it (Dograh deploys via Docker Compose):
```bash
cd /root/dograh
head -n 120 README.md
ls docker-compose*.yml .env.example 2>/dev/null
cp .env.example .env   # then edit per README — see Step 2 for provider keys
docker compose up -d
```

**Verify:**
```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -i dograh
```
**Expected:** dograh container(s) `Up`.
**If it fails:** `docker compose logs --tail 50` — report failing service + log lines.
Do NOT modify Dograh source.

---

## Step 2: Provider keys + health check

Edit `/root/dograh/.env` per the repo's documented variable names for Sarvam and
OpenRouter (find them: `grep -ri -E "sarvam|openrouter" .env.example README.md docs/ 2>/dev/null | head`),
then `docker compose down && docker compose up -d`.

Find Dograh's API port (`docker compose ps`, commonly 8000) and verify health:
```bash
curl -s http://localhost:<PORT>/api/v1/health
```
**Expected:** HTTP 200 JSON (e.g. `{"status":"ok"}`-shaped).
Set `DOGRAH_BASE_URL=http://localhost:<PORT>` in `/root/vaani-ai/.env`. Record it.

---

## Step 3: Create a Dograh API key (operator, via Dograh UI)

The API-key endpoint needs a user session, so: the operator opens the Dograh web UI
(SSH tunnel: `ssh -L <ui-port>:localhost:<ui-port> root@<VPS_IP>`), signs up/logs in,
goes to Settings/API Keys, creates a key named `vaani-saas`, and pastes it into
`/root/vaani-ai/.env` as `DOGRAH_API_KEY=...`.

**Hermes verifies the key:**
```bash
source /root/vaani-ai/.env
curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: $DOGRAH_API_KEY" "$DOGRAH_BASE_URL/api/v1/workflow/fetch"
```
**Expected:** `200` (or a JSON list of workflows — empty is fine). `401/403` → wrong
key; ask the operator.

---

## Step 4: Configure Vobiz telephony

Two paths — **Path A (UI, recommended for v1)**: operator adds the Vobiz provider in
the Dograh UI telephony settings with Auth ID / Auth Token / Application ID, and adds
the DID as a phone number. **Path B (API)** — Hermes may do it with the exact contract:

```bash
source /root/vaani-ai/.env
curl -s -X POST "$DOGRAH_BASE_URL/api/v1/organizations/telephony-configs" \
  -H "X-API-Key: $DOGRAH_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Vobiz main",
    "is_default_outbound": true,
    "config": {
      "provider": "vobiz",
      "auth_id": "<VOBIZ_AUTH_ID>",
      "auth_token": "<VOBIZ_AUTH_TOKEN>",
      "application_id": "<VOBIZ_APPLICATION_ID>",
      "from_numbers": ["<DID_E164>"]
    }
  }'
```
**Expected:** JSON with the created config (note its `id`). Then the DID is bound to a
workflow later (guide 06) via
`PUT /api/v1/organizations/telephony-configs/{config_id}/phone-numbers/{phone_number_id}`
with `{"inbound_workflow_id": <id>}`.

The operator must ALSO point the DID's inbound destination in the Vobiz dashboard at
Dograh's inbound handler: `https://<voice-domain>/api/v1/telephony/inbound/run`
(confirm the exact inbound URL pattern Dograh expects for Vobiz in
`/root/dograh` docs or `integrations/telephony` docs — `grep -ri vobiz /root/dograh/docs 2>/dev/null | head`).
This needs a public HTTPS URL → finalized in guide 12 Step 6.

**Verify:** no 401/403 above; `docker compose logs --tail 100 | grep -i -E "vobiz|telephony" | tail` shows no auth errors.

---

## Step 5: `.env` additions for this guide

Append the documented block to `.env.example` (committed) AND to `.env` (real values;
operator fills the `CHANGE_ME`/empty ones — Hermes never invents secrets):

```bash
cat >> /root/vaani-ai/.env.example <<'EOF'

# --- Guide 04: voice stack extras ---
# Base delay (ms) for the Dograh API client retry backoff (250 -> 750 -> 2250). Tests set 1.
DOGRAH_RETRY_DELAY_MS=250
# End-to-end STT->LLM->TTS latency budget in ms (readme §2). Used by scripts/check-latency.sh.
LATENCY_BUDGET_MS=800

# Vobiz REST credentials (WhatsApp Business API + trunk health checks). Same account as the SIP trunk.
VOBIZ_AUTH_ID=CHANGE_ME
VOBIZ_AUTH_TOKEN=CHANGE_ME
VOBIZ_API_BASE=https://api.vobiz.ai
# OPERATOR GATE: confirm both paths from https://vobiz.ai/docs before first real use.
VOBIZ_ACCOUNT_PATH=/v1/account
VOBIZ_WHATSAPP_PATH=/v1/whatsapp/messages
# Vobiz WhatsApp Business sender number (E.164), from the Vobiz dashboard (readme §9).
VOBIZ_WHATSAPP_SENDER=

# BYOC (bring-your-own-carrier) SIP trunk, readme §9. Optional; leave empty if unused.
BYOC_SIP_HOST=
BYOC_SIP_PORT=5060
BYOC_SIP_USERNAME=
BYOC_SIP_PASSWORD=
BYOC_SIP_TRANSPORT=udp

# MCP exposure (readme §9): internal Dograh MCP endpoint + public proxy key.
# OPERATOR GATE: enable MCP in Dograh (docs.dograh.com/integrations/mcp.md), then set DOGRAH_MCP_URL.
DOGRAH_MCP_URL=
# Generate with: openssl rand -hex 32
MCP_PROXY_KEY=
EOF
grep -c "VOBIZ_WHATSAPP_PATH" /root/vaani-ai/.env.example
# same block into the real .env (operator replaces CHANGE_ME / empty values):
grep -q "DOGRAH_RETRY_DELAY_MS" /root/vaani-ai/.env || \
  sed -n '/--- Guide 04: voice stack extras ---/,$p' /root/vaani-ai/.env.example >> /root/vaani-ai/.env
grep -c "VOBIZ_WHATSAPP_PATH\|MCP_PROXY_KEY\|BYOC_SIP_HOST" /root/vaani-ai/.env
```
**Expected:** `1` (block present in `.env.example`), then `3` (all three new keys present in `.env`).

---

## Step 6: The Dograh API client + workflow-definition builder

One file. Exports consumed by later guides (DO NOT rename or change signatures):
`buildWorkflowDefinition`, `dograhCreateWorkflow`, `dograhUpdateWorkflow`,
`dograhPublishWorkflow`, `dograhGetRun`, `dograhTriggerCall`, `dograhHealth`,
`DograhError`, `AgentSpec`, `LlmChainEntry`, `DEFAULT_LLM_CHAIN`, `withVariant`,
`sarvamLanguageCode`, `retryDelayMs`, `idempotencyKeyFor`.

**File `src/lib/dograh.ts`** (full content — contracts from the table at top):

```ts
/**
 * Typed client for the self-hosted Dograh instance.
 * Endpoint contracts verified against Dograh's official OpenAPI spec
 * (plan/dograh_api_docs.txt). If the live instance differs, change ONLY PATHS.
 *
 * Reliability (readme §12): every mutating call carries a deterministic
 * Idempotency-Key header and is retried with exponential backoff on 429/5xx and
 * network errors. 4xx (except 429) is NEVER retried.
 */
import { createHash } from "node:crypto";

const BASE = process.env.DOGRAH_BASE_URL ?? "http://localhost:8000";
const KEY = process.env.DOGRAH_API_KEY ?? "";
const MAX_RETRIES = 3;

const PATHS = {
  health: "/api/v1/health",
  createWorkflow: "/api/v1/workflow/create/definition",
  workflow: (id: number) => `/api/v1/workflow/${id}`,
  publishWorkflow: (id: number) => `/api/v1/workflow/${id}/publish`,
  fetchWorkflow: (id: number) => `/api/v1/workflow/fetch/${id}`,
  run: (workflowId: number, runId: number) => `/api/v1/workflow/${workflowId}/runs/${runId}`,
  usageRuns: "/api/v1/organizations/usage/runs",
  triggerByUuid: (uuid: string) => `/api/v1/public/agent/workflow/${uuid}`,
};

export class DograhError extends Error {
  constructor(public status: number, message: string) {
    super(`Dograh ${status}: ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff schedule: base * 3^attempt → 250ms, 750ms, 2250ms by default.
 *  Base is DOGRAH_RETRY_DELAY_MS so tests can set it to 1. */
export function retryDelayMs(attempt: number): number {
  const base = Number(process.env.DOGRAH_RETRY_DELAY_MS ?? 250);
  return base * Math.pow(3, attempt);
}

/** 429 (rate limit) and 5xx are retryable; other 4xx are client bugs — never retry. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Deterministic idempotency key: identical (method, path, body) → identical key, so
 *  retries of the SAME logical call collapse server-side, while a genuinely new call
 *  (different body, e.g. a different phone number) gets a different key. */
export function idempotencyKeyFor(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method} ${path} ${JSON.stringify(body ?? null)}`)
    .digest("hex")
    .slice(0, 32);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(KEY ? { "X-API-Key": KEY } : {}),
  };
  if (method === "POST" || method === "PUT") {
    headers["Idempotency-Key"] = idempotencyKeyFor(method, path, body ?? null);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs(attempt - 1));
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text().catch(() => "");
      const err = new DograhError(res.status, text.slice(0, 500));
      if (!isRetryableStatus(res.status)) throw err; // 4xx: fail fast
      lastError = err; // 429/5xx: retry
    } catch (e) {
      if (e instanceof DograhError && !isRetryableStatus(e.status)) throw e;
      lastError = e; // network error (ECONNREFUSED, DNS, ...) or retryable status
    }
  }
  throw lastError;
}

// ---------- Types (exact Dograh shapes) ----------

export type DograhWorkflow = {
  id: number;
  name: string;
  status: string;
  workflow_uuid: string | null;
  [k: string]: unknown;
};

export type DograhTriggerResponse = {
  status: string;
  workflow_run_id: number;
  workflow_run_name: string;
};

export type DograhRun = {
  id: number;
  workflow_id: number;
  is_completed: boolean;
  call_type: "inbound" | "outbound";
  transcript_url: string | null;
  recording_url: string | null;
  recording_public_url: string | null;
  transcript_public_url: string | null;
  cost_info: Record<string, unknown> | null;
  usage_info: Record<string, unknown> | null;
  gathered_context: Record<string, unknown> | null;
  [k: string]: unknown;
};

// ---------- LLM failover chains (readme §4.2 + §12) ----------

export type LlmVariant = "nitro" | "floor";

/** One entry in an agent's LLM failover chain. Index 0 = primary, then fallbacks in
 *  order. `variant` maps to OpenRouter's `:nitro` (speed-optimized provider routing)
 *  and `:floor` (cheapest-provider routing) model suffixes. */
export type LlmChainEntry = {
  model: string;          // OpenRouter model id, e.g. "meta-llama/llama-3.1-70b-instruct"
  variant?: LlmVariant;   // optional OpenRouter routing suffix
};

/** Append an OpenRouter variant suffix unless the model already has one. */
export function withVariant(model: string, variant?: LlmVariant): string {
  if (!variant) return model;
  return model.includes(":") ? model : `${model}:${variant}`;
}

/**
 * Default chain (master plan §3 default model + readme §12 failover):
 *  1. primary: quality model, no variant (best provider routing)
 *  2. fallback 1: small fast model on :nitro (rate-limited/down primary → speed)
 *  3. fallback 2: cheap model on :floor (last resort → always available, lowest cost)
 * Use :nitro when latency matters more than price (live conversations always do);
 * use :floor for cost-insensitive background agents or the last-resort fallback.
 */
export const DEFAULT_LLM_CHAIN: LlmChainEntry[] = [
  { model: "meta-llama/llama-3.1-70b-instruct" },
  { model: "meta-llama/llama-3.1-8b-instruct", variant: "nitro" },
  { model: "deepseek/deepseek-chat", variant: "floor" },
];

// ---------- Workflow definition builder ----------

export type AgentSpec = {
  name: string;
  greeting: string;
  systemPrompt: string;
  maxCallSeconds: number;
  /** readme §4.2: auto (Sarvam detects), fixed (fixedLanguage), caller-select (IVR-style choice). */
  languageMode?: "auto" | "fixed" | "caller-select";
  /** e.g. "hi", "en-IN". Used only when languageMode === "fixed". */
  fixedLanguage?: string;
  /** Sarvam Bulbul speaker id, e.g. "anushka". */
  voiceId?: string;
  /** Phase 4 scaffold (readme §15): cloned brand-voice id. When set, overrides voiceId
   *  and marks voice_is_cloned. Inert until Sarvam/Dograh cloning support is confirmed
   *  (Step 18 OPERATOR GATE). */
  clonedVoiceId?: string;
  /** readme §4.2/§12: primary → fallback1 → fallback2. Defaults to DEFAULT_LLM_CHAIN. */
  llmChain?: LlmChainEntry[];
  /** readme §11: legal recording disclosure. When set it is the FIRST thing the agent
   *  says, before the greeting. Configure per jurisdiction:
   *  India (TRAI): no blanket requirement, but recommended for outbound;
   *  US TCPA/two-party-consent states & EU GDPR: disclosure required — set it. */
  recordingDisclosureText?: string | null;
  /** readme §4.2 hybrid pre-recorded + TTS: public URLs of mp3/wav files uploaded to
   *  MinIO (Step 14). disclosureUrl wins over greetingUrl when both are set (the
   *  disclosure is compliance-critical; the greeting falls back to TTS). */
  preRecordedAudio?: { greetingUrl?: string; disclosureUrl?: string };
  /** Phase 4 scaffold (readme §15): "speech-to-speech" bypasses STT/TTS legs for
   *  ultra-low latency. Inert until Dograh S2S support is confirmed (Step 18). */
  pipelineMode?: "stt-llm-tts" | "speech-to-speech";
};

/** Sarvam Saarika language code for the STT leg: "unknown" = auto-detect
 *  (readme §4.2 language mode). */
export function sarvamLanguageCode(
  spec: Pick<AgentSpec, "languageMode" | "fixedLanguage">
): string {
  if (spec.languageMode === "fixed" && spec.fixedLanguage) return spec.fixedLanguage;
  return "unknown"; // auto + caller-select both start in auto-detect
}

/**
 * Build a Dograh workflow_definition for one of our agents:
 * startCall (disclosure FIRST, then greeting) → agentNode (the conversation) →
 * webhook (post-call sync to us) → endCall.
 * The webhook node POSTs run results to our /api/webhooks/dograh endpoint with a
 * static shared-secret header (our receiver accepts it — see webhooks/dograh/route.ts).
 */
export function buildWorkflowDefinition(spec: AgentSpec) {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const secret = process.env.DOGRAH_WEBHOOK_SECRET ?? "";
  const chain = (spec.llmChain?.length ? spec.llmChain : DEFAULT_LLM_CHAIN).map((e) => ({
    model: withVariant(e.model, e.variant),
  }));
  const disclosure = spec.recordingDisclosureText?.trim() || null;
  const voiceId = spec.clonedVoiceId ?? spec.voiceId ?? "anushka";
  const preRecordedUrl =
    spec.preRecordedAudio?.disclosureUrl ?? spec.preRecordedAudio?.greetingUrl ?? null;

  // readme §11: the disclosure MUST be the first spoken content of the call.
  const startPrompt = disclosure
    ? `First say exactly this legal disclosure, word for word, in the caller's language: "${disclosure}". Only after the disclosure, greet the caller with exactly this greeting, then listen: "${spec.greeting}"`
    : `Greet the caller with exactly this greeting, then listen: "${spec.greeting}"`;

  return {
    nodes: [
      {
        id: "start-1",
        type: "startCall",
        position: { x: 0, y: 0 },
        data: {
          name: "Start",
          prompt: startPrompt,
          allow_interrupt: false,
          // Hybrid pre-recorded audio (readme §4.2; Dograh feature:
          // docs.dograh.com/voice-agent/pre-recorded-audio.md). Field names verified
          // against the live /openapi.json in Step 14 (OPERATOR GATE). If the live
          // schema 422s on these two keys, remove ONLY them — the prompt above still
          // guarantees the disclosure/greeting is spoken via TTS.
          ...(preRecordedUrl
            ? { use_pre_recorded_audio: true, pre_recorded_audio_url: preRecordedUrl }
            : {}),
        },
      },
      {
        id: "agent-1",
        type: "agentNode",
        position: { x: 300, y: 0 },
        data: {
          name: spec.name,
          prompt: spec.systemPrompt,
          allow_interrupt: true,
          // Per-agent voice/language (readme §4.2):
          language_mode: spec.languageMode ?? "auto",
          language_code: sarvamLanguageCode(spec),
          voice_id: voiceId,
          voice_is_cloned: Boolean(spec.clonedVoiceId),
          // LLM failover chain (readme §4.2 + §12). primary_llm_model is what Dograh
          // uses first; llm_chain is the documented fallback order. If the live
          // Dograh version reads only single-model fields, primary_llm_model alone
          // still works; the chain takes effect once Dograh consumes it (Step 7).
          primary_llm_model: chain[0].model,
          llm_chain: chain,
          // Phase 4 scaffold (readme §15): stt-llm-tts (default) | speech-to-speech.
          pipeline_mode: spec.pipelineMode ?? "stt-llm-tts",
          max_call_seconds: spec.maxCallSeconds,
          extraction_enabled: true,
          extraction_variables: [
            { name: "call_summary", type: "string", prompt: "Summarize the call in 2-3 sentences: what the caller wanted and what was agreed." },
            { name: "outcome", type: "string", prompt: "One-word outcome: booked, qualified, not-interested, message-taken, payment-promised, dispute, dnc-requested, or other." },
            { name: "callback_requested", type: "boolean", prompt: "Did the caller ask for a human or a callback?" },
          ],
        },
      },
      {
        id: "webhook-1",
        type: "webhook",
        position: { x: 600, y: 0 },
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
              transcript_url: "{{transcript_url}}",
              recording_url: "{{recording_public_url}}",
            },
          },
        },
      },
      {
        id: "end-1",
        type: "endCall",
        position: { x: 900, y: 0 },
        data: {
          name: "End",
          prompt: "Thank the caller warmly and say goodbye in their language.",
        },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "start-1",
        target: "agent-1",
        data: { label: "Greeting done", condition: "The greeting has been delivered" },
      },
      {
        id: "edge-2",
        source: "agent-1",
        target: "webhook-1",
        data: {
          label: "Conversation complete",
          condition: "The caller's need is fully handled or they want to end the call",
        },
      },
      {
        id: "edge-3",
        source: "webhook-1",
        target: "end-1",
        data: { label: "Synced", condition: "Always" },
      },
    ],
  };
}

// ---------- Operations ----------

export async function dograhHealth(): Promise<boolean> {
  try {
    await request("GET", PATHS.health);
    return true;
  } catch {
    return false;
  }
}

export async function dograhCreateWorkflow(
  name: string,
  definition: Record<string, unknown>
): Promise<DograhWorkflow> {
  return request("POST", PATHS.createWorkflow, { name, workflow_definition: definition });
}

export async function dograhUpdateWorkflow(
  id: number,
  patch: { name?: string; workflow_definition?: Record<string, unknown>; workflow_configurations?: Record<string, unknown> }
): Promise<DograhWorkflow> {
  return request("PUT", PATHS.workflow(id), patch);
}

export async function dograhPublishWorkflow(id: number): Promise<void> {
  await request("POST", PATHS.publishWorkflow(id));
}

export async function dograhGetRun(workflowId: number, runId: number): Promise<DograhRun> {
  return request("GET", PATHS.run(workflowId, runId));
}

/** Place ONE outbound call. Auth: X-API-Key (required on this public path).
 *  Retried on 429/5xx with backoff; safe to retry because of the Idempotency-Key. */
export async function dograhTriggerCall(
  workflowUuid: string,
  input: { phoneNumber: string; initialContext?: Record<string, string> }
): Promise<DograhTriggerResponse> {
  return request("POST", PATHS.triggerByUuid(workflowUuid), {
    phone_number: input.phoneNumber,
    initial_context: input.initialContext ?? {},
  });
}
```

**Verify:**
```bash
cd /root/vaani-ai
npm run typecheck
```
**Expected:** exit 0.

**Live smoke (Hermes):**
```bash
cd /root/vaani-ai
npx tsx -e "
import('./src/lib/dograh').then(async (d) => {
  const ok = await d.dograhHealth();
  console.log('health:', ok);
  if (!ok) process.exit(1);
  const def = d.buildWorkflowDefinition({
    name: 'smoke', greeting: 'Hello, this is a test.', systemPrompt: 'You are a test agent. Be brief.', maxCallSeconds: 300,
  });
  const wf = await d.dograhCreateWorkflow('vaani-smoke-test', def);
  console.log('created id:', wf.id, 'uuid:', wf.workflow_uuid, 'status:', wf.status);
  await d.dograhPublishWorkflow(wf.id);
  console.log('published OK');
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** `health: true`, `created id: <number> uuid: <string>`, `published OK`.
(The smoke workflow stays in Dograh — harmless; the operator can delete it in the UI.)
**If it fails:** `Dograh 401` → bad `DOGRAH_API_KEY` (Step 3). `Dograh 422` → the live
workflow schema differs from the contract — fetch
`curl -s $DOGRAH_BASE_URL/openapi.json > /tmp/live.json` and compare the
workflow-definition node-data schema; if the new optional agent-node keys
(`language_mode`, `language_code`, `voice_id`, `voice_is_cloned`, `primary_llm_model`,
`llm_chain`, `pipeline_mode`, `max_call_seconds`) are rejected, remove ONLY the
rejected keys from `buildWorkflowDefinition` and report the deviation (the defaults
in Dograh's own UI config then govern voice/model). `ECONNREFUSED` after retries →
wrong `DOGRAH_BASE_URL` or Dograh down. Max 2 attempts, then STOP and report.

---

## Step 7: "Provider down" simulation — failover chain survives an invalid primary

readme §12: a rate-limited or dead LLM provider must never kill a live call. Dograh
resolves model ids at CALL time, not at creation time — so creating a workflow whose
PRIMARY model is bogus succeeds, and the stored `llm_chain` is what saves the call.
This test proves our builder always emits a complete chain even when the primary is
invalid.

```bash
cd /root/vaani-ai
source .env
npx tsx -e "
import('./src/lib/dograh').then(async (d) => {
  const def = d.buildWorkflowDefinition({
    name: 'chain-dry-run',
    greeting: 'Hello.',
    systemPrompt: 'You are a test agent. Be brief.',
    maxCallSeconds: 300,
    llmChain: [
      { model: 'invalid/no-such-model-000' },                      // PRIMARY IS DOWN (simulated)
      { model: 'meta-llama/llama-3.1-8b-instruct', variant: 'nitro' },
      { model: 'deepseek/deepseek-chat', variant: 'floor' },
    ],
  });
  const wf = await d.dograhCreateWorkflow('vaani-chain-dry-run', def);
  console.log('created id:', wf.id);
  const agentNode = def.nodes.find((n) => n.id === 'agent-1');
  console.log('primary:', agentNode.data.primary_llm_model);
  console.log('chain:', JSON.stringify(agentNode.data.llm_chain));
  const chain = agentNode.data.llm_chain;
  if (chain.length !== 3) { console.error('FAIL: chain incomplete'); process.exit(1); }
  if (chain[0].model !== 'invalid/no-such-model-000') { console.error('FAIL: primary not first'); process.exit(1); }
  if (chain[1].model !== 'meta-llama/llama-3.1-8b-instruct:nitro') { console.error('FAIL: fallback1'); process.exit(1); }
  if (chain[2].model !== 'deepseek/deepseek-chat:floor') { console.error('FAIL: fallback2'); process.exit(1); }
  console.log('FAILOVER CHAIN OK: fallbacks intact even though primary is invalid');
}).catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
"
```
**Expected:** `created id: <number>`, `primary: invalid/no-such-model-000`, the chain
JSON with all three entries (note the `:nitro` / `:floor` suffixes), and
`FAILOVER CHAIN OK: fallbacks intact even though primary is invalid`.
**If it fails:** `Dograh 401` → key (Step 3). Any `FAIL:` line → the builder was
edited incorrectly; restore it from Step 6 and re-run once. Then STOP and report.
(The dry-run workflow stays in Dograh — harmless; operator can delete it in the UI.)

---

## Step 8: Store both Dograh identifiers (small migration)

The trigger endpoint needs `workflow_uuid`; update/publish need the numeric `id`.
Add a column:

**Edit `prisma/schema.prisma`:** in `model Agent`, directly under the line
`dograhWorkflowId String?     // set after publishing to Dograh (mirrors latest published AgentVersion)`, add:
```prisma
  dograhWorkflowUuid String?   // Dograh workflow_uuid — used by the public call-trigger endpoint
```

**Do:**
```bash
cd /root/vaani-ai
npx prisma migrate dev --name agent_dograh_uuid && npm run typecheck
```
**Expected:** migration applied, typecheck exit 0.

---

## Step 9: Webhook receiver — full route + pure signature verifier

Dograh's webhook node sends a static `x-webhook-secret` header (from
`buildWorkflowDefinition`), while our tests/integrations use HMAC. The verifier
accepts both. It lives in a pure, unit-testable helper; the route delegates to it.

**File `src/lib/dograhWebhook.ts`** (full content):

```ts
/**
 * Signature verification for POST /api/webhooks/dograh.
 * Accepts EITHER:
 *   1. the static shared secret Dograh's webhook node sends as `x-webhook-secret`, OR
 *   2. an HMAC-SHA256 hex signature of the raw body in `x-dograh-signature`
 *      (or `x-webhook-signature`), computed with DOGRAH_WEBHOOK_SECRET.
 * Dev fallback: if DOGRAH_WEBHOOK_SECRET is unset, everything is allowed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyDograhWebhook(
  headers: Pick<Headers, "get">,
  rawBody: string,
  secret: string | undefined = process.env.DOGRAH_WEBHOOK_SECRET
): boolean {
  if (!secret) return true; // dev fallback

  const staticHeader = headers.get("x-webhook-secret");
  if (staticHeader && staticHeader === secret) return true;

  const sig = headers.get("x-dograh-signature") ?? headers.get("x-webhook-signature");
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

**File `src/app/api/webhooks/dograh/route.ts`** (full content — CREATE it; later
guides 06/09 hook into the `if (ended) {` block, do not rename it):

```ts
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyDograhWebhook } from "@/lib/dograhWebhook";

type Data = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
};

async function logEvent(callId: string, type: string, event: string, data: Data) {
  await db.callEvent.create({
    data: { callId, type, payload: { event, data } as Prisma.InputJsonValue },
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyDograhWebhook(req.headers, raw)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  let body: { event?: unknown; data?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const event = str(body.event) ?? "unknown";
  const data: Data =
    body.data && typeof body.data === "object" ? (body.data as Data) : {};
  const dograhCallId =
    str(data.call_id) ?? str(data.dograh_call_id) ?? str(data.run_call_id);
  if (!dograhCallId) {
    return NextResponse.json({ ok: false, error: "missing call_id" }, { status: 400 });
  }

  let call = await db.call.findUnique({ where: { dograhCallId } });

  // ---- call.started: create the CDR row if we have never seen this call ----
  if (event === "call.started") {
    if (!call) {
      const toNumber = str(data.to_number) ?? "";
      // Resolve tenant + agent from the dialed number ("unknown-number path").
      const pn = toNumber
        ? await db.phoneNumber.findFirst({ where: { number: toNumber } })
        : null;
      const workspaceId =
        pn?.workspaceId ??
        (await db.workspace.findFirst({ orderBy: { createdAt: "asc" } }))?.id;
      if (!workspaceId) {
        return NextResponse.json({ ok: false, error: "no workspace" }, { status: 409 });
      }
      call = await db.call.create({
        data: {
          workspaceId,
          dograhCallId,
          direction: "INBOUND",
          status: "IN_PROGRESS",
          fromNumber: str(data.from_number) ?? "unknown",
          toNumber,
          agentId: pn?.agentId ?? null,
          answeredAt: new Date(),
        },
      });
      await logEvent(call.id, "status", event, data);
      return NextResponse.json({ ok: true, created: call.id });
    }
    await db.call.update({
      where: { id: call.id },
      data: { status: "IN_PROGRESS", answeredAt: new Date() },
    });
    await logEvent(call.id, "status", event, data);
    return NextResponse.json({ ok: true });
  }

  // ---- call.ended / call.completed: finalize the CDR ----
  const ended = event === "call.ended" || event === "call.completed";
  if (ended) {
    if (!call) {
      return NextResponse.json({ ok: false, error: "unknown call" }, { status: 404 });
    }
    const update: Prisma.CallUpdateInput = { status: "COMPLETED", endedAt: new Date() };
    const dur = num(data.duration_seconds);
    if (dur !== null) update.durationSec = dur;
    const summary = str(data.summary);
    if (summary) update.summary = summary;
    const transcript = str(data.transcript);
    if (transcript) update.transcript = transcript;
    const outcome = str(data.outcome);
    if (outcome) update.outcome = outcome;
    // Real Dograh payloads carry a public recording URL. We park it as
    // "pending:<url>"; guide 08's sweeper downloads it into MinIO and replaces the key.
    const recUrl = str(data.recording_url) ?? str(data.recording_public_url);
    if (recUrl) update.recordingKey = `pending:${recUrl}`;
    if (Object.keys(update).length) {
      await db.call.update({ where: { id: call.id }, data: update });
    }
    await logEvent(call.id, "summary", event, data);
    return NextResponse.json({ ok: true });
  }

  // ---- any other event: keep it on the call timeline if we know the call ----
  if (call) await logEvent(call.id, "status", event, data);
  return NextResponse.json({ ok: true });
}
```

**Verify (simulation, dev server):**
```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"PhoneNumber\" (id, \"workspaceId\", number) SELECT 'pn_test', id, '+918040001234' FROM \"Workspace\" WHERE slug='demo-clinic';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Call\" (id, \"workspaceId\", \"dograhCallId\", direction, status, \"fromNumber\", \"toNumber\") SELECT 'call_test', id, '12:9001', 'INBOUND', 'IN_PROGRESS', '+919812345678', '+918040001234' FROM \"Workspace\" WHERE slug='demo-clinic';"

SECRET=$(grep DOGRAH_WEBHOOK_SECRET .env | cut -d= -f2)
BODY='{"event":"call.ended","data":{"call_id":"12:9001","duration_seconds":95,"summary":"Test summary: caller asked timings.","transcript":"AI: Namaste...\nCaller: timings?"}}'

# Path 1: static secret header (what Dograh's webhook node really sends)
curl -s -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -H "x-webhook-secret: $SECRET" -d "$BODY"; echo

# Path 2: HMAC signature (integrations/tests)
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -H "x-dograh-signature: $SIG" -d "$BODY"; echo

# Path 3: no/garbage auth must fail (NEGATIVE TEST)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -d "$BODY"

# Path 4: wrong HMAC must fail (NEGATIVE TEST)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -H "x-dograh-signature: deadbeef" -d "$BODY"
```
**Expected:** `{"ok":true}` twice, then `401`, then `401`.

DB check + cleanup:
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, \"durationSec\" FROM \"Call\" WHERE \"dograhCallId\"='12:9001';"
```
**Expected:** `COMPLETED | 95`.
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"CallEvent\" WHERE \"callId\"='call_test'; DELETE FROM \"Call\" WHERE id='call_test'; DELETE FROM \"PhoneNumber\" WHERE id='pn_test';"
pkill -f "next dev" || true
```

---

## Step 10: Unit tests (Vitest)

**File `src/lib/dograh.test.ts`** (full content):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const SECRET = "test-secret-123";
const TRIGGER_OK = { status: "queued", workflow_run_id: 42, workflow_run_name: "r-42" };

async function load() {
  vi.resetModules();
  process.env.APP_URL = "https://app.test";
  process.env.DOGRAH_WEBHOOK_SECRET = SECRET;
  process.env.DOGRAH_RETRY_DELAY_MS = "1"; // fast tests
  return await import("./dograh");
}

function fakeResponse(status: number, json: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => (typeof json === "string" ? json : JSON.stringify(json)),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildWorkflowDefinition", () => {
  it("emits startCall → agentNode → webhook → endCall with one entry node", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "You are A.", maxCallSeconds: 300,
    });
    expect(def.nodes.map((n) => n.id)).toEqual(["start-1", "agent-1", "webhook-1", "end-1"]);
    expect(def.nodes.filter((n) => n.type === "startCall")).toHaveLength(1);
    expect(def.edges.map((e) => [e.source, e.target])).toEqual([
      ["start-1", "agent-1"],
      ["agent-1", "webhook-1"],
      ["webhook-1", "end-1"],
    ]);
  });

  it("default LLM chain: 3 entries, primary first, :nitro/:floor suffixes applied", async () => {
    const { buildWorkflowDefinition, DEFAULT_LLM_CHAIN } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "You are A.", maxCallSeconds: 300,
    });
    const agent = def.nodes.find((n) => n.id === "agent-1");
    expect(agent?.data.primary_llm_model).toBe(DEFAULT_LLM_CHAIN[0].model);
    expect(agent?.data.llm_chain).toEqual([
      { model: "meta-llama/llama-3.1-70b-instruct" },
      { model: "meta-llama/llama-3.1-8b-instruct:nitro" },
      { model: "deepseek/deepseek-chat:floor" },
    ]);
  });

  it("custom llmChain is preserved in order with variant suffixes", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "You are A.", maxCallSeconds: 300,
      llmChain: [
        { model: "openai/gpt-4o-mini", variant: "nitro" },
        { model: "qwen/qwen-2.5-72b-instruct" },
      ],
    });
    const agent = def.nodes.find((n) => n.id === "agent-1");
    expect(agent?.data.primary_llm_model).toBe("openai/gpt-4o-mini:nitro");
    expect(agent?.data.llm_chain).toEqual([
      { model: "openai/gpt-4o-mini:nitro" },
      { model: "qwen/qwen-2.5-72b-instruct" },
    ]);
  });

  it("withVariant adds a suffix but never double-suffixes", async () => {
    const { withVariant } = await load();
    expect(withVariant("gpt-4o-mini", "nitro")).toBe("gpt-4o-mini:nitro");
    expect(withVariant("gpt-4o-mini:floor", "nitro")).toBe("gpt-4o-mini:floor");
    expect(withVariant("gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("disclosure-first: recording disclosure is spoken before the greeting", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Namaste, Demo Clinic.", systemPrompt: "You are A.", maxCallSeconds: 300,
      recordingDisclosureText: "This call may be recorded for quality purposes.",
    });
    const start = def.nodes[0];
    expect(start.id).toBe("start-1");
    expect(start.data.prompt).toMatch(/^First say exactly this legal disclosure/);
    const prompt = start.data.prompt ?? "";
    const dIdx = prompt.indexOf("This call may be recorded");
    const gIdx = prompt.indexOf("Namaste, Demo Clinic.");
    expect(dIdx).toBeGreaterThanOrEqual(0);
    expect(gIdx).toBeGreaterThan(dIdx); // disclosure strictly before greeting
  });

  it("without disclosure: original greeting-only prompt", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hello.", systemPrompt: "You are A.", maxCallSeconds: 300,
    });
    expect(def.nodes[0].data.prompt).toBe(
      'Greet the caller with exactly this greeting, then listen: "Hello."'
    );
  });

  it("language mapping: auto → unknown, fixed → fixedLanguage, caller-select → unknown", async () => {
    const { sarvamLanguageCode } = await load();
    expect(sarvamLanguageCode({ languageMode: "auto" })).toBe("unknown");
    expect(sarvamLanguageCode({ languageMode: "fixed", fixedLanguage: "hi" })).toBe("hi");
    expect(sarvamLanguageCode({ languageMode: "caller-select" })).toBe("unknown");
    expect(sarvamLanguageCode({})).toBe("unknown");
  });

  it("voice mapping: voiceId passes through; clonedVoiceId overrides and flags", async () => {
    const { buildWorkflowDefinition } = await load();
    const base = { name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60 };
    const a = buildWorkflowDefinition({ ...base, voiceId: "meera" });
    const agentA = a.nodes.find((n) => n.id === "agent-1");
    expect(agentA?.data.voice_id).toBe("meera");
    expect(agentA?.data.voice_is_cloned).toBe(false);
    const b = buildWorkflowDefinition({ ...base, voiceId: "meera", clonedVoiceId: "clone-xyz" });
    const agentB = b.nodes.find((n) => n.id === "agent-1");
    expect(agentB?.data.voice_id).toBe("clone-xyz");
    expect(agentB?.data.voice_is_cloned).toBe(true);
  });

  it("pipeline mode: default stt-llm-tts; speech-to-speech passes through", async () => {
    const { buildWorkflowDefinition } = await load();
    const base = { name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60 };
    expect(
      buildWorkflowDefinition(base).nodes.find((n) => n.id === "agent-1")?.data.pipeline_mode
    ).toBe("stt-llm-tts");
    expect(
      buildWorkflowDefinition({ ...base, pipelineMode: "speech-to-speech" }).nodes.find(
        (n) => n.id === "agent-1"
      )?.data.pipeline_mode
    ).toBe("speech-to-speech");
  });

  it("pre-recorded audio: disclosureUrl wins and lands on the start node", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60,
      preRecordedAudio: {
        greetingUrl: "https://cdn.test/greet.mp3",
        disclosureUrl: "https://cdn.test/disc.mp3",
      },
    });
    expect(def.nodes[0].data).toMatchObject({
      use_pre_recorded_audio: true,
      pre_recorded_audio_url: "https://cdn.test/disc.mp3",
    });
  });

  it("webhook node posts to APP_URL with the shared-secret header", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60,
    });
    const hook = def.nodes.find((n) => n.id === "webhook-1");
    expect(hook?.data.endpoint_url).toBe("https://app.test/api/webhooks/dograh");
    expect(hook?.data.custom_headers).toEqual([{ key: "x-webhook-secret", value: SECRET }]);
  });
});

describe("request retry wrapper (via dograhTriggerCall)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("500 then 200 → retried once, then succeeds", async () => {
    const { dograhTriggerCall } = await load();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(500, "boom"))
      .mockResolvedValueOnce(fakeResponse(200, TRIGGER_OK));
    vi.stubGlobal("fetch", fetchMock);
    const res = await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    expect(res.workflow_run_id).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("400 → NO retry, throws DograhError with status", async () => {
    const { dograhTriggerCall, DograhError } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(400, "bad request"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" })
    ).rejects.toBeInstanceOf(DograhError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" }).catch((e) =>
      expect(e.status).toBe(400)
    );
  });

  it("network error (fetch rejects) → retried, then succeeds", async () => {
    const { dograhTriggerCall } = await load();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(fakeResponse(200, TRIGGER_OK));
    vi.stubGlobal("fetch", fetchMock);
    const res = await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    expect(res.workflow_run_id).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 is retried; exhausts retries and throws the last error", async () => {
    const { dograhTriggerCall, DograhError } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(429, "rate limited"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" })
    ).rejects.toBeInstanceOf(DograhError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 + MAX_RETRIES(3)
  });

  it("idempotency key: stable for identical calls, different for different bodies", async () => {
    const { dograhTriggerCall } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, TRIGGER_OK));
    vi.stubGlobal("fetch", fetchMock);
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919800000000" });
    const keys = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit & { headers: Record<string, string> }).headers["Idempotency-Key"]
    );
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]); // same logical call → same key
    expect(keys[2]).not.toBe(keys[0]); // different phone → different key
  });

  it("idempotencyKeyFor is deterministic", async () => {
    const { idempotencyKeyFor } = await load();
    const a = idempotencyKeyFor("POST", "/p", { x: 1 });
    const b = idempotencyKeyFor("POST", "/p", { x: 1 });
    const c = idempotencyKeyFor("POST", "/p", { x: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
```

**File `src/lib/dograhWebhook.test.ts`** (full content):

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyDograhWebhook } from "./dograhWebhook";

const SECRET = "whsec_test_123";
const BODY = JSON.stringify({ event: "call.ended", data: { call_id: "12:9001" } });
const hmac = (b: string) => createHmac("sha256", SECRET).update(b).digest("hex");
const H = (o: Record<string, string>) => new Headers(o);

afterEach(() => {
  delete process.env.DOGRAH_WEBHOOK_SECRET;
});

describe("verifyDograhWebhook", () => {
  it("dev fallback: no secret configured → allows", () => {
    delete process.env.DOGRAH_WEBHOOK_SECRET;
    expect(verifyDograhWebhook(H({}), BODY)).toBe(true);
  });

  it("static shared-secret header (what Dograh sends) → allows", () => {
    expect(verifyDograhWebhook(H({ "x-webhook-secret": SECRET }), BODY, SECRET)).toBe(true);
  });

  it("valid HMAC in x-dograh-signature → allows", () => {
    expect(verifyDograhWebhook(H({ "x-dograh-signature": hmac(BODY) }), BODY, SECRET)).toBe(true);
  });

  it("valid HMAC in x-webhook-signature → allows", () => {
    expect(verifyDograhWebhook(H({ "x-webhook-signature": hmac(BODY) }), BODY, SECRET)).toBe(true);
  });

  it("wrong static header and no signature → rejects", () => {
    expect(verifyDograhWebhook(H({ "x-webhook-secret": "nope" }), BODY, SECRET)).toBe(false);
  });

  it("tampered body → rejects", () => {
    expect(
      verifyDograhWebhook(H({ "x-dograh-signature": hmac(BODY) }), BODY + "x", SECRET)
    ).toBe(false);
  });

  it("wrong-length signature → rejects without throwing", () => {
    expect(verifyDograhWebhook(H({ "x-dograh-signature": "deadbeef" }), BODY, SECRET)).toBe(false);
  });

  it("right-length garbage signature → rejects", () => {
    expect(
      verifyDograhWebhook(H({ "x-dograh-signature": "a".repeat(64) }), BODY, SECRET)
    ).toBe(false);
  });

  it("no headers at all → rejects when secret is set", () => {
    expect(verifyDograhWebhook(H({}), BODY, SECRET)).toBe(false);
  });
});
```

**Do:**
```bash
cd /root/vaani-ai
npx vitest run src/lib/dograh.test.ts src/lib/dograhWebhook.test.ts
```
**Expected:** all tests pass — exactly **26 tests** (`dograh.test.ts`: 17,
`dograhWebhook.test.ts`: 9), exit 0.
**If it fails:** read the failing assertion; the fix belongs in `src/lib/dograh.ts` /
`src/lib/dograhWebhook.ts` to match the test (the tests encode the contract). One
retry; then STOP and report the failing test name + diff.

---

## Step 11: Live end-to-end proof (needs operator)

**Option A — real DID:** after guide 12 (public HTTPS), bind the DID to a published
workflow in Dograh (guide 06), call it from a mobile. **Option B — now:** use Dograh's
browser test-call feature (its UI offers talking to an agent without telephony) or
trigger an outbound call to the OPERATOR'S OWN mobile:

```bash
source /root/vaani-ai/.env
WF_UUID="<uuid printed by the Step 6 smoke test>"
curl -s -X POST "$DOGRAH_BASE_URL/api/v1/public/agent/workflow/$WF_UUID" \
  -H "X-API-Key: $DOGRAH_API_KEY" -H "Content-Type: application/json" \
  -d '{"phone_number": "+91<OPERATOR_MOBILE>", "initial_context": {}}'
```
**Expected:** `{"status":"...","workflow_run_id":<n>,...}` and the operator's phone
rings within a minute, AI says the test greeting. (This costs a few paise — fine.)

**Operator conversation script:**

| You say | Expected AI behavior |
|---|---|
| (call connects) | Test greeting within ~2 seconds |
| Anything / "testing" | Brief polite response (smoke agent), no >3s dead air |

**Hermes verify afterwards:**
```bash
cd /root/dograh && docker compose logs --tail 150 | grep -i -E "sarvam|openrouter|error|401|429" | tail -n 15
```
**Expected:** provider activity, no repeated 401/429/stack traces.

If neither option is possible yet (KYC pending): mark `DEFERRED — operator reason`,
continue; guides 05–09 work with the Step 9 simulation. Re-run before final
acceptance (guide 11 checklist).

---

## Step 12: Latency budget verification (readme §2 / §4.2)

**Budget:** streaming STT → streaming LLM → streaming TTS end-to-end **< 800ms** to
first audio byte; Vobiz contributes only **~80ms** on the telephony leg.

| Leg | Target | Where it is set |
|---|---|---|
| Vobiz telephony (SIP/RTP) | ~80ms | Vobiz network — nothing to tune |
| STT first-partial (Sarvam Saarika streaming) | ≤ 250ms | Dograh transcriber config |
| LLM time-to-first-token (OpenRouter) | ≤ 300ms | model choice — `:nitro` routing favors speed |
| TTS first-audio-byte (Sarvam Bulbul streaming, mulaw/8kHz) | ≤ 170ms | Dograh voice config |
| **Total** | **≤ 800ms** | measured below |

**Where to READ latency:**
1. Dograh container logs — the Pipecat-based pipeline logs per-turn latency/TTFB lines.
2. Dograh tracing (`docs.dograh.com/configurations/tracing.md`) if enabled in the UI.
3. Per-run `usage_info` / `cost_info` via `GET /api/v1/workflow/{id}/runs/{run_id}` and
   `GET /api/v1/organizations/usage/runs`.

**File `scripts/check-latency.sh`** (full content):

```bash
#!/usr/bin/env bash
# Vaani AI — latency budget check (readme §2): streaming STT->LLM->TTS < 800ms E2E,
# Vobiz telephony leg ~80ms. Read-only; safe to run any time.
set -u
BUDGET=${LATENCY_BUDGET_MS:-800}
echo "== latency budget: end-to-end first-audio < ${BUDGET}ms (vobiz leg ~80ms) =="
echo
echo "-- 1. Dograh pipeline latency lines (last 2000 log lines) --"
cd /root/dograh
docker compose logs --tail 2000 2>/dev/null \
  | grep -i -E "latency|ttfb|time.to.first|stt.*ms|llm.*ms|tts.*ms" | tail -n 20
echo
echo "-- 2. Latest run usage/cost info via Dograh API --"
cd /root/vaani-ai
set -a; source .env; set +a
curl -s --max-time 10 -H "X-API-Key: ${DOGRAH_API_KEY}" \
  "${DOGRAH_BASE_URL}/api/v1/organizations/usage/runs" | head -c 1200
echo
echo
echo "== done. If section 1 is empty, discover this Dograh version's metric names with:"
echo "   cd /root/dograh && grep -ri -E 'latency|ttfb' docs/ README.md 2>/dev/null | head"
```

**Do + Verify:**
```bash
cd /root/vaani-ai
chmod +x scripts/check-latency.sh
./scripts/check-latency.sh
```
**Expected:** exit 0; the two section headers print; section 1 shows latency/TTFB log
lines after at least one real/test call has happened (empty before the first call is
OK); section 2 shows JSON (possibly an empty list before any run).

**Tuning knobs (exact locations):**

| Knob | Location | How |
|---|---|---|
| Interruption / barge-in | per-node `allow_interrupt` in `buildWorkflowDefinition` (`src/lib/dograh.ts`) | already set: `false` on start (disclosure must complete), `true` on the agent node |
| VAD (voice-activity detection: silence threshold, min speech duration) | Dograh env: `grep -ri -E "vad\|silero\|silence\|chunk" /root/dograh/.env.example /root/dograh/docs 2>/dev/null \| head` — set the discovered vars in `/root/dograh/.env`, then `docker compose restart`. Lower end-of-speech silence → faster turns, too low → cuts callers off. Start at the Dograh default; tune only if Step 12 shows STT leg > 250ms | OPERATOR GATE: exact var names differ per Dograh version — report what the grep found |
| LLM speed | `llmChain` in `buildWorkflowDefinition` — prefer `:nitro` variants for latency-sensitive agents | readme §4.2 |
| TTS format | Dograh voice/inference-provider config (UI or `/root/dograh/.env`): Sarvam Bulbul streaming, mulaw/8kHz for telephony | readme §2 |
| Streaming chunk sizes | same discovery grep as VAD (`chunk`); only touch if TTS leg > 170ms | OPERATOR GATE as above |

---

## Step 13: Reliability — health-checked SIP trunk + redundant media notes (readme §12)

The Dograh API client retry wrapper (backoff + idempotency) is already in
`src/lib/dograh.ts` (Step 6). The campaign worker's per-contact call-setup retry is
guide 07 — it builds on `dograhTriggerCall`, which is now retry-safe.

**File `scripts/check-trunk.sh`** (full content — cron-friendly; non-zero exit = alert):

```bash
#!/usr/bin/env bash
# Vaani AI — voice-stack / SIP-trunk health check (readme §12).
# Cron:  */5 * * * * /root/vaani-ai/scripts/check-trunk.sh >> /var/log/vaani-trunk.log 2>&1
# Exit 0 = all green; exit 1 = at least one check failed (cron mail/alert fires).
set -u
cd /root/vaani-ai
set -a; source .env; set +a
FAIL=0
ts() { date -Is; }

# 1. Dograh process health
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${DOGRAH_BASE_URL}/api/v1/health" || echo 000)
if [ "$CODE" = "200" ]; then echo "$(ts) dograh-health OK (http 200)";
else echo "$(ts) dograh-health FAIL (http $CODE)"; FAIL=1; fi

# 2. Dograh auth + telephony configs reachable (trunk config still valid server-side)
CODE=$(curl -s -o /tmp/telephony-configs.json -w "%{http_code}" --max-time 10 \
  -H "X-API-Key: ${DOGRAH_API_KEY}" \
  "${DOGRAH_BASE_URL}/api/v1/organizations/telephony-configs" || echo 000)
if [ "$CODE" = "200" ]; then
  N=$(grep -o '"id"' /tmp/telephony-configs.json | wc -l)
  echo "$(ts) dograh-telephony OK ($N config(s))"
else echo "$(ts) dograh-telephony FAIL (http $CODE)"; FAIL=1; fi

# 3. Vobiz REST API reachability + credentials
#    OPERATOR GATE: if Vobiz documents a different account-info path, set
#    VOBIZ_ACCOUNT_PATH in .env. 404 = wrong path (WARN), 401/403 = bad creds (FAIL).
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -u "${VOBIZ_AUTH_ID:-}:${VOBIZ_AUTH_TOKEN:-}" \
  "${VOBIZ_API_BASE:-https://api.vobiz.ai}${VOBIZ_ACCOUNT_PATH:-/v1/account}" || echo 000)
case "$CODE" in
  200)    echo "$(ts) vobiz-api OK (http 200)";;
  401|403) echo "$(ts) vobiz-api FAIL auth (http $CODE)"; FAIL=1;;
  404)    echo "$(ts) vobiz-api WARN path 404 — confirm VOBIZ_ACCOUNT_PATH with Vobiz docs";;
  *)      echo "$(ts) vobiz-api FAIL (http $CODE)"; FAIL=1;;
esac

exit $FAIL
```

**Do + Verify:**
```bash
cd /root/vaani-ai
chmod +x scripts/check-trunk.sh
./scripts/check-trunk.sh; echo "exit: $?"
```
**Expected:** three lines — `dograh-health OK (http 200)`,
`dograh-telephony OK (1 config(s))` (0 configs is OK before Step 4 is done — WARN
only), `vobiz-api OK (http 200)` (or the WARN 404 line until the operator confirms
`VOBIZ_ACCOUNT_PATH`); `exit: 0` unless a hard FAIL line printed.
**If it fails:** `dograh-health FAIL` → Dograh down: `cd /root/dograh && docker compose ps && docker compose logs --tail 30`.
`vobiz-api FAIL auth` → wrong `VOBIZ_AUTH_ID/VOBIZ_AUTH_TOKEN` in `.env` — ask operator. Max 2 attempts, then STOP and report.

**Install the cron (operator-approved):**
```bash
( crontab -l 2>/dev/null | grep -v check-trunk.sh ; echo "*/5 * * * * /root/vaani-ai/scripts/check-trunk.sh >> /var/log/vaani-trunk.log 2>&1" ) | crontab -
crontab -l | grep check-trunk
```
**Expected:** the cron line prints.

**Redundant media paths (notes, no code):**
- Dograh abstracts telephony; a second telephony-config (BYOC, Step 15) is the hot
  standby trunk. If Vobiz degrades, mark the BYOC config `is_default_outbound: true`
  via `POST /api/v1/organizations/telephony-configs` update (or the Dograh UI) —
  outbound campaigns then flow over the second carrier with no app change.
- Inbound redundancy: point a second DID (different carrier) at the same Dograh
  inbound URL; bind it to the same workflow (guide 06 bind call).
- Media path redundancy inside the pipeline (SRTP/TLS on Vobiz trunks, readme §11) is
  configured on the Vobiz dashboard — OPERATOR GATE: enable TLS/SRTP there.

---

## Step 14: Hybrid pre-recorded + TTS (readme §4.2)

**Rationale:** greetings and legal disclosures are identical on every call. Pre-recording
them removes ~10–15s of per-call TTS synthesis — up to **3× cheaper** on the fixed
overhead portion — and guarantees compliance-critical lines are said perfectly, every
time. The builder (Step 6) already wires `preRecordedAudio` into the start node.

**OPERATOR GATE:** Dograh documents pre-recorded audio
(`docs.dograh.com/voice-agent/pre-recorded-audio.md`) but the exact node-data field
names are NOT in our extracted contract. After the smoke test below, Hermes verifies:
```bash
source /root/vaani-ai/.env
curl -s "$DOGRAH_BASE_URL/openapi.json" | grep -io -E '"[a-z_]*(audio|recording)[a-z_]*"' | sort -u | head -20
grep -ri -E "pre.?recorded" /root/dograh/docs /root/dograh/README.md 2>/dev/null | head -5
```
If the live schema shows different field names than `use_pre_recorded_audio` /
`pre_recorded_audio_url`, update ONLY those two keys in `buildWorkflowDefinition` and
report the deviation. If the live version 422s on them, remove the two keys (prompt
fallback keeps working) and report.

**File `scripts/upload-prerecorded.ts`** (full content — uploads one audio file to
MinIO bucket `vaani-assets` and prints its public URL):

```ts
/**
 * Upload a pre-recorded audio file (mp3/wav) to MinIO bucket "vaani-assets" and print
 * its public URL — for hybrid pre-recorded + TTS agents (readme §4.2).
 * Usage: npx tsx scripts/upload-prerecorded.ts ./audio/disclosure-en.mp3
 */
import { Client } from "minio";
import { basename } from "node:path";
import { statSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx scripts/upload-prerecorded.ts <file.mp3|file.wav>");
  process.exit(1);
}
statSync(file); // throws if the file does not exist

const endpoint = new URL(process.env.S3_ENDPOINT ?? "http://localhost:9000");
const client = new Client({
  endPoint: endpoint.hostname,
  port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
  useSSL: endpoint.protocol === "https:",
  accessKey: process.env.S3_ACCESS_KEY ?? "",
  secretKey: process.env.S3_SECRET_KEY ?? "",
});

const BUCKET = "vaani-assets";
const key = `prerecorded/${Date.now()}-${basename(file)}`;

const exists = await client.bucketExists(BUCKET).catch(() => false);
if (!exists) {
  await client.makeBucket(BUCKET);
  // Public read: Dograh must be able to fetch the audio by URL.
  await client.setBucketPolicy(
    BUCKET,
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${BUCKET}/*`],
        },
      ],
    })
  );
}
await client.fPutObject(BUCKET, key, file);
const base = (process.env.S3_ENDPOINT ?? "http://localhost:9000").replace(/\/$/, "");
console.log(`uploaded: ${BUCKET}/${key}`);
console.log(`public url: ${base}/${BUCKET}/${key}`);
```

**Do + Verify (synthetic beep file — real studio recordings come from the operator later):**
```bash
cd /root/vaani-ai
npm ls minio --depth=0 || npm install minio@8.0.2
python3 - <<'PY'
import struct, math
sr = 8000
frames = b''.join(struct.pack('<h', int(3000*math.sin(2*math.pi*440*t/sr))) for t in range(sr))
hdr = b'RIFF' + struct.pack('<I', 36+len(frames)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr*2, 2, 16) + b'data' + struct.pack('<I', len(frames))
open('/tmp/beep.wav', 'wb').write(hdr + frames)
print('wrote /tmp/beep.wav')
PY
set -a; source .env; set +a
npx tsx scripts/upload-prerecorded.ts /tmp/beep.wav | tee /tmp/upload.out
URL=$(grep 'public url:' /tmp/upload.out | awk '{print $3}')
curl -s -o /dev/null -w "%{http_code}\n" "$URL"
```
**Expected:** `uploaded: vaani-assets/prerecorded/...`, a `public url:` line, then `200`.
**If it fails:** `bucketExists`/`makeBucket` errors → MinIO not running
(`docker ps | grep minio`) or wrong `S3_*` env (guide 01). curl non-200 → bucket
policy didn't apply; re-run the upload once (policy is set on creation). Then STOP
and report.
Note: in production the URL must be HTTPS-reachable by Dograh — the Caddy proxy for
MinIO is guide 12; record this as an acceptance dependency.

**Wiring into an agent (consumed by guide 05):** pass the printed URL as
`preRecordedAudio: { disclosureUrl: "<url>" }` (and/or `greetingUrl`) in the
`AgentSpec` when publishing — the builder puts it on the start node (Step 6) and the
disclosure text remains in the prompt as the TTS fallback.

---

## Step 15: BYOC — bring-your-own-carrier SIP trunk (readme §9)

Vobiz stays the bundled default; a tenant/customer SIP carrier is added as a SECOND
Dograh telephony config. Skip this step entirely if `BYOC_SIP_HOST` is empty in `.env`
(report `SKIPPED — no BYOC carrier`).

1. **Discover what providers/credential fields this Dograh supports:**
```bash
source /root/vaani-ai/.env
curl -s -H "X-API-Key: $DOGRAH_API_KEY" \
  "$DOGRAH_BASE_URL/api/v1/organizations/telephony-configs/providers" | head -c 2000; echo
```
**Expected:** JSON listing providers (vobiz, twilio, plivo, telnyx, vonage, cloudonix,
asterisk, ...) and each one's required credential fields.
**If 404:** the path differs in this version — find it:
`curl -s "$DOGRAH_BASE_URL/openapi.json" | grep -o '"/api/v1/organizations/telephony-configs[^"]*"' | sort -u`,
use the providers path, and report the deviation.

2. **Create the BYOC config** — build `config` with EXACTLY the field names the
providers endpoint listed for the SIP/custom provider (template below uses common
names; substitute from step 1 output):
```bash
source /root/vaani-ai/.env
curl -s -X POST "$DOGRAH_BASE_URL/api/v1/organizations/telephony-configs" \
  -H "X-API-Key: $DOGRAH_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "BYOC custom SIP",
    "is_default_outbound": false,
    "config": {
      "provider": "<custom|asterisk — from step 1>",
      "sip_host": "'"$BYOC_SIP_HOST"'",
      "sip_port": '"${BYOC_SIP_PORT:-5060}"',
      "username": "'"$BYOC_SIP_USERNAME"'",
      "password": "'"$BYOC_SIP_PASSWORD"'",
      "transport": "'"${BYOC_SIP_TRANSPORT:-udp}"'"
    }
  }'
```
**Expected:** JSON with the created config (note its `id`) — no 401/403/422.

3. **OPERATOR GATE — provider-side work Hermes cannot do:**
   - In the carrier's portal, allow SIP auth from the VPS IP and point inbound at
     Dograh's inbound handler URL (same pattern as Step 4; confirm for the custom
     provider in `/root/dograh` docs — see `docs.dograh.com/integrations/telephony/custom.md`
     and `.../asterisk-ari.md`).
   - Confirm the exact credential field names from step 1's output; if the carrier
     needs a REGISTER trunk vs IP-auth, capture which.
   - If Dograh has NO generic SIP/custom provider in step 1's list: STOP and report —
     BYOC then requires Dograh's custom-telephony integration (a code change inside
     Dograh), which is out of scope for v1; log it for the v2 backlog.
4. When a BYOC DID is later added in our app (guide 06), set
   `PhoneNumber.provider = "byoc"` so routing/reporting distinguishes it.

---

## Step 16: Vobiz WhatsApp Business API (readme §9) — `sendWhatsAppTemplate()`

Used by guides 06/07 for call follow-ups, confirmations, and payment links.
**OPERATOR GATE:** the exact Vobiz WhatsApp endpoint path/shape is not in our
contract set — the function is behind the `VOBIZ_API_BASE` + `VOBIZ_WHATSAPP_PATH`
config block from Step 5. Confirm the path/payload from `https://vobiz.ai/docs`
(Vobiz mirrors the WhatsApp Business Cloud API template-send shape) before the first
LIVE send; the unit tests below pin OUR side of the contract either way.

**File `src/lib/vobiz.ts`** (full content):

```ts
/**
 * Minimal Vobiz REST client — WhatsApp Business template sends (readme §9).
 * OPERATOR GATE: VOBIZ_WHATSAPP_PATH defaults to "/v1/whatsapp/messages" and the body
 * mirrors the WhatsApp Business Cloud API template-send shape. Confirm against
 * https://vobiz.ai/docs before the first live send; adjust ONLY VOBIZ_WHATSAPP_PATH /
 * VOBIZ_API_BASE in .env if Vobiz documents a different path.
 */

export class VobizError extends Error {
  constructor(public status: number, message: string) {
    super(`Vobiz ${status}: ${message}`);
  }
}

export type WhatsAppTemplateInput = {
  /** Recipient, E.164, e.g. "+919812345678". */
  to: string;
  /** Approved template name from the Vobiz/Meta console, e.g. "call_followup". */
  templateName: string;
  /** Template language code; default "en". */
  languageCode?: string;
  /** WhatsApp template components (header/body parameters). */
  components?: Array<Record<string, unknown>>;
};

export type WhatsAppSendResult = {
  /** Provider-side message id when the response carries one, else null. */
  providerMessageId: string | null;
  /** Raw parsed response body for logging/debugging. */
  raw: unknown;
};

export async function sendWhatsAppTemplate(
  input: WhatsAppTemplateInput
): Promise<WhatsAppSendResult> {
  const base = (process.env.VOBIZ_API_BASE ?? "https://api.vobiz.ai").replace(/\/$/, "");
  const path = process.env.VOBIZ_WHATSAPP_PATH ?? "/v1/whatsapp/messages";
  const authId = process.env.VOBIZ_AUTH_ID ?? "";
  const authToken = process.env.VOBIZ_AUTH_TOKEN ?? "";
  const sender = process.env.VOBIZ_WHATSAPP_SENDER ?? "";
  if (!authId || !authToken) throw new VobizError(0, "VOBIZ_AUTH_ID/VOBIZ_AUTH_TOKEN not set");
  if (!sender) throw new VobizError(0, "VOBIZ_WHATSAPP_SENDER not set");
  if (!/^\+[1-9]\d{6,14}$/.test(input.to)) throw new VobizError(0, `bad recipient: ${input.to}`);

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`,
    },
    body: JSON.stringify({
      from: sender,
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode ?? "en" },
        components: input.components ?? [],
      },
    }),
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

**File `src/lib/vobiz.test.ts`** (full content):

```ts
import { describe, it, expect, afterEach, vi } from "vitest";

async function load() {
  vi.resetModules();
  process.env.VOBIZ_API_BASE = "https://vobiz.test";
  process.env.VOBIZ_WHATSAPP_PATH = "/v1/whatsapp/messages";
  process.env.VOBIZ_AUTH_ID = "aid";
  process.env.VOBIZ_AUTH_TOKEN = "atok";
  process.env.VOBIZ_WHATSAPP_SENDER = "+918040001234";
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

describe("sendWhatsAppTemplate", () => {
  it("sends the template shape with Basic auth and returns providerMessageId", async () => {
    const { sendWhatsAppTemplate } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { message_id: "wamid.123" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendWhatsAppTemplate({
      to: "+919812345678",
      templateName: "call_followup",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ramesh" }] }],
    });
    expect(res.providerMessageId).toBe("wamid.123");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://vobiz.test/v1/whatsapp/messages");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("aid:atok").toString("base64")}`
    );
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("+918040001234");
    expect(body.to).toBe("+919812345678");
    expect(body.template.name).toBe("call_followup");
    expect(body.template.language.code).toBe("en");
  });

  it("401 → throws VobizError with status", async () => {
    const { sendWhatsAppTemplate, VobizError } = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(401, "unauthorized")));
    await expect(
      sendWhatsAppTemplate({ to: "+919812345678", templateName: "x" })
    ).rejects.toBeInstanceOf(VobizError);
  });

  it("missing sender config → throws before any fetch", async () => {
    vi.resetModules();
    process.env.VOBIZ_AUTH_ID = "aid";
    process.env.VOBIZ_AUTH_TOKEN = "atok";
    delete process.env.VOBIZ_WHATSAPP_SENDER;
    const { sendWhatsAppTemplate } = await import("./vobiz");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendWhatsAppTemplate({ to: "+919812345678", templateName: "x" })
    ).rejects.toThrow(/VOBIZ_WHATSAPP_SENDER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed recipient numbers before sending", async () => {
    const { sendWhatsAppTemplate } = await load();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendWhatsAppTemplate({ to: "9812345678", templateName: "x" })
    ).rejects.toThrow(/bad recipient/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai
npx vitest run src/lib/vobiz.test.ts
```
**Expected:** 4 tests pass.

**Live send (OPERATOR GATE — only after the operator confirms the endpoint path from
Vobiz docs and has an APPROVED template; costs paise):**
```bash
cd /root/vaani-ai
set -a; source .env; set +a
npx tsx -e "
import('./src/lib/vobiz').then((v) =>
  v.sendWhatsAppTemplate({ to: '+91<OPERATOR_MOBILE>', templateName: '<APPROVED_TEMPLATE>' })
).then((r) => console.log('sent:', r.providerMessageId))
 .catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
"
```
**Expected:** `sent: <id>` and the message arrives on the operator's phone.
**If it fails:** `Vobiz 404` → wrong path: operator confirms the path, set
`VOBIZ_WHATSAPP_PATH` in `.env`, retry once. `Vobiz 401` → creds. Still failing →
STOP and report; guides 06/07 must then treat WhatsApp sends as DISABLED (log-skip)
until green.

---

## Step 17: MCP server exposure (readme §9)

Dograh ships an MCP server (`docs.dograh.com/integrations/mcp.md`) so customers' AI
tools (Claude Code, Cursor, Codex) can create/modify agents programmatically.
**OPERATOR GATE:** Dograh's MCP is scoped to ONE Dograh organization — true
per-tenant isolation requires one Dograh org per tenant (verify with Dograh docs /
support before selling this to enterprise tenants). Until then we expose ONE
API-key-gated proxy route; the internal Dograh MCP endpoint is never public.

1. Operator: enable the MCP server in Dograh per its docs
   (`grep -ri mcp /root/dograh/docs /root/dograh/.env.example 2>/dev/null | head`),
   note the internal URL, set `DOGRAH_MCP_URL` in `.env` (e.g.
   `http://localhost:8000/mcp`). Generate `MCP_PROXY_KEY`: `openssl rand -hex 32`.

2. **Exempt `/api/mcp` from cookie auth in `src/middleware.ts`.** MCP clients carry no
   session cookie — without this, middleware 307-redirects them to `/login` and the
   route's own `x-mcp-key` check never runs. **Edit `src/middleware.ts`:** find this
   exact line inside `PUBLIC_PREFIXES`:
```ts
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
```
   and add ONE line directly after it:
```ts
  "/api/mcp",         // MCP proxy route does its own x-mcp-key check (guide 04 Step 17)
```
   Result:
```ts
const PUBLIC_PREFIXES = [
  "/api/webhooks/",   // Dograh/Razorpay webhooks have their own signature checks
  "/api/auth/",       // SSO start + callback routes set the cookie themselves
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
  "/api/mcp",         // MCP proxy route does its own x-mcp-key check (guide 04 Step 17)
  "/invite/",         // invite acceptance page handles its own auth logic
  "/_next/",
  "/favicon.ico",
];
```
   **Verify:**
```bash
cd /root/vaani-ai
grep -n '"/api/mcp"' src/middleware.ts && npm run typecheck
```
   **Expected:** the grep prints the new line; typecheck exit 0.
   **If it fails:** the `"/api/v1/"` anchor is missing → guide 03's middleware was not
   applied; restore `src/middleware.ts` from guide 03, then re-apply this one-line
   patch. One retry, then STOP and report.

3. **File `src/app/api/mcp/route.ts`** (full content):

```ts
import { NextRequest, NextResponse } from "next/server";

/**
 * MCP exposure scaffold (readme §9). Customers' AI tools connect to
 *   https://<app-domain>/api/mcp
 * with header  x-mcp-key: <MCP_PROXY_KEY>
 * and we forward to the internal Dograh MCP endpoint (DOGRAH_MCP_URL), which is
 * never exposed publicly. One key per deployment in v1 — see the OPERATOR GATE in
 * guide 04 Step 17 about per-tenant isolation.
 */

function upstreamUrl(req: NextRequest): string | null {
  const base = process.env.DOGRAH_MCP_URL;
  if (!base) return null;
  return base.replace(/\/$/, "") + req.nextUrl.search;
}

async function forward(req: NextRequest): Promise<NextResponse> {
  const proxyKey = process.env.MCP_PROXY_KEY ?? "";
  const presented = req.headers.get("x-mcp-key") ?? "";
  if (!proxyKey || presented !== proxyKey) {
    return NextResponse.json({ ok: false, error: "invalid MCP key" }, { status: 401 });
  }
  const url = upstreamUrl(req);
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "DOGRAH_MCP_URL not configured" },
      { status: 503 }
    );
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(url, {
    method: req.method,
    headers: {
      "content-type": req.headers.get("content-type") ?? "application/json",
      accept: req.headers.get("accept") ?? "application/json, text/event-stream",
    },
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export const dynamic = "force-dynamic";
export { forward as GET, forward as POST };
```

4. **Verify (curl, dev server):**
```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15
KEY=$(grep MCP_PROXY_KEY .env | cut -d= -f2)
# NEGATIVE: no key → 401 JSON from the ROUTE (proves middleware no longer 307-redirects)
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# wrong key → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/mcp \
  -H "x-mcp-key: wrong" -H "Content-Type: application/json" -d '{}'
# right key, DOGRAH_MCP_URL unset → 503 (proves gate ordering); once set → upstream response
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3000/api/mcp \
  -H "x-mcp-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
pkill -f "next dev" || true
```
**Expected:** first call prints `{"ok":false,"error":"invalid MCP key"}` then `401`
(NOT `307` — a 307 means the middleware patch in substep 2 is missing); second call
`401`; then either `{"ok":false,"error":"DOGRAH_MCP_URL not configured"}\n503`
(OPERATOR GATE open) or the Dograh MCP JSON-RPC response `\n200` (gate closed).
**If it fails:** `307` on any call → substep 2 was skipped or the dev server was
started before the middleware edit — restart the dev server and re-run once. `200` on
the first two → the route wasn't created correctly; fix and re-run once. Then STOP
and report.

---

## Step 18: Phase 4 scaffolding (readme §15) — voice cloning + speech-to-speech

Both scaffolds already shipped in the Step 6 builder; this step is the config
convention + gates. Do NOT skip.

1. **Voice cloning (brand voice).**
   - Scaffold: `AgentSpec.clonedVoiceId` → builder maps it to `voice_id` +
     `voice_is_cloned: true` on the agent node. When unset, nothing changes.
   - Persistence convention (guide 05 implements): store the clone id in the agent's
     `AgentVersion.config` JSON under key `clonedVoiceId`, and pass it into
     `buildWorkflowDefinition` at publish time.
   - **OPERATOR GATE:** confirm with Sarvam (Bulbul voice cloning is an enterprise
     feature) and/or Dograh (custom-voice support in
     `docs.dograh.com/configurations/voice.md`) that a cloned voice id can be used as
     a TTS speaker. Until confirmed, the field is INERT — never sold to customers.
2. **Speech-to-speech models (ultra-low latency).**
   - Scaffold: `AgentSpec.pipelineMode` → builder emits `pipeline_mode`
     (`stt-llm-tts` default | `speech-to-speech`) on the agent node. Rationale: S2S
     removes the STT and TTS legs (~400ms of the 800ms budget in Step 12).
   - **OPERATOR GATE:** confirm Dograh speech-to-speech inference-provider support
     (`docs.dograh.com/configurations/inference-providers.md`) and which S2S model id
     to use; then set `pipelineMode: "speech-to-speech"` and put the S2S model as the
     `llmChain` primary. Until confirmed, always publish with the default mode.
3. **Verify the scaffold is inert (unit tests already prove mapping):**
```bash
cd /root/vaani-ai
npx vitest run src/lib/dograh.test.ts 2>&1 | tail -n 5
```
**Expected:** pass summary, exit 0.

---

## Step 19: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 04: Dograh client (retry+idempotency, failover chains, disclosure-first builder), dual-auth webhook, latency/trunk scripts, WhatsApp+BYOC+MCP scaffolds"
```

---

## Acceptance Checklist

- [ ] Dograh containers Up; `GET /api/v1/health` → 200
- [ ] Sarvam + OpenRouter keys accepted (Step 0 curls)
- [ ] `DOGRAH_API_KEY` verified against `/api/v1/workflow/fetch` → 200
- [ ] Vobiz telephony config created (UI or API) without auth errors
- [ ] `.env`/`.env.example` contain the guide-04 block (VOBIZ_*, BYOC_*, MCP, latency)
- [ ] Smoke workflow created + published via `src/lib/dograh.ts` (real id + uuid)
- [ ] Failover dry-run: workflow created with INVALID primary; chain of 3 intact
- [ ] Migration `agent_dograh_uuid` applied
- [ ] Webhook: static-secret AND HMAC accepted; garbage AND wrong-HMAC rejected (401)
- [ ] Vitest: `dograh.test.ts`, `dograhWebhook.test.ts`, `vobiz.test.ts` all green
- [ ] `scripts/check-latency.sh` runs, exit 0 (sections print)
- [ ] `scripts/check-trunk.sh` runs, exit 0 (or documented WARN), cron installed
- [ ] Pre-recorded upload: mp3/wav in MinIO `vaani-assets`, public URL → 200
- [ ] BYOC: `SKIPPED — no BYOC carrier` OR second telephony config created (+ OPERATOR GATE logged)
- [ ] WhatsApp: unit tests green; live send done or explicitly gated on Vobiz docs
- [ ] MCP: `"/api/mcp"` added to middleware `PUBLIC_PREFIXES`; route returns 401 (not 307) without key, 401 wrong key, 503-or-200 with key
- [ ] Phase 4 scaffolds present (`clonedVoiceId`, `pipelineMode`) with OPERATOR GATEs logged
- [ ] Live call answered by AI (or explicitly DEFERRED with reason)
- [ ] Git commit `phase 04: ...` exists

## FINAL REPORT format

```
STEP 0..19: PASS/FAIL/DEFERRED/SKIPPED — <one line of evidence each>
DOGRAH BASE URL: <url>   REPO USED: <git url>
SMOKE WORKFLOW: id=<n> uuid=<uuid>
FAILOVER DRY-RUN: id=<n> chain=<primary → fb1 → fb2>
TRUNK HEALTH: dograh=<OK|FAIL> telephony=<n configs> vobiz=<OK|WARN|FAIL>
LATENCY: last measured lines (or "no calls yet")
OPERATOR GATES OPEN: <list — vobiz whatsapp path / vobiz account path / dograh pre-recorded fields / BYOC provider fields / MCP per-tenant / voice cloning / speech-to-speech / SRTP-TLS>
DEVIATIONS: <any PATHS/schema/key-name changes vs this guide>
NEW ENV VARS SET: <names only, mask values>
ACCEPTANCE: n/19 checked
```
