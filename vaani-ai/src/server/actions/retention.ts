"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { isValidRetentionDays } from "@/lib/retention";

const policySchema = z.object({
  recordingsDays: z.coerce.number().refine(isValidRetentionDays, "1–3650 days"),
  transcriptsDays: z.coerce.number().refine(isValidRetentionDays, "1–3650 days"),
  autoDelete: z.boolean(),
});

export async function saveRetentionPolicy(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = policySchema.safeParse({
      recordingsDays: formData.get("recordingsDays"),
      transcriptsDays: formData.get("transcriptsDays"),
      autoDelete: formData.get("autoDelete") === "on",
    });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    await db.retentionPolicy.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: parsed.data,
      create: { workspaceId: ctx.workspaceId, ...parsed.data },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "retention.policy_saved", entity: "RetentionPolicy", metadata: parsed.data },
    });
    revalidatePath("/settings/retention");
    return { ok: true as const };
  } catch (e) {
    if (e instanceof Error && e.message === "FORBIDDEN") {
      return { ok: false as const, error: "Forbidden — your role lacks the settings:write permission" };
    }
    console.error("saveRetentionPolicy", e);
    return { ok: false as const, error: "Could not save policy" };
  }
}
