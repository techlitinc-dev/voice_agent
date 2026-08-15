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
  /** Cloned brand voice (docs/new-features/03) — when set, Dograh TTS uses the
   *  provider's cloned voice instead of the Sarvam Bulbul stock voice. */
  customVoice?: { provider: string; clonedVoiceId: string; language: string } | null;
  llmModel: string;
  temperature?: number; // LLM sampling temperature (0..1)
  maxTokens?: number; // LLM max output tokens
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
        return "- CRM UPDATE: when the caller is a serious lead, use the crm_write tool with action create_deal (params: title, value_paise, contact_phone — the caller's E.164 phone) to open a deal in the pipeline, action update_deal_stage (deal_id + stage_name) when the conversation advances or closes, action add_note (deal_id + body) for important details, and action schedule_task (deal_id + type + due_at + title) for follow-ups. Confirm before creating.";
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
  // Cloned brand voice (docs/new-features/03): route TTS to the provider's
  // cloned voice id. Sarvam clones use Bulbul v3 with the cloned id as voice.
  if (spec.customVoice?.clonedVoiceId) {
    const cv = spec.customVoice;
    if (cv.provider === "sarvam") {
      return {
        provider: "sarvam",
        model: "bulbul:v3",
        voice_id: cv.clonedVoiceId,
        pace: spec.controls.speakingPace ?? "normal",
        voice_map: spec.controls.voiceMap ?? {},
      };
    }
    return {
      provider: cv.provider, // elevenlabs | playht
      voice_id: cv.clonedVoiceId,
      language_code: cv.language,
      pace: spec.controls.speakingPace ?? "normal",
      voice_map: spec.controls.voiceMap ?? {},
    };
  }
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
    temperature: spec.temperature ?? 0.7,
    max_tokens: spec.maxTokens ?? 300,
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
  // Live Dograh graph constraint (verified against guide 04): webhook nodes are
  // terminal integration nodes — NO incoming and NO outgoing edges. Dograh executes
  // the webhook after the workflow completes, so the conversation flows
  // agent → end directly and the webhook node is present but disconnected.
  edges.push({
    id: "edge-agent-end",
    source: "agent-1",
    target: "end-1",
    data: { label: "Conversation complete", condition: "The caller's need is fully handled or they want to end the call" },
  });

  nodes.push({
    id: "end-1",
    type: "endCall",
    position: { x: 1200, y: 0 },
    data: { name: "End", prompt: "Thank the caller warmly and say goodbye in their language." },
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
