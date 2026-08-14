"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { recordMessage, sendChannelMessage, markConversationRead } from "@/lib/inbox";

export type InboxResult = { ok: boolean; error?: string };

/** Human agent replies in the inbox (doc §5). Sends on the channel + persists. */
export async function replyToConversationAction(input: {
  conversationId: string;
  body: string;
}): Promise<InboxResult> {
  try {
    const ctx = await requirePermission("calls:read"); // inbox = conversations domain
    const parsed = z.object({ conversationId: z.string().min(1), body: z.string().min(1).max(4000) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Message is required." };

    const conversation = await db.conversation.findFirst({
      where: { id: parsed.data.conversationId, workspaceId: ctx.workspaceId },
      include: { contact: true },
    });
    if (!conversation) return { ok: false, error: "Conversation not found." };

    await recordMessage({
      conversationId: conversation.id,
      channel: conversation.channel,
      direction: "outbound",
      senderType: "agent",
      body: parsed.data.body,
    });

    if (conversation.contact?.phone) {
      const sent = await sendChannelMessage({
        channel: conversation.channel,
        to: conversation.contact.phone,
        body: parsed.data.body,
      });
      if (!sent.ok) {
        return { ok: false, error: `Saved locally but delivery failed: ${sent.error}` };
      }
    }

    // Human took over → conversation is OPEN (AI paused until re-enabled).
    await db.conversation.update({
      where: { id: conversation.id },
      data: { status: "OPEN", unreadCount: 0 },
    });

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "inbox.reply", entity: "Conversation", entityId: conversation.id,
      metadata: { channel: conversation.channel },
    });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Toggle AI auto-reply on/off for a conversation. */
export async function toggleAiAction(conversationId: string): Promise<InboxResult> {
  try {
    const ctx = await requirePermission("calls:read");
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, workspaceId: ctx.workspaceId },
    });
    if (!conversation) return { ok: false, error: "Conversation not found." };

    const next = !conversation.aiEnabled;
    await db.conversation.update({
      where: { id: conversationId },
      data: {
        aiEnabled: next,
        // Re-enabling AI on a PENDING_HUMAN thread returns it to AI-handled.
        ...(next && conversation.status === "PENDING_HUMAN" ? { status: "OPEN" } : {}),
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: next ? "inbox.ai_enable" : "inbox.ai_disable", entity: "Conversation", entityId: conversationId,
    });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Assign an AI agent to a conversation (or clear it). */
export async function assignAgentAction(input: { conversationId: string; agentId: string | null }): Promise<InboxResult> {
  try {
    const ctx = await requirePermission("calls:read");
    const parsed = z.object({ conversationId: z.string().min(1), agentId: z.string().nullable() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };

    const conversation = await db.conversation.findFirst({
      where: { id: parsed.data.conversationId, workspaceId: ctx.workspaceId },
    });
    if (!conversation) return { ok: false, error: "Conversation not found." };

    if (parsed.data.agentId) {
      const agent = await db.agent.findFirst({
        where: { id: parsed.data.agentId, workspaceId: ctx.workspaceId },
      });
      if (!agent) return { ok: false, error: "Agent not found." };
    }

    await db.conversation.update({
      where: { id: parsed.data.conversationId },
      data: { assignedAgentId: parsed.data.agentId },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: parsed.data.agentId ? "inbox.assign" : "inbox.unassign", entity: "Conversation", entityId: parsed.data.conversationId,
      metadata: { agentId: parsed.data.agentId },
    });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Change conversation status (RESOLVED / ARCHIVED / OPEN). */
export async function setConversationStatusAction(input: { conversationId: string; status: "OPEN" | "RESOLVED" | "ARCHIVED" }): Promise<InboxResult> {
  try {
    const ctx = await requirePermission("calls:read");
    const parsed = z.object({
      conversationId: z.string().min(1),
      status: z.enum(["OPEN", "RESOLVED", "ARCHIVED"]),
    }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid status." };

    const updated = await db.conversation.updateMany({
      where: { id: parsed.data.conversationId, workspaceId: ctx.workspaceId },
      data: { status: parsed.data.status },
    });
    if (updated.count === 0) return { ok: false, error: "Conversation not found." };

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "inbox.status", entity: "Conversation", entityId: parsed.data.conversationId,
      metadata: { status: parsed.data.status },
    });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Mark a conversation read when the inbox opens it. */
export async function markReadAction(conversationId: string): Promise<InboxResult> {
  try {
    const ctx = await requirePermission("calls:read");
    const updated = await db.conversation.updateMany({
      where: { id: conversationId, workspaceId: ctx.workspaceId },
      data: { unreadCount: 0 },
    });
    if (updated.count === 0) return { ok: false, error: "Conversation not found." };
    await markConversationRead(conversationId);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
