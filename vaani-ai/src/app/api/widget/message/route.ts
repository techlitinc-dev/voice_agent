import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findOrCreateConversation, recordMessage, enqueueAiReply } from "@/lib/inbox";

/**
 * POST /api/widget/message — public web-chat widget endpoint (doc §3.3).
 * Body: { workspace: "<slug>", sessionId: "<client-generated>", body: "text" }
 * Creates a WEBCHAT conversation keyed on (workspaceId, sessionId) and enqueues
 * the AI reply. Rate/abuse protection is intentionally light in v1 (the widget
 * is embedded on the customer's own site).
 */
export async function POST(req: NextRequest) {
  let body: { workspace?: unknown; sessionId?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const slug = typeof body.workspace === "string" ? body.workspace.trim().toLowerCase() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!slug || !sessionId || !text) {
    return NextResponse.json({ ok: false, error: "workspace, sessionId and body are required" }, { status: 400 });
  }

  const workspace = await db.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "workspace not found" }, { status: 404 });
  }

  const conversation = await findOrCreateConversation({
    workspaceId: workspace.id,
    channel: "WEBCHAT",
    contactId: null,
    externalId: `webchat:${sessionId}`,
  });

  await recordMessage({
    conversationId: conversation.id,
    channel: "WEBCHAT",
    direction: "inbound",
    senderType: "contact",
    body: text,
  });

  // AI auto-reply when enabled + an agent is assigned.
  if (conversation.aiEnabled && conversation.assignedAgentId) {
    await enqueueAiReply({ conversationId: conversation.id, workspaceId: workspace.id });
  }

  return NextResponse.json({ ok: true, conversationId: conversation.id });
}
