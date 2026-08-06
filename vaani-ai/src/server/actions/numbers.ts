"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { NumberType } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { kycGateError } from "@/lib/trial";

export type ActionResult = { ok: boolean; error?: string };

const numberSchema = z.object({
  number: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +918040001234"),
  label: z.string().max(60).optional(),
  numberType: z.nativeEnum(NumberType).default("LOCAL"),
  monthlyRentPaise: z.coerce.number().int().min(0).default(0),
});

export async function registerNumberAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("numbers:write");
    const parsed = numberSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid number." };
    }
    // KYC gate (spec §10/§13): 140/1600 series require a VERIFIED KycStatus.
    const kycError = kycGateError(
      parsed.data.numberType,
      (await db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }))?.kycStatus ?? null
    );
    if (kycError) return { ok: false, error: kycError };

    const created = await db.phoneNumber.create({
      data: { ...parsed.data, workspaceId: ctx.workspaceId },
    });
    // Monthly rental record (guide 09 cron bills it; margin already inside rent).
    if (created.monthlyRentPaise > 0) {
      await db.numberRental.create({
        data: {
          workspaceId: ctx.workspaceId,
          phoneNumberId: created.id,
          monthlyPricePaise: created.monthlyRentPaise,
          marginPercent: 20,
        },
      });
    }
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "number.register", entity: "PhoneNumber",
      metadata: { number: parsed.data.number, numberType: parsed.data.numberType },
    });
    revalidatePath("/numbers");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return { ok: false, error: "This number is already registered in your workspace." };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function assignAgentAction(phoneNumberId: string, agentId: string | null): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("numbers:write");
    if (agentId) {
      // The agent must belong to the same workspace AND be published.
      const agent = await db.agent.findFirst({
        where: { id: agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
      });
      if (!agent) return { ok: false, error: "Agent not found or not published yet." };
    }
    const updated = await db.phoneNumber.updateMany({
      where: { id: phoneNumberId, workspaceId: ctx.workspaceId },
      data: { agentId },
    });
    if (updated.count === 0) return { ok: false, error: "Number not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: agentId ? "number.assign" : "number.unassign",
      entity: "PhoneNumber", entityId: phoneNumberId, metadata: { agentId },
    });
    revalidatePath("/numbers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function deleteNumberAction(phoneNumberId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("numbers:write");
    const deleted = await db.phoneNumber.deleteMany({
      where: { id: phoneNumberId, workspaceId: ctx.workspaceId },
    });
    if (deleted.count === 0) return { ok: false, error: "Number not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "number.delete", entity: "PhoneNumber", entityId: phoneNumberId,
    });
    revalidatePath("/numbers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
