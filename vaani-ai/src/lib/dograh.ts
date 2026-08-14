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
  createDraft: (id: number) => `/api/v1/workflow/${id}/create-draft`,
  publishWorkflow: (id: number) => `/api/v1/workflow/${id}/publish`,
  fetchWorkflow: (id: number) => `/api/v1/workflow/fetch/${id}`,
  run: (workflowId: number, runId: number) => `/api/v1/workflow/${workflowId}/runs/${runId}`,
  usageRuns: "/api/v1/organizations/usage/runs",
  triggerByUuid: (uuid: string) => `/api/v1/public/agent/workflow/${uuid}`,
  createTestRun: (id: number) => `/api/v1/workflow/${id}/runs`,
  // Supervisor live-coaching (real-time call coaching, docs/new-features/01).
  // OPERATOR GATE: Dograh has no documented supervisor endpoint yet (verified
  // against its OpenAPI spec — only call triggers + run lifecycle exist). The
  // path below is the one the feature doc targets; until Dograh ships it, the
  // caller (POST /api/calls/[id]/whisper) falls back to persisting the whisper
  // on LiveCallState.whisperContext, which the dashboard surfaces on handoff.
  supervisor: (dograhCallId: string) => `/api/v1/calls/${dograhCallId}/supervisor`,
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
    // Live Dograh instances authenticate via Authorization: Bearer (guide 04's
    // documented X-API-Key contract is also kept for compatibility). Sending both
    // is harmless — the server reads the one it expects.
    ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
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
  /** readme §4.2 hybrid pre-recorded + TTS: a Dograh org recording id (managed on the
   *  Dograh Recordings page) OR public URLs of mp3/wav files uploaded to MinIO
   *  (Step 14). Live Dograh 1.44.0 wires recordings by id (greeting_recording_id);
   *  the URL fields are retained for guide 05's upload flow but only recordingId is
   *  emitted into the workflow. */
  preRecordedAudio?: { recordingId?: string; greetingUrl?: string; disclosureUrl?: string };
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
 * Build a Dograh workflow_definition for one of our agents.
 *
 * Live Dograh 1.44.0 graph constraints (verified against the repo's OpenAPI spec +
 * api/tests/test_workflow_graph_constraints.py + the "clean" dto fixture):
 *   - startCall: no incoming edges
 *   - webhook:   NO incoming AND NO outgoing edges — it is a terminal integration
 *     node that fires AFTER the workflow completes (its payload_template runs with
 *     access to run_id / gathered_context / call metadata).
 * So the conversation flow is startCall → agentNode → endCall, and the webhook node
 * is present but disconnected (0 in / 0 out) — Dograh executes it on completion.
 * (Deviation from the guide's original agent→webhook→end wiring, which the live
 * instance rejects with "Webhook cannot have incoming/outgoing edges".)
 */
export function buildWorkflowDefinition(spec: AgentSpec) {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const secret = process.env.DOGRAH_WEBHOOK_SECRET ?? "";
  const chain = (spec.llmChain?.length ? spec.llmChain : DEFAULT_LLM_CHAIN).map((e) => ({
    model: withVariant(e.model, e.variant),
  }));
  const disclosure = spec.recordingDisclosureText?.trim() || null;
  const voiceId = spec.clonedVoiceId ?? spec.voiceId ?? "anushka";

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
          // Hybrid pre-recorded audio (readme §4.2). Live Dograh 1.44.0 schema
          // (verified against api/services/workflow/dto.py StartCallNodeData +
          // docs/voice-agent/start-call.mdx) uses greeting_type + greeting_recording_id
          // (a recording managed on the org Recordings page), NOT the guide's original
          // use_pre_recorded_audio / pre_recorded_audio_url keys. When a recording id
          // is provided, the greeting is played from the recording; otherwise the
          // prompt above guarantees the disclosure/greeting is spoken via TTS.
          ...(spec.preRecordedAudio?.recordingId
            ? { greeting_type: "recording", greeting_recording_id: spec.preRecordedAudio.recordingId }
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
        target: "end-1",
        data: {
          label: "Conversation complete",
          condition: "The caller's need is fully handled or they want to end the call",
        },
      },
      // The webhook node is intentionally disconnected (0 in / 0 out) — live Dograh
      // fires terminal webhook nodes after the workflow completes.
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
  // Live Dograh 1.44.0: a workflow must have a draft version before it can be
  // published ("No draft to publish" otherwise). create-draft is idempotent —
  // creating a draft from the current definition is the documented publish path.
  try {
    await request("POST", PATHS.publishWorkflow(id));
  } catch (e) {
    if (e instanceof DograhError && e.status === 400) {
      await request("POST", PATHS.createDraft(id));
      await request("POST", PATHS.publishWorkflow(id));
      return;
    }
    throw e;
  }
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

// ---------- Real-time call coaching (docs/new-features/01) ----------

export type DograhSupervisorAction =
  | { mode: "listen" }
  | { mode: "whisper"; text: string }
  | { mode: "barge" }
  | { mode: "takeover" };

/**
 * Send a supervisor action (listen / whisper / barge / takeover) for a live call.
 *
 * OPERATOR GATE: Dograh does NOT expose this endpoint yet — see PATHS.supervisor.
 * When it does, this posts the action and (for whisper) the text, which Dograh
 * injects as TTS heard only by the agent. Until then, the route that calls this
 * catches DograhError and falls back to persisting the whisper on
 * LiveCallState.whisperContext.
 */
export async function dograhSupervisorAction(
  dograhCallId: string,
  action: DograhSupervisorAction
): Promise<void> {
  await request("POST", PATHS.supervisor(dograhCallId), action);
}

/** Deep link into the Dograh WEB UI (visual flow editor / browser test call). */
export function dograhWorkflowUiUrl(dograhWorkflowId: string | number): string {
  const ui = (process.env.DOGRAH_UI_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${ui}/workflow/${dograhWorkflowId}`;
}
