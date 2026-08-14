import { NextRequest, NextResponse } from "next/server";
import { verifyVobizWebhook } from "@/lib/vobizWebhook";
import { handleInboundMessage, workspaceIdByNumber } from "@/lib/inbox";

/**
 * POST /api/webhooks/whatsapp — inbound WhatsApp (Vobiz → us).
 * Body mirrors the WhatsApp Business Cloud API webhook:
 *   { id, from, to, message: { text: { body } }, ... }
 * The recipient number (to) resolves the workspace. Unhandled payloads return
 * 200 so the provider doesn't retry forever.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyVobizWebhook(req.headers, raw)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";
  const message = (body.message ?? {}) as Record<string, unknown>;
  const text = (message.text ?? {}) as Record<string, unknown>;
  const msgBody = typeof text.body === "string" ? text.body : "";
  const externalId = typeof body.id === "string" ? body.id : null;

  // Validate the WhatsApp message actually has text (ignore media-only for now).
  if (!from || !to || !msgBody) {
    return NextResponse.json({ ok: true, ignored: true, reason: "no text body" });
  }

  const workspaceId = await workspaceIdByNumber(to);
  if (!workspaceId) {
    return NextResponse.json({ ok: true, ignored: true, reason: "unknown number" });
  }

  const result = await handleInboundMessage({
    workspaceId,
    channel: "WHATSAPP",
    from,
    body: msgBody.slice(0, 4000),
    externalId,
  });

  return NextResponse.json({ ok: true, conversationId: result.conversationId });
}
