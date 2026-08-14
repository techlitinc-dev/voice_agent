import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { dograhSupervisorAction, DograhError } from "@/lib/dograh";
import { canTransitionLiveMode, validateWhisperText, type LiveModeName } from "@/lib/liveState";

/**
 * POST /api/calls/[id]/whisper — send a coaching whisper for a live call.
 *
 * 1. Persists the whisper on LiveCallState (mode=WHISPER + whisperContext), so
 *    it is recorded and surfaced to the human on takeover (guide 03).
 * 2. Best-effort push to Dograh's supervisor API so the text is injected as TTS
 *    heard only by the agent. Dograh does NOT expose that endpoint yet
 *    (docs/new-features/01 §3.2, OPERATOR GATE in lib/dograh.ts) — when it
 *    404s, the whisper still lands on LiveCallState so the feature works
 *    end-to-end today and activates the moment Dograh ships the endpoint.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let ctx;
  try {
    ctx = await requirePermission("live:whisper");
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const { text } = (body ?? {}) as { text?: unknown };
  const v = validateWhisperText(text);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

  const call = await db.call.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: { liveState: true },
  });
  if (!call) {
    return NextResponse.json({ ok: false, error: "Call not found." }, { status: 404 });
  }
  if (call.status !== "IN_PROGRESS" && call.status !== "RINGING") {
    return NextResponse.json({ ok: false, error: "Call is not active anymore." }, { status: 409 });
  }

  const current = (call.liveState?.mode ?? "NONE") as LiveModeName;
  if (!canTransitionLiveMode(current, "WHISPER")) {
    return NextResponse.json(
      { ok: false, error: `Cannot whisper while in ${current} mode.` },
      { status: 409 }
    );
  }

  await db.liveCallState.upsert({
    where: { callId: call.id },
    create: {
      workspaceId: ctx.workspaceId, callId: call.id, status: call.status,
      mode: "WHISPER", supervisorUserId: ctx.user.id, whisperContext: v.text,
    },
    update: { mode: "WHISPER", supervisorUserId: ctx.user.id, whisperContext: v.text },
  });

  let dograhInjected = false;
  if (call.dograhCallId) {
    try {
      await dograhSupervisorAction(call.dograhCallId, { mode: "whisper", text: v.text });
      dograhInjected = true;
    } catch (e) {
      if (e instanceof DograhError) {
        console.warn(`dograh supervisor whisper unavailable (${e.status}): ${e.message}`);
      } else {
        console.error("dograh supervisor whisper failed", e);
      }
    }
  }

  await audit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "live.whisper", entity: "Call", entityId: call.id,
    metadata: { length: v.text.length, dograhInjected },
  });

  return NextResponse.json({ ok: true, dograhInjected });
}
