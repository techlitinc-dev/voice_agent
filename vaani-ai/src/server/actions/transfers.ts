"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { acceptTransfer, declineTransfer, isAvailable, AVAILABLE_KEY } from "@/lib/transfers";

export type ActionResult = { ok: boolean; error?: string };

export async function acceptTransferAction(transferRequestId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:barge");
    const r = await acceptTransfer(ctx.workspaceId, ctx.user.id, transferRequestId);
    if (!r.ok) return { ok: false, error: r.error };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "transfer.accept", entity: "TransferRequest", entityId: transferRequestId,
    });
    revalidatePath("/transfers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function declineTransferAction(transferRequestId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:barge");
    const r = await declineTransfer(ctx.workspaceId, ctx.user.id, transferRequestId);
    if (!r.ok) return { ok: false, error: r.error };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "transfer.decline", entity: "TransferRequest", entityId: transferRequestId,
    });
    revalidatePath("/transfers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Flip the availability:online tag on the current membership. */
export async function toggleAvailabilityAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("live:listen");
    const current = ctx.membership.grantedPermissions;
    const next = isAvailable(current)
      ? current.filter((p) => p !== AVAILABLE_KEY)
      : [...current, AVAILABLE_KEY];
    await db.membership.update({
      where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: ctx.workspaceId } },
      data: { grantedPermissions: next },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: isAvailable(current) ? "agent.unavailable" : "agent.available",
      entity: "Membership", entityId: ctx.membership.id,
    });
    revalidatePath("/transfers");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
