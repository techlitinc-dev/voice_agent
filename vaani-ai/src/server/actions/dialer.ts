"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { enqueueManualDial } from "@/lib/dialJobs";

export type ActionResult = { ok: boolean; error?: string; callId?: string };

const dialSchema = z.object({
  toNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +919812345678"),
  fromPhoneNumberId: z.string().min(1),
});

export async function startManualCallAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("calls:read");
    const parsed = dialSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid number." };
    }
    const { toNumber, fromPhoneNumberId } = parsed.data;

    const from = await db.phoneNumber.findFirst({
      where: { id: fromPhoneNumberId, workspaceId: ctx.workspaceId },
    });
    if (!from) return { ok: false, error: "From-number not found in your workspace." };

    // DNC guard: never dial a number on the workspace DNC list.
    const dnc = await db.dncEntry.findUnique({
      where: { workspaceId_phone: { workspaceId: ctx.workspaceId, phone: toNumber } },
    });
    if (dnc) return { ok: false, error: "This number is on your DNC list — cannot dial." };

    const call = await db.call.create({
      data: {
        workspaceId: ctx.workspaceId,
        direction: "OUTBOUND",
        status: "RINGING",
        fromNumber: from.number,
        toNumber,
        extractedEntities: { source: "manual-dial", initiatedBy: ctx.user.id },
      },
    });
    await enqueueManualDial({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      callId: call.id,
      fromNumber: from.number,
      toNumber,
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "dialer.manual_call", entity: "Call", entityId: call.id,
      metadata: { toNumber, fromNumber: from.number },
    });
    revalidatePath("/dialer");
    return { ok: true, callId: call.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
