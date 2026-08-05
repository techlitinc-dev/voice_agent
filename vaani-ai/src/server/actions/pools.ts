"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isValidDidForType } from "@/lib/campaign/phone";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const NUMBER_TYPES = ["LOCAL", "TOLLFREE", "MOBILE", "SERIES_140", "SERIES_1600"] as const;

export async function createPoolAction(name: string): Promise<ActionResult> {
  const ctx = await requirePermission("numbers:write");
  try {
    const n = z.string().min(2).max(60).parse(name);
    const pool = await db.numberPool.create({ data: { workspaceId: ctx.workspaceId, name: n } });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "pool.create", entity: "NumberPool", entityId: pool.id });
    revalidatePath("/campaigns/pools");
    return { ok: true, id: pool.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create pool." };
  }
}

const addNumberSchema = z.object({
  poolId: z.string().min(1),
  number: z.string().min(8).max(16),
  label: z.string().max(60).nullable().optional(),
  numberType: z.enum(NUMBER_TYPES),
  dailyCallCap: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  lifetimeCallCap: z.coerce.number().int().min(1).max(10000000).nullable().optional(),
});

export async function addNumberToPoolAction(input: unknown): Promise<ActionResult> {
  const ctx = await requirePermission("numbers:write");
  try {
    const parsed = addNumberSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the number fields." };
    const d = parsed.data;
    if (!isValidDidForType(d.number, d.numberType)) {
      return { ok: false, error: `${d.number} is not a valid ${d.numberType} DID (140 series: +91140XXXXXXX, 1600 series: +911600XXXXXX).` };
    }
    const pool = await db.numberPool.findFirst({ where: { id: d.poolId, workspaceId: ctx.workspaceId } });
    if (!pool) return { ok: false, error: "Pool not found." };
    const created = await db.phoneNumber.upsert({
      where: { workspaceId_number: { workspaceId: ctx.workspaceId, number: d.number } },
      update: { poolId: pool.id, numberType: d.numberType, label: d.label ?? undefined, dailyCallCap: d.dailyCallCap ?? null, lifetimeCallCap: d.lifetimeCallCap ?? null },
      create: {
        workspaceId: ctx.workspaceId,
        poolId: pool.id,
        number: d.number,
        numberType: d.numberType,
        label: d.label ?? null,
        dailyCallCap: d.dailyCallCap ?? null,
        lifetimeCallCap: d.lifetimeCallCap ?? null,
      },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "pool.add-number", entity: "PhoneNumber", entityId: created.id, metadata: { poolId: pool.id } });
    revalidatePath("/campaigns/pools");
    return { ok: true, id: created.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not add the number." };
  }
}

export async function removeNumberFromPoolAction(phoneNumberId: string): Promise<ActionResult> {
  const ctx = await requirePermission("numbers:write");
  try {
    const updated = await db.phoneNumber.updateMany({
      where: { id: phoneNumberId, workspaceId: ctx.workspaceId },
      data: { poolId: null },
    });
    if (updated.count === 0) return { ok: false, error: "Number not found." };
    revalidatePath("/campaigns/pools");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not remove the number." };
  }
}
