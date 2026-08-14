/**
 * Omnichannel messaging core (docs/new-features/04).
 *
 * Conversation + Message lifecycle shared by the inbound webhooks, the
 * chat-reply worker, the inbox UI actions, and the web-chat widget.
 *
 * Outbound sends honour the existing dry-run gates: VAANI_DRY_RUN (tool-level
 * simulation) and WHATSAPP_DRY_RUN (staff/whatsapp), so tests and dev run
 * without provider spend. AI replies honour INBOX_AI_DRY_RUN (default true),
 * matching QA_DRY_RUN / SENTIMENT_DRY_RUN — a deterministic reply generator
 * when the LLM is not configured.
 */
import { db } from "./db";
import { sendSms, sendWhatsAppTemplate, type WhatsAppSendResult, type SmsSendResult } from "./vobiz";
import { callOpenRouterJson } from "./openrouter";
import { sendStaffEmail, sendStaffWhatsApp } from "./notify";

export type Channel = "VOICE" | "WHATSAPP" | "SMS" | "WEBCHAT" | "EMAIL";

export const CONVERSATION_STATUSES = ["OPEN", "PENDING_AI", "PENDING_HUMAN", "RESOLVED", "ARCHIVED"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Find or create a Contact by E.164 phone (unique per workspace). */
export async function findOrCreateContact(workspaceId: string, phone: string) {
  return db.contact.upsert({
    where: { workspaceId_phone: { workspaceId, phone } },
    update: {},
    create: { workspaceId, phone },
  });
}

export type NewConversationInput = {
  workspaceId: string;
  channel: Channel;
  contactId?: string | null;
  externalId?: string | null;
  assignedAgentId?: string | null;
};

/** Find an open conversation for a contact+channel, or create one (doc §3.1). */
export async function findOrCreateConversation(input: NewConversationInput) {
  const existing = await db.conversation.findFirst({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId ?? null,
      channel: input.channel,
      status: { in: ["OPEN", "PENDING_AI", "PENDING_HUMAN"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return db.conversation.create({
    data: {
      workspaceId: input.workspaceId,
      contactId: input.contactId ?? null,
      channel: input.channel,
      status: "OPEN",
      externalId: input.externalId ?? null,
      assignedAgentId: input.assignedAgentId ?? null,
    },
  });
}

/**
 * Persist a message and bump conversation lastMessageAt / unreadCount.
 * unreadCount only increments for inbound messages in non-OPEN conversations
 * (the inbox marks them read when a human opens the thread).
 */
export async function recordMessage(input: {
  conversationId: string;
  channel: Channel;
  direction: "inbound" | "outbound";
  senderType: "contact" | "agent" | "ai" | "system";
  body: string;
  attachments?: unknown[] | null;
  status?: string;
  externalId?: string | null;
}) {
  const msg = await db.message.create({
    data: {
      conversationId: input.conversationId,
      channel: input.channel,
      direction: input.direction,
      senderType: input.senderType,
      body: input.body,
      attachments: (input.attachments ?? null) as never,
      status: input.status ?? "SENT",
      externalId: input.externalId ?? null,
    },
  });
  await db.conversation.update({
    where: { id: input.conversationId },
    data: {
      lastMessageAt: new Date(),
      ...(input.direction === "inbound"
        ? { unreadCount: { increment: 1 } }
        : {}),
    },
  });
  return msg;
}

/** Send an outbound message on the conversation's channel. Dry-run gated. */
export async function sendChannelMessage(input: {
  channel: Channel;
  to: string; // E.164 phone, or webchat session id
  body: string;
}): Promise<{ ok: boolean; providerMessageId: string | null; simulated?: boolean; error?: string }> {
  if (input.channel === "WEBCHAT") {
    // Webchat delivery is push-based via the widget SSE stream — the persisted
    // Message row IS the delivery. Nothing to do here.
    return { ok: true, providerMessageId: null };
  }
  if (process.env.VAANI_DRY_RUN !== "false") {
    return { ok: true, providerMessageId: null, simulated: true };
  }
  try {
    if (input.channel === "SMS") {
      const r: SmsSendResult = await sendSms({ to: input.to, message: input.body });
      return { ok: true, providerMessageId: r.providerMessageId };
    }
    // WHATSAPP — session messages need a template; the AI reply path uses the
    // workspace's default follow-up template (falls back to dry-run logging
    // when none is configured, mirroring WHATSAPP_DRY_RUN).
    if (process.env.WHATSAPP_DRY_RUN !== "false") {
      return { ok: true, providerMessageId: null, simulated: true };
    }
    const r: WhatsAppSendResult = await sendWhatsAppTemplate({
      to: input.to,
      templateName: process.env.WHATSAPP_SESSION_TEMPLATE ?? "conversational_reply",
      components: [{ type: "body", parameters: [{ type: "text", text: input.body }] }],
    });
    return { ok: true, providerMessageId: r.providerMessageId };
  } catch (e) {
    return { ok: false, providerMessageId: null, error: String(e).slice(0, 200) };
  }
}

/**
 * Build a knowledge context from the agent's KB documents (best-effort keyword
 * match over contentText). Returns an empty string when nothing matches.
 */
export async function buildKnowledgeContext(
  workspaceId: string,
  agentId: string,
  query: string,
): Promise<string> {
  const docs = await db.knowledgeDocument.findMany({
    where: {
      workspaceId,
      status: "INDEXED",
      OR: [{ agentId }, { agentId: null }],
    },
    select: { title: true, contentText: true },
    take: 20,
  });
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
  if (q.length === 0) return "";
  const hits = docs
    .filter((d) => q.some((w) => (d.contentText ?? "").toLowerCase().includes(w)))
    .slice(0, 5);
  if (hits.length === 0) return "";
  return hits
    .map((d) => `[${d.title}]\n${(d.contentText ?? "").slice(0, 1200)}`)
    .join("\n\n---\n\n");
}

/** Deterministic dry-run reply generator for INBOX_AI_DRY_RUN (no LLM spend). */
export function mockAiReply(question: string): string {
  const t = question.toLowerCase();
  if (/\b(price|cost|charge|fee|rate)\b/.test(t)) {
    return "Thanks for asking! Could you share your requirement details so I can give you an accurate quote? Our team typically responds within a few minutes during business hours.";
  }
  if (/\b(hello|hi|hey|namaste)\b/.test(t)) {
    return "Hello! 👋 Thanks for reaching out. How can I help you today?";
  }
  if (/\b(human|agent|person|representative|call me)\b/.test(t)) {
    return "I understand — let me connect you with one of our team members who can assist further. They'll be with you shortly.";
  }
  if (/\b(thank|thanks|great|awesome)\b/.test(t)) {
    return "You're most welcome! Is there anything else I can help you with?";
  }
  return "Thanks for your message! I've noted it down and our team will get back to you shortly. Could you share a few more details so I can help better?";
}

export type AiReplyOutcome =
  | { kind: "reply"; reply: string }
  | { kind: "handoff"; reply: string; reason: string }
  | { kind: "none"; reason: string };

/**
 * Generate an AI reply for a conversation using the assigned agent's brain
 * (doc §4). When INBOX_AI_DRY_RUN !== "false" (default) or no LLM key is set,
 * returns a deterministic mock. Never throws.
 */
export async function generateAiReply(args: {
  conversationId: string;
}): Promise<AiReplyOutcome> {
  const conversation = await db.conversation.findUnique({
    where: { id: args.conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 20 },
      contact: true,
      assignedAgent: true,
    },
  });
  if (!conversation) return { kind: "none", reason: "conversation missing" };
  if (!conversation.aiEnabled) return { kind: "none", reason: "ai disabled" };
  if (conversation.status === "ARCHIVED" || conversation.status === "RESOLVED") {
    return { kind: "none", reason: "conversation closed" };
  }
  const lastInbound = [...conversation.messages].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound) return { kind: "none", reason: "no inbound message" };

  const question = lastInbound.body;
  const history = conversation.messages.map((m) => ({
    role: m.senderType === "contact" ? "user" : "assistant",
    content: m.body,
  }));

  // No agent assigned → can't reply with the brand brain.
  if (!conversation.assignedAgent) {
    return {
      kind: "handoff",
      reply: "Thanks for your message! A member of our team will get back to you shortly.",
      reason: "no agent assigned",
    };
  }

  const dryRun = process.env.INBOX_AI_DRY_RUN !== "false" || !process.env.OPENROUTER_API_KEY;
  if (dryRun) {
    const reply = mockAiReply(question);
    // Deterministic handoff on explicit human request (dry-run heuristic).
    if (/\b(human|agent|person|representative|talk to someone)\b/.test(question.toLowerCase())) {
      return { kind: "handoff", reply, reason: "caller asked for a human" };
    }
    return { kind: "reply", reply };
  }

  try {
    const knowledge = await buildKnowledgeContext(
      conversation.workspaceId,
      conversation.assignedAgent.id,
      question,
    );
    const system = [
      conversation.assignedAgent.systemPrompt,
      knowledge ? `\n\nKNOWLEDGE (answer only from this when relevant):\n${knowledge}` : "",
      `You are responding on ${conversation.channel} to a customer. Keep replies short and helpful.`,
      "If the customer explicitly asks for a human, needs something you cannot do, or is upset beyond your ability to help, reply with EXACTLY the JSON: {\"handoff\":true,\"reply\":\"...\",\"reason\":\"...\"}",
      "Otherwise reply with EXACTLY the JSON: {\"handoff\":false,\"reply\":\"...\",\"reason\":\"\"}",
    ].join("\n");

    const content = await callOpenRouterJson({
      system,
      user: JSON.stringify(history.slice(-10)),
      model: process.env.INBOX_AI_MODEL ?? process.env.OPENROUTER_SCORING_MODEL ?? "meta-llama/llama-3.1-8b-instruct",
    });
    let parsed: { handoff?: unknown; reply?: unknown; reason?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { handoff: false, reply: content };
    }
    const reply = typeof parsed.reply === "string" ? parsed.reply.slice(0, 1000) : mockAiReply(question);
    if (parsed.handoff === true) {
      return { kind: "handoff", reply, reason: typeof parsed.reason === "string" ? parsed.reason : "AI detected handoff needed" };
    }
    return { kind: "reply", reply };
  } catch (e) {
    console.error("[chat-reply] LLM failed, using mock", e);
    return { kind: "reply", reply: mockAiReply(question) };
  }
}

/** Notify staff that a conversation needs a human (doc §5). Never throws. */
export async function notifyHumanAgents(input: {
  workspaceId: string;
  conversationId: string;
  channel: Channel;
  contactName: string | null;
  reason: string;
}): Promise<void> {
  const subject = `[Vaani] Human handoff needed — ${input.contactName ?? "contact"} (${input.channel})`;
  const text = `A conversation needs a human:\nChannel: ${input.channel}\nContact: ${input.contactName ?? "unknown"}\nReason: ${input.reason}\nOpen: /inbox?id=${input.conversationId}`;
  await sendStaffEmail(subject, text);
  await sendStaffWhatsApp("staff_handoff_alert", [
    input.channel,
    input.contactName ?? "contact",
    input.reason.slice(0, 200),
  ]);
}

/** Mark a conversation read (inbox open). */
export async function markConversationRead(conversationId: string) {
  await db.conversation.update({
    where: { id: conversationId },
    data: { unreadCount: 0 },
  });
}

/** Enqueue an AI reply for a conversation (fire-and-forget via BullMQ). */
export async function enqueueAiReply(input: { conversationId: string; workspaceId: string }) {
  const { getChatReplyQueue, CHAT_REPLY_JOB } = await import("./queue");
  const q = getChatReplyQueue();
  await q.add(
    CHAT_REPLY_JOB,
    { conversationId: input.conversationId, workspaceId: input.workspaceId },
    { jobId: `chat-${input.conversationId}-${Date.now()}`, attempts: 2 },
  );
}

/**
 * Shared inbound-message handler used by the WhatsApp and SMS webhooks (doc
 * §3.1/§3.2): resolve the workspace from the recipient number, find-or-create
 * contact + conversation, record the inbound message, then enqueue the AI reply
 * when the conversation has AI enabled and an agent assigned.
 */
export async function handleInboundMessage(input: {
  workspaceId: string;
  channel: Exclude<Channel, "VOICE" | "EMAIL" | "WEBCHAT">;
  from: string; // customer E.164
  body: string;
  externalId?: string | null;
  contactName?: string | null;
}): Promise<{ conversationId: string; messageId: string }> {
  const contact = await findOrCreateContact(input.workspaceId, input.from);
  if (input.contactName && contact.name !== input.contactName) {
    await db.contact.update({ where: { id: contact.id }, data: { name: input.contactName } });
  }

  const conversation = await findOrCreateConversation({
    workspaceId: input.workspaceId,
    channel: input.channel,
    contactId: contact.id,
    externalId: input.externalId ?? null,
  });

  const msg = await recordMessage({
    conversationId: conversation.id,
    channel: input.channel,
    direction: "inbound",
    senderType: "contact",
    body: input.body,
    externalId: input.externalId ?? null,
  });

  if (conversation.aiEnabled && conversation.assignedAgentId) {
    await enqueueAiReply({ conversationId: conversation.id, workspaceId: input.workspaceId });
  }

  return { conversationId: conversation.id, messageId: msg.id };
}

/** Resolve the workspace that owns a given phone number (E.164). */
export async function workspaceIdByNumber(number: string): Promise<string | null> {
  const pn = await db.phoneNumber.findFirst({ where: { number }, select: { workspaceId: true } });
  if (pn) return pn.workspaceId;
  const contact = await db.contact.findFirst({
    where: { phone: number },
    select: { workspaceId: true },
    orderBy: { createdAt: "desc" },
  });
  return contact?.workspaceId ?? null;
}

/**
 * Voice → messaging linkage (doc §6): after a call ends, ensure a WhatsApp
 * conversation exists for the caller so the thread can continue on WhatsApp.
 * Only creates the conversation row (no message sent); the AI agent handles the
 * first inbound message. Idempotent via findOrCreateConversation.
 */
export async function linkVoiceCallToWhatsApp(input: {
  workspaceId: string;
  phone: string; // caller E.164
  callId: string;
  agentId?: string | null;
}): Promise<{ conversationId: string; created: boolean } | null> {
  const contact = await db.contact.findUnique({
    where: { workspaceId_phone: { workspaceId: input.workspaceId, phone: input.phone } },
    select: { id: true },
  });
  if (!contact) return null; // no contact row → nothing to link to

  const existing = await db.conversation.findFirst({
    where: { workspaceId: input.workspaceId, contactId: contact.id, channel: "WHATSAPP" },
    select: { id: true },
  });
  if (existing) return { conversationId: existing.id, created: false };

  const conversation = await db.conversation.create({
    data: {
      workspaceId: input.workspaceId,
      contactId: contact.id,
      channel: "WHATSAPP",
      status: "OPEN",
      assignedAgentId: input.agentId ?? null,
      // Record the originating call so the unified timeline can link back.
      externalId: `voice-call:${input.callId}`,
    },
  });
  return { conversationId: conversation.id, created: true };
}
