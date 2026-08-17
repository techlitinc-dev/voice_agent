import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyDograhWebhook } from "@/lib/dograhWebhook";
import { processCompletedCall } from "@/lib/postcall";
import { emitWebhookEvent } from "@/lib/webhooks";
import { resolveAgentForCall } from "@/lib/ab-test";
import { callsStarted, callsCompleted, callDuration, webhooksReceived } from "@/lib/metrics";

type Data = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
};

/**
 * Parse Dograh's plain-text transcript ("AI: ...\nCaller: ...") into per-turn
 * rows for the CDR detail page. Unknown prefixes become SYSTEM turns.
 */
function parseTranscriptEntries(transcript: string): Array<{ speaker: "AGENT" | "CALLER" | "SYSTEM"; text: string }> {
  const entries: Array<{ speaker: "AGENT" | "CALLER" | "SYSTEM"; text: string }> = [];
  for (const raw of transcript.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(AI|Agent|Bot|Caller|System|SYSTEM):\s*(.*)$/i);
    if (m) {
      const speaker = m[1].toLowerCase();
      entries.push({
        speaker: speaker === "caller" ? "CALLER" : speaker === "system" || speaker === "sys" ? "SYSTEM" : "AGENT",
        text: m[2] || "",
      });
    } else {
      entries.push({ speaker: "SYSTEM", text: line });
    }
  }
  return entries;
}

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

  // Inbound webhook volume (observability doc §2.2).
  webhooksReceived.labels("dograh", "all").inc();

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
      // A/B attribution (docs 05 §3.8): resolve the serving published version
      // deterministically from the caller's phone, mirroring the outbound path.
      let agentVersionId: string | null = null;
      if (pn?.agentId) {
        const fromNumber = str(data.from_number);
        const [agent, versions] = await Promise.all([
          db.agent.findFirst({
            where: { id: pn.agentId, workspaceId },
            select: { pinnedVersionId: true },
          }),
          db.agentVersion.findMany({
            where: { agentId: pn.agentId, workspaceId, status: "PUBLISHED" },
            select: { id: true, isAbVariant: true, abTrafficPercent: true, dograhWorkflowId: true, dograhWorkflowUuid: true },
          }),
        ]);
        const resolved = fromNumber
          ? resolveAgentForCall({ agentId: pn.agentId, callerPhone: fromNumber, publishedVersions: versions, pinnedVersionId: agent?.pinnedVersionId ?? null })
          : null;
        agentVersionId = resolved?.versionId ?? null;
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
          agentVersionId,
          answeredAt: new Date(),
        },
      });
      await logEvent(call.id, "status", event, data);
      await emitWebhookEvent(call.workspaceId, "call.started", {
        callId: call.id, direction: call.direction, fromNumber: call.fromNumber, toNumber: call.toNumber,
      });
      callsStarted.labels(call.direction, call.workspaceId).inc();
      return NextResponse.json({ ok: true, created: call.id });
    }
    await db.call.update({
      where: { id: call.id },
      data: { status: "IN_PROGRESS", answeredAt: new Date() },
    });
    await logEvent(call.id, "status", event, data);
    await emitWebhookEvent(call.workspaceId, "call.started", {
      callId: call.id, direction: call.direction, fromNumber: call.fromNumber, toNumber: call.toNumber,
    });
    callsStarted.labels(call.direction, call.workspaceId).inc();
    return NextResponse.json({ ok: true });
  }

  // ---- call.ended / call.completed: finalize the CDR ----
  const ended = event === "call.ended" || event === "call.completed";
  if (ended) {
    if (!call) {
      // Tolerant idempotent path: an ended event for a call we never saw (or a
      // duplicate) is accepted, not an error — guide 11's burst test expects 200.
      return NextResponse.json({ ok: true, ignored: true, error: "unknown call" });
    }
    const update: Prisma.CallUpdateInput = { status: "COMPLETED", endedAt: new Date() };
    // Honor a terminal disposition in the payload (INBOUND-06/25): Dograh can
    // report no-answer / busy / voicemail / failed — the CDR must keep that,
    // otherwise missed-call callbacks and retry reconciliation never trigger.
    const terminalStatus = str(data.status) ?? str(data.disposition);
    const KNOWN_TERMINAL = ["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "VOICEMAIL"];
    if (terminalStatus && (KNOWN_TERMINAL as string[]).includes(terminalStatus)) {
      update.status = terminalStatus as Prisma.CallUpdateInput["status"];
    }
    const dur = num(data.duration_seconds);
    if (dur !== null) update.durationSec = dur;
    const summary = str(data.summary);
    if (summary) update.summary = summary;
    const transcript = str(data.transcript);
    if (transcript) {
      update.transcript = transcript;
      // The call-detail page renders per-turn TranscriptEntry rows (SentimentTranscript),
      // not the raw text — persist parsed turns so inbound CDRs show the transcript.
      const parsed = parseTranscriptEntries(transcript);
      if (parsed.length > 0) {
        await db.transcriptEntry.createMany({
          data: parsed.map((t, i) => ({
            callId: call.id,
            speaker: t.speaker,
            text: t.text,
            timestampMs: (i + 1) * 1000,
          })),
        });
      }
    }
    const outcome = str(data.outcome);
    if (outcome) update.outcome = outcome;
    // Real Dograh payloads carry a public recording URL. We park it as
    // "pending:<url>"; guide 08's sweeper downloads it into MinIO and replaces the key.
    const recUrl = str(data.recording_url) ?? str(data.recording_public_url);
    if (recUrl) update.recordingKey = `pending:${recUrl}`;
    if (Object.keys(update).length) {
      await db.call.update({ where: { id: call.id }, data: update });
    }
    // Call lifecycle metrics (observability doc §2.1/§2.2).
    callsCompleted.labels(call.direction, String(update.status ?? "COMPLETED"), call.workspaceId).inc();
    if (typeof update.durationSec === "number") {
      callDuration.labels(call.direction).observe(update.durationSec);
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
