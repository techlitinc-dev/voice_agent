import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseHumanTransferConfig, decideTransfer } from "@/lib/fallbackPolicy";
import { emitWebhookEvent } from "@/lib/webhooks";

const bodySchema = z.object({
  call_id: z.string().min(1), // Dograh call id (= Call.dograhCallId)
  reason: z.string().max(200).optional(),
  queue: z.string().max(60).optional(),
  skill: z.string().max(60).optional(),
  explicit: z.boolean().default(true), // the AI only calls this on transfer intent
});

/**
 * POST /api/v1/transfer-request — called by Dograh's Call Transfer tool (dynamic
 * destination) mid-call. Secured with the shared internal secret.
 * Response: { ok, transferRequestId, queue, destination } — destination is the
 * E.164 number Dograh should transfer the leg to, or null when no human number is
 * configured for the queue (the AI then takes a message instead).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.DOGRAH_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const body = parsed.data;

  const call = await db.call.findUnique({
    where: { dograhCallId: body.call_id },
    include: { agent: { include: { toolConfigs: true } } },
  });
  if (!call) return NextResponse.json({ ok: false, error: "unknown call_id" }, { status: 404 });

  const config = parseHumanTransferConfig(
    call.agent?.toolConfigs.find((t) => t.tool === "HUMAN_TRANSFER")?.config
  );
  const decision = decideTransfer(config, {
    callerPhone: call.fromNumber,
    explicitHumanRequest: body.explicit,
  });
  const queue = body.queue ?? decision.queue;
  const skill = body.skill ?? decision.skill ?? null;

  // Idempotent: reuse an already-open request for this call.
  const open = await db.transferRequest.findFirst({
    where: { workspaceId: call.workspaceId, callId: call.id, status: { in: ["QUEUED", "RINGING"] } },
  });
  const tr =
    open ??
    (await db.transferRequest.create({
      data: {
        workspaceId: call.workspaceId,
        callId: call.id,
        queue,
        skill,
        reason: body.reason ?? decision.reason ?? "explicit-request",
        contextSnapshot: {
          summary: call.summary,
          transcriptTail: (call.transcript ?? "").slice(-1500),
          fromNumber: call.fromNumber,
        },
      },
    }));

  await emitWebhookEvent(call.workspaceId, "transfer.requested", {
    callId: call.id, transferRequestId: tr.id, queue: tr.queue, reason: tr.reason,
  });

  const destination = config.queueDestinations[tr.queue ?? ""] ?? null;
  return NextResponse.json({
    ok: true,
    transferRequestId: tr.id,
    queue: tr.queue,
    skill: tr.skill,
    destination,
    note: destination
      ? "Transfer the call leg to this number."
      : "No human destination configured for this queue — take a message instead.",
  });
}
