import { db } from "./db";
import { normalizeExtractedEntities, buildContactUpsert } from "./leadExtraction";
import { pushLeadToCrm } from "./crmPush";
import { recordVoicemailMessage } from "./voicemail";
import { notifyStaffMessage } from "./notify";
import { emitWebhookEvent } from "./webhooks";
import { billCall } from "./billing";
import { enqueueCallbackDial } from "./dialJobs";
import { parseHumanTransferConfig, decideTransfer } from "./fallbackPolicy";
import { recomputeLeadScore } from "./crm/scoring";

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

/**
 * Deterministic opt-out detector (spec §11 — never depend on the LLM for
 * compliance). Fires on common EN/Hinglish "stop calling me" phrasing.
 */
const DNC_PHRASES = [
  "stop calling me", "don't call me", "do not call me", "never call me",
  "stop calling", "don't call again", "do not call again", "never call again",
  "take me off your list", "remove my number", "remove me from",
  "mujhe dobara call mat karna", "mujhe mat call karo", "dobara call mat karna",
  "call mat karo", "phone mat karo", "baat mat karo",
];
function detectDncRequested(transcript: string): boolean {
  const t = transcript.toLowerCase();
  return DNC_PHRASES.some((p) => t.includes(p));
}

async function llmExtract(transcript: string): Promise<LlmResult> {
  const dncFromText = detectDncRequested(transcript);
  const fallback: LlmResult = {
    outcome: dncFromText ? "dnc-requested" : "completed",
    sentiment: "neutral", dncRequested: dncFromText,
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
    const dncFromText = detectDncRequested(transcript);
    return {
      outcome: dncFromText || parsed.dncRequested === true ? "dnc-requested" : OUTCOMES.includes(parsed.outcome) ? parsed.outcome : "other",
      sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
      dncRequested: dncFromText || parsed.dncRequested === true,
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

/** CRM automation (guide crm/01 §4.3): turn call outcomes into pipeline moves.
 *  - HOT interest → auto-create an OPEN deal in the default pipeline (if none open).
 *  - outcome "booked" → move the deal to the Won stage.
 *  Never throws; failures are logged and skipped so post-call processing continues.
 */

/** Outcome → follow-up task rules (guide crm/03 §4.1). */
const TASK_RULES: Record<string, { type: "CALL" | "EMAIL" | "DOCUMENT" | "FOLLOW_UP"; title: string; delayHours: number }> = {
  "callback-requested": { type: "CALL", title: "Callback requested by customer", delayHours: 24 },
  "send-quote": { type: "EMAIL", title: "Send quotation", delayHours: 4 },
  "document-pending": { type: "DOCUMENT", title: "Collect pending documents", delayHours: 48 },
  "payment-pending": { type: "FOLLOW_UP", title: "Follow up on payment", delayHours: 24 },
};

/** Auto-create a follow-up task from the call outcome (guide crm/03 §4.1). */
export async function autoCreateTasks(input: {
  workspaceId: string;
  callId: string;
  phone: string;
  outcome?: string | null;
}): Promise<void> {
  const rule = input.outcome ? TASK_RULES[input.outcome] : undefined;
  if (!rule) return;

  const contact = await db.contact.findFirst({
    where: { workspaceId: input.workspaceId, phone: input.phone },
    select: { id: true },
  });
  if (!contact) return;

  const deal = await db.deal.findFirst({
    where: { workspaceId: input.workspaceId, contactId: contact.id, status: "OPEN" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  // Dedupe: one open auto-task per (contact, outcome rule).
  const existing = await db.task.findFirst({
    where: {
      workspaceId: input.workspaceId,
      contactId: contact.id,
      title: rule.title,
      status: "PENDING",
    },
    select: { id: true },
  });
  if (existing) return;

  await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      dealId: deal?.id ?? null,
      contactId: contact.id,
      type: rule.type,
      title: rule.title,
      description: `Auto-created from call ${input.callId} (outcome: ${input.outcome})`,
      dueAt: new Date(Date.now() + rule.delayHours * 3600 * 1000),
    },
  });
}

export async function runCrmAutomation(input: {
  workspaceId: string;
  callId: string;
  phone: string;
  contactName?: string;
  interestScore?: string | null;
  outcome?: string | null;
}): Promise<void> {
  try {
    const contact = await db.contact.findFirst({
      where: { workspaceId: input.workspaceId, phone: input.phone },
      select: { id: true, name: true },
    });
    if (!contact) return; // no contact row → nothing to hang a deal on

    const pipeline = await db.pipeline.findFirst({
      where: { workspaceId: input.workspaceId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (!pipeline) return; // no CRM configured for this workspace

    const openDeal = await db.deal.findFirst({
      where: { workspaceId: input.workspaceId, contactId: contact.id, status: "OPEN" },
      orderBy: { createdAt: "desc" },
    });

    let dealId = openDeal?.id;
    if (!dealId && input.interestScore === "HOT") {
      const firstStage = await db.stage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { order: "asc" },
      });
      if (firstStage) {
        const deal = await db.deal.create({
          data: {
            workspaceId: input.workspaceId,
            pipelineId: pipeline.id,
            stageId: firstStage.id,
            contactId: contact.id,
            title: `${contact.name ?? input.contactName ?? "Lead"} — ${input.phone}`,
            source: `call:${input.callId}`,
            createdFromCallId: input.callId,
            attributes: { interestScore: input.interestScore },
          },
        });
        dealId = deal.id;
        await db.activity.create({
          data: {
            workspaceId: input.workspaceId,
            dealId: deal.id,
            contactId: contact.id,
            type: "DEAL_CREATED",
            title: `Deal created from ${input.interestScore} call`,
            description: `Auto-created for ${contact.name ?? input.phone}`,
            metadata: { callId: input.callId, reason: "HOT interest on completed call" },
            callId: input.callId,
          },
        });
      }
    }

    if (dealId && input.outcome === "booked") {
      const deal = await db.deal.findUnique({ where: { id: dealId }, select: { stageId: true } });
      const wonStage = deal ? await db.stage.findFirst({
        where: { pipelineId: pipeline.id, isWonStage: true },
        orderBy: { order: "asc" },
      }) : null;
      if (wonStage && deal && deal.stageId !== wonStage.id) {
        await db.deal.update({
          where: { id: dealId },
          data: { stageId: wonStage.id, status: "WON", closedAt: new Date(), closedReason: "booked on call" },
        });
        await db.activity.create({
          data: {
            workspaceId: input.workspaceId,
            dealId,
            contactId: contact.id,
            type: "DEAL_WON",
            title: `Deal won: ${wonStage.name}`,
            metadata: { callId: input.callId, outcome: "booked" },
            callId: input.callId,
          },
        });
      }
    }
  } catch (e) {
    console.error(`[crm-automation] failed for call ${input.callId}`, e);
  }
}

/** After-call automation for one ended call. Fire-and-forget from the webhook. */
export async function processCompletedCall(callId: string, hints: PostCallHints = {}): Promise<void> {
  const call = await db.call.findUnique({
    where: { id: callId },
    include: { agent: { include: { toolConfigs: true } } },
  });
  if (!call) return;

  // Meter FIRST (guide 09): wholesale rate card + plan markup → trial minutes or
  // wallet debit. Runs before every early return so answered calls without a
  // transcript (STT failure) are still billed. No-ops on unanswered calls
  // (durationSec = 0). Billing failures must never break post-call processing.
  try {
    await billCall(call.id);
  } catch (e) {
    console.error("billing failed for call", call.id, e);
  }

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

  // --- CRM automation (guide crm/01 §4.3): voice-call outcomes → pipeline -------
  await runCrmAutomation({
    workspaceId: call.workspaceId,
    callId: call.id,
    phone: call.fromNumber,
    contactName: entities.name ? String(entities.name) : undefined,
    interestScore: call.interestScore,
    outcome,
  });

  // --- Smart task creation (guide crm/03 §4.1): outcome → follow-up task -------
  await autoCreateTasks({
    workspaceId: call.workspaceId,
    callId: call.id,
    phone: call.fromNumber,
    outcome,
  });

  // --- Lead scoring (guide crm/04 §2.4): a call completes → recompute ----------
  const scoredContact = await db.contact.findFirst({
    where: { workspaceId: call.workspaceId, phone: call.fromNumber },
    select: { id: true },
  });
  if (scoredContact) {
    await recomputeLeadScore(call.workspaceId, scoredContact.id).catch((e) => console.error("[scoring] failed after call", e));
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
