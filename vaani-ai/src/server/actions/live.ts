"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { LiveMode } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canTransitionLiveMode, validateWhisperText, permissionForMode, LIVE_MODES, type LiveModeName } from "@/lib/liveState";

export type ActionResult = { ok: boolean; error?: string };

const modeSchema = z.enum(LIVE_MODES);

async function loadActiveCall(callId: string, workspaceId: string) {
  const call = await db.call.findFirst({
    where: { id: callId, workspaceId },
    include: { liveState: true },
  });
  if (!call) return { error: "Call not found." as const };
  if (call.status !== "IN_PROGRESS" && call.status !== "RINGING") {
    return { error: "Call is not active anymore." as const };
  }
  return { call };
}

/** Set supervisor mode (LISTEN / WHISPER / BARGE / TAKEOVER / NONE). */
export async function setLiveModeAction(callId: string, mode: string): Promise<ActionResult> {
  try {
    const m = modeSchema.parse(mode) as LiveModeName;
    const ctx = await requirePermission(permissionForMode(m));
    const loaded = await loadActiveCall(callId, ctx.workspaceId);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    const { call } = loaded;

    const current = (call.liveState?.mode ?? "NONE") as LiveModeName;
    if (!canTransitionLiveMode(current, m)) {
      return { ok: false, error: `Cannot switch from ${current} to ${m}. Release first or escalate.` };
    }

    await db.liveCallState.upsert({
      where: { callId: call.id },
      create: {
        workspaceId: ctx.workspaceId, callId: call.id, status: call.status,
        mode: m as LiveMode, supervisorUserId: m === "NONE" ? null : ctx.user.id,
      },
      update: {
        mode: m as LiveMode,
        supervisorUserId: m === "NONE" ? null : ctx.user.id,
        ...(m === "NONE" ? { whisperContext: null } : {}),
      },
    });

    // Barge/takeover = human handoff: guarantee a TransferRequest exists so the
    // queue page shows it. OPERATOR GATE: instructing Dograh to splice the human
    // leg mid-call depends on Dograh support; until then the human joins via the
    // queue flow (accept → call the caller back / join per SOP).
    if (m === "BARGE" || m === "TAKEOVER") {
      const open = await db.transferRequest.findFirst({
        where: { workspaceId: ctx.workspaceId, callId: call.id, status: { in: ["QUEUED", "RINGING"] } },
      });
      if (!open) {
        await db.transferRequest.create({
          data: {
            workspaceId: ctx.workspaceId,
            callId: call.id,
            queue: "supervisor",
            reason: `supervisor-${m.toLowerCase()}`,
            status: m === "TAKEOVER" ? "ACCEPTED" : "QUEUED",
            acceptedByUserId: m === "TAKEOVER" ? ctx.user.id : null,
            acceptedAt: m === "TAKEOVER" ? new Date() : null,
            contextSnapshot: {
              summary: call.summary,
              transcriptTail: (call.transcript ?? "").slice(-1500),
              fromNumber: call.fromNumber,
              whisperContext: call.liveState?.whisperContext ?? null,
            },
          },
        });
      }
    }

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: `live.mode.${m.toLowerCase()}`, entity: "Call", entityId: call.id,
    });
    revalidatePath("/live");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Save whisper coaching text (also flips the call into WHISPER mode). */
export async function setWhisperAction(callId: string, text: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:whisper");
    const v = validateWhisperText(text);
    if (!v.ok) return { ok: false, error: v.error };
    const loaded = await loadActiveCall(callId, ctx.workspaceId);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    const { call } = loaded;

    const current = (call.liveState?.mode ?? "NONE") as LiveModeName;
    if (!canTransitionLiveMode(current, "WHISPER")) {
      return { ok: false, error: `Cannot whisper while in ${current} mode.` };
    }

    await db.liveCallState.upsert({
      where: { callId: call.id },
      create: {
        workspaceId: ctx.workspaceId, callId: call.id, status: call.status,
        mode: "WHISPER", supervisorUserId: ctx.user.id, whisperContext: v.text,
      },
      update: { mode: "WHISPER", supervisorUserId: ctx.user.id, whisperContext: v.text },
    });
    // OPERATOR GATE: no documented Dograh mid-call context-injection API. The text
    // is stored on LiveCallState.whisperContext and shown to the human on takeover.
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "live.whisper", entity: "Call", entityId: call.id,
      metadata: { length: v.text.length },
    });
    revalidatePath("/live");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Release supervisor control back to NONE. */
export async function releaseLiveAction(callId: string): Promise<ActionResult> {
  return setLiveModeAction(callId, "NONE");
}
