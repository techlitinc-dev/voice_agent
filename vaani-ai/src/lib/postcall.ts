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
