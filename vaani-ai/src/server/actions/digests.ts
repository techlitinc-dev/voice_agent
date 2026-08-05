"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

function actionError(label: string, e: unknown, fallback: string) {
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false as const, error: "Forbidden — your role lacks the settings:write permission" };
  }
  console.error(label, e);
  return { ok: false as const, error: fallback };
}

const digestSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  recipients: z
    .string()
    .min(3)
    .transform((s) => s.split(",").map((e) => e.trim()).filter(Boolean))
    .pipe(z.array(z.string().email()).min(1)),
});

export async function createDigest(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = digestSchema.safeParse({
      frequency: String(formData.get("frequency") ?? ""),
      recipients: String(formData.get("recipients") ?? ""),
    });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    await db.scheduledDigest.create({
      data: {
        workspaceId: ctx.workspaceId,
        frequency: parsed.data.frequency,
        recipients: parsed.data.recipients,
      },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "digest.created", entity: "ScheduledDigest", metadata: parsed.data },
    });
    revalidatePath("/settings/digests");
    return { ok: true as const };
  } catch (e) {
    return actionError("createDigest", e, "Could not create digest");
  }
}

export async function deleteDigest(id: string) {
  try {
    const ctx = await requirePermission("settings:write");
    const d = await db.scheduledDigest.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!d) return { ok: false as const, error: "Not found" };
    await db.scheduledDigest.delete({ where: { id: d.id } });
    revalidatePath("/settings/digests");
    return { ok: true as const };
  } catch (e) {
    return actionError("deleteDigest", e, "Could not delete digest");
  }
}
