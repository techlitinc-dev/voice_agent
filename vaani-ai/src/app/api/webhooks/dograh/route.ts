import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyDograhWebhook } from "@/lib/dograhWebhook";
import { processCompletedCall } from "@/lib/postcall";

type Data = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
};

async function logEvent(callId: string, type: string, event: string, data: Data) {
  await db.callEvent.create({
    data: { callId, type, payload: { event, data } as Prisma.InputJsonValue },
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyDograhWebhook(req.headers, raw)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  let body: { event?: unknown; data?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const event = str(body.event) ?? "unknown";
  const data: Data =
    body.data && typeof body.data === "object" ? (body.data as Data) : {};
  const dograhCallId =
    str(data.call_id) ?? str(data.dograh_call_id) ?? str(data.run_call_id);
  if (!dograhCallId) {
    return NextResponse.json({ ok: false, error: "missing call_id" }, { status: 400 });
  }

  let call = await db.call.findUnique({ where: { dograhCallId } });

  // ---- call.started: create the CDR row if we have never seen this call ----
  if (event === "call.started") {
    if (!call) {
      const toNumber = str(data.to_number) ?? "";
      // Resolve tenant + agent from the dialed number ("unknown-number path").
      const pn = toNumber
        ? await db.phoneNumber.findFirst({ where: { number: toNumber } })
        : null;
      const workspaceId =
        pn?.workspaceId ??
        (await db.workspace.findFirst({ orderBy: { createdAt: "asc" } }))?.id;
      if (!workspaceId) {
        return NextResponse.json({ ok: false, error: "no workspace" }, { status: 409 });
      }
      call = await db.call.create({
        data: {
          workspaceId,
          dograhCallId,
          direction: "INBOUND",
          status: "IN_PROGRESS",
          fromNumber: str(data.from_number) ?? "unknown",
          toNumber,
          agentId: pn?.agentId ?? null,
          answeredAt: new Date(),
        },
      });
      await logEvent(call.id, "status", event, data);
      return NextResponse.json({ ok: true, created: call.id });
    }
    await db.call.update({
      where: { id: call.id },
      data: { status: "IN_PROGRESS", answeredAt: new Date() },
    });
    await logEvent(call.id, "status", event, data);
    return NextResponse.json({ ok: true });
  }

  // ---- call.ended / call.completed: finalize the CDR ----
  const ended = event === "call.ended" || event === "call.completed";
  if (ended) {
    if (!call) {
      return NextResponse.json({ ok: false, error: "unknown call" }, { status: 404 });
    }
    const update: Prisma.CallUpdateInput = { status: "COMPLETED", endedAt: new Date() };
    const dur = num(data.duration_seconds);
    if (dur !== null) update.durationSec = dur;
    const summary = str(data.summary);
    if (summary) update.summary = summary;
    const transcript = str(data.transcript);
    if (transcript) update.transcript = transcript;
    const outcome = str(data.outcome);
    if (outcome) update.outcome = outcome;
    // Real Dograh payloads carry a public recording URL. We park it as
    // "pending:<url>"; guide 08's sweeper downloads it into MinIO and replaces the key.
    const recUrl = str(data.recording_url) ?? str(data.recording_public_url);
    if (recUrl) update.recordingKey = `pending:${recUrl}`;
    if (Object.keys(update).length) {
      await db.call.update({ where: { id: call.id }, data: update });
    }
    await logEvent(call.id, "summary", event, data);
    // Fire-and-forget post-call processing (outcome, entities, DNC, lead capture,
    // voicemail, missed-call callback, fallback transfer, webhook fan-out).
    processCompletedCall(call.id).catch((e) => console.error("postcall failed", e));
    return NextResponse.json({ ok: true });
  }

  // ---- any other event: keep it on the call timeline if we know the call ----
  if (call) await logEvent(call.id, "status", event, data);
  return NextResponse.json({ ok: true });
}
