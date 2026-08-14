/**
 * Chat-reply worker (docs/new-features/04 §4): generates an AI auto-reply for a
 * conversation, sends it on the conversation's channel, persists the outbound
 * message, and flips to PENDING_HUMAN when the AI decides a human is needed.
 */
import type { Job } from "bullmq";
import { db } from "../lib/db";
import type { ChatReplyJobData } from "../lib/queue";
import { generateAiReply, recordMessage, sendChannelMessage, notifyHumanAgents } from "../lib/inbox";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export async function chatReplyJob(job: Job<ChatReplyJobData>): Promise<void> {
  const { conversationId } = job.data;

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conversation) {
    log(`[chat-reply] conversation ${conversationId} missing — skipped`);
    return;
  }
  if (!conversation.aiEnabled) {
    log(`[chat-reply] ${conversationId} ai disabled — skipped`);
    return;
  }

  const outcome = await generateAiReply({ conversationId });

  if (outcome.kind === "none") {
    log(`[chat-reply] ${conversationId} no reply (${outcome.reason})`);
    return;
  }

  // Persist the outbound AI message first (source of truth for the inbox + webchat SSE).
  await recordMessage({
    conversationId,
    channel: conversation.channel,
    direction: "outbound",
    senderType: "ai",
    body: outcome.reply,
  });

  // Deliver on the channel.
  if (conversation.contact?.phone) {
    const sent = await sendChannelMessage({
      channel: conversation.channel,
      to: conversation.contact.phone,
      body: outcome.reply,
    });
    if (!sent.ok) {
      log(`[chat-reply] ${conversationId} send failed: ${sent.error}`);
      await recordMessage({
        conversationId,
        channel: conversation.channel,
        direction: "outbound",
        senderType: "system",
        body: "⚠️ Outbound delivery failed — a team member will follow up.",
        status: "FAILED",
      });
    }
  }

  // Human handoff (doc §5).
  if (outcome.kind === "handoff") {
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: "PENDING_HUMAN", aiEnabled: false },
    });
    await notifyHumanAgents({
      workspaceId: conversation.workspaceId,
      conversationId,
      channel: conversation.channel,
      contactName: conversation.contact?.name ?? null,
      reason: outcome.reason,
    });
    log(`[chat-reply] ${conversationId} handoff — ${outcome.reason}`);
  } else {
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: "OPEN", aiEnabled: true },
    });
  }

  log(`[chat-reply] ${conversationId} replied (${outcome.kind}) via ${conversation.channel}`);
}
