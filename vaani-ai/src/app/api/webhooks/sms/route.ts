import { NextRequest, NextResponse } from "next/server";
import { verifyVobizWebhook } from "@/lib/vobizWebhook";
import { handleInboundMessage, workspaceIdByNumber } from "@/lib/inbox";

/**
 * POST /api/webhooks/sms — inbound SMS (Vobiz → us).
 * Vobiz SMS webhook shape: { from, to, text | message, id? }.
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
  const msgBody = typeof body.text === "string" ? body.text : typeof body.message === "string" ? body.message : "";
  const externalId = typeof body.id === "string" ? body.id : null;

  if (!from || !to || !msgBody) {
    return NextResponse.json({ ok: true, ignored: true, reason: "no text body" });
  }

  const workspaceId = await workspaceIdByNumber(to);
  if (!workspaceId) {
    return NextResponse.json({ ok: true, ignored: true, reason: "unknown number" });
  }

  const result = await handleInboundMessage({
    workspaceId,
    channel: "SMS",
    from,
    body: msgBody.slice(0, 4000),
    externalId,
  });

  return NextResponse.json({ ok: true, conversationId: result.conversationId });
}
