"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { assertFeatureGate } from "@/lib/feature-gates";
import { ensureBucket, putObject, deleteObject } from "@/lib/storage";
import {
  cloneVoice,
  validateVoiceSample,
  voiceStorageKey,
  voiceContentType,
  VOICE_PROVIDERS,
  type VoiceProvider,
} from "@/lib/voice-cloning";

export type VoiceResult = { ok: boolean; error?: string; id?: string };

const VOICES_BUCKET = process.env.S3_BUCKET_VOICES ?? "vaani-voices";

/** Enterprise gate + per-workspace clone limit (doc §4). */
async function assertVoiceQuota(workspaceId: string): Promise<string | null> {
  try {
    const gate = await assertFeatureGate(workspaceId, "premiumVoices");
    void gate;
  } catch {
    return "Custom voices require the Enterprise plan (or the premium-voices add-on) — upgrade in Billing.";
  }
  const [count] = await Promise.all([db.customVoice.count({ where: { workspaceId } })]);
  if (count >= 5) {
    return "Your plan allows 5 cloned voices. Delete one before cloning another.";
  }
  return null;
}

const createVoiceSchema = z.object({
  name: z.string().min(2).max(60),
  provider: z.enum(VOICE_PROVIDERS).default("elevenlabs"),
  language: z.string().min(2).max(10).default("hi"),
});

/**
 * Clone a brand voice from an uploaded sample (doc §3.1).
 * 1) gate: premiumVoices plan/add-on + 5-voice cap
 * 2) store the sample in MinIO (sampleKey)
 * 3) call the provider clone API (dry-run mock in dev)
 * 4) status: READY when the provider returned an id immediately, else PENDING
 *    (a future worker can poll provider status → TRAINING → READY).
 */
export async function createVoiceAction(formData: FormData): Promise<VoiceResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const quotaError = await assertVoiceQuota(ctx.workspaceId);
    if (quotaError) return { ok: false, error: quotaError };

    const parsed = createVoiceSchema.safeParse({
      name: String(formData.get("name") ?? "").trim(),
      provider: String(formData.get("provider") ?? "elevenlabs"),
      language: String(formData.get("language") ?? "hi").trim(),
    });
    if (!parsed.success) return { ok: false, error: "Check the voice name." };

    const file = formData.get("sample");
    if (!(file instanceof File)) return { ok: false, error: "Choose a sample audio file." };
    const check = validateVoiceSample(file.name, file.size);
    if (!check.ok) return check;

    // Unique name per workspace (schema @@unique([workspaceId, name])).
    const existing = await db.customVoice.findFirst({
      where: { workspaceId: ctx.workspaceId, name: parsed.data.name },
      select: { id: true },
    });
    if (existing) return { ok: false, error: "A voice with this name already exists." };

    const voice = await db.customVoice.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        provider: parsed.data.provider,
        language: parsed.data.language,
        status: "PENDING",
      },
    });

    const buf = Buffer.from(await file.arrayBuffer());
    await ensureBucket(VOICES_BUCKET);
    const sampleKey = await putObject(
      VOICES_BUCKET,
      voiceStorageKey(ctx.workspaceId, voice.id, "sample", file.name),
      buf,
      voiceContentType(file.name),
    );

    // Clone on the provider. Dry-run (default) returns a deterministic fake id.
    let clonedVoiceId: string | null = null;
    let status = "PENDING";
    let error: string | null = null;
    try {
      clonedVoiceId = await cloneVoice({
        provider: parsed.data.provider as VoiceProvider,
        name: parsed.data.name,
        sampleBuffer: buf,
      });
      status = "READY"; // v1: provider returned an id → usable immediately
    } catch (e) {
      status = "FAILED";
      error = e instanceof Error ? e.message : "Provider clone failed.";
    }

    await db.customVoice.update({
      where: { id: voice.id },
      data: { sampleKey, clonedVoiceId, status, error, previewKey: sampleKey },
    });

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "voice.create", entity: "CustomVoice", entityId: voice.id,
      metadata: { name: parsed.data.name, provider: parsed.data.provider, status },
    });
    revalidatePath("/settings/voices");
    revalidatePath("/agents");
    return { ok: true, id: voice.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Re-run cloning for a FAILED voice (retry) or manually mark status. */
export async function updateVoiceStatusAction(
  voiceId: string,
  status: "READY" | "FAILED",
): Promise<VoiceResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const voice = await db.customVoice.findFirst({
      where: { id: voiceId, workspaceId: ctx.workspaceId },
    });
    if (!voice) return { ok: false, error: "Voice not found." };
    await db.customVoice.update({ where: { id: voiceId }, data: { status, error: status === "READY" ? null : voice.error } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "voice.status", entity: "CustomVoice", entityId: voiceId,
      metadata: { status },
    });
    revalidatePath("/settings/voices");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Delete a voice + its MinIO objects + unassign from any agents. */
export async function deleteVoiceAction(voiceId: string): Promise<VoiceResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const voice = await db.customVoice.findFirst({
      where: { id: voiceId, workspaceId: ctx.workspaceId },
    });
    if (!voice) return { ok: false, error: "Voice not found." };

    await db.$transaction([
      db.agent.updateMany({ where: { workspaceId: ctx.workspaceId, customVoiceId: voiceId }, data: { customVoiceId: null } }),
      db.customVoice.delete({ where: { id: voiceId } }),
    ]);

    for (const key of [voice.sampleKey, voice.previewKey]) {
      if (key) await deleteObject(key).catch(() => {});
    }

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "voice.delete", entity: "CustomVoice", entityId: voiceId,
      metadata: { name: voice.name },
    });
    revalidatePath("/settings/voices");
    revalidatePath("/agents");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

const assignSchema = z.object({
  agentId: z.string().min(1),
  customVoiceId: z.string().min(1).nullable(),
});

/** Assign (or clear) a custom voice on an agent (doc §3.3). */
export async function assignVoiceToAgentAction(input: unknown): Promise<VoiceResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = assignSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the assignment." };

    const voice = await db.customVoice.findFirst({
      where: { id: parsed.data.customVoiceId ?? "", workspaceId: ctx.workspaceId },
      select: { id: true, status: true },
    });
    if (parsed.data.customVoiceId && (!voice || voice.status !== "READY")) {
      return { ok: false, error: "That voice is not ready yet." };
    }

    const updated = await db.agent.updateMany({
      where: { id: parsed.data.agentId, workspaceId: ctx.workspaceId },
      data: { customVoiceId: parsed.data.customVoiceId },
    });
    if (updated.count === 0) return { ok: false, error: "Agent not found." };

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: parsed.data.customVoiceId ? "voice.assign" : "voice.unassign",
      entity: "CustomVoice", entityId: parsed.data.customVoiceId ?? undefined,
      metadata: { agentId: parsed.data.agentId },
    });
    revalidatePath("/agents");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
