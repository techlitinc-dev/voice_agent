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

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 phone required, e.g. +919812345678");

/** File a GDPR data-export request. subjectPhone optional: empty = whole workspace. */
export async function requestDataExport(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const rawPhone = String(formData.get("subjectPhone") ?? "").trim();
    if (rawPhone.length > 0) {
      const p = phoneSchema.safeParse(rawPhone);
      if (!p.success) return { ok: false as const, error: p.error.issues[0].message };
    }
    const req = await db.gdprRequest.create({
      data: {
        workspaceId: ctx.workspaceId,
        type: "EXPORT",
        subjectPhone: rawPhone.length > 0 ? rawPhone : null,
      },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "gdpr.export_requested", entity: "GdprRequest", entityId: req.id, metadata: { subjectPhone: req.subjectPhone } },
    });
    revalidatePath("/settings/data-rights");
    return { ok: true as const };
  } catch (e) {
    return actionError("requestDataExport", e, "Could not file export request");
  }
}

/** File a right-to-erasure request for ONE phone number (caller/contact). */
export async function requestErasure(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = phoneSchema.safeParse(String(formData.get("subjectPhone") ?? "").trim());
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    const req = await db.gdprRequest.create({
      data: { workspaceId: ctx.workspaceId, type: "ERASURE", subjectPhone: parsed.data },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "gdpr.erasure_requested", entity: "GdprRequest", entityId: req.id, metadata: { subjectPhone: parsed.data } },
    });
    revalidatePath("/settings/data-rights");
    return { ok: true as const };
  } catch (e) {
    return actionError("requestErasure", e, "Could not file erasure request");
  }
}
