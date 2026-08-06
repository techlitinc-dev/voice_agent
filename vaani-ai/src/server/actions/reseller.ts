"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { slugify } from "@/lib/provision";
import { provisionTrial } from "@/lib/trial";
import { checkFeatureGate } from "@/lib/feature-gates";
import { wholesaleRateCardSchema } from "@/lib/reseller";

export type ActionResult = { ok: boolean; error?: string };

async function requireReseller() {
  const ctx = await requirePermission("billing:write");
  const reseller = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId: ctx.workspaceId },
  });
  if (!reseller || !reseller.active) {
    throw new Error("Reseller panel is not enabled for this workspace.");
  }
  return { ctx, reseller };
}

/**
 * Enable this workspace as a reseller/agency (spec §3.1 white-label, §10 reseller
 * panel). Requires the plan's `reseller_panel` feature gate (Enterprise) — the
 * commercial enablement of the gate itself is an operator decision.
 */
export async function enableResellerAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const gate = await checkFeatureGate(ctx.workspaceId, "reseller_panel");
    if (!gate.allowed) {
      return { ok: false, error: "The reseller panel requires the Enterprise plan." };
    }
    await db.resellerAccount.upsert({
      where: { parentWorkspaceId: ctx.workspaceId },
      update: { active: true },
      create: { parentWorkspaceId: ctx.workspaceId },
    });
    revalidatePath("/reseller");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not enable reseller panel." };
  }
}

const childSchema = z.object({ name: z.string().min(2).max(80) });

/**
 * Create a child (sub-account) workspace under this reseller: workspace +
 * Workspace.resellerId link + starter subscription + wallet + trial. The current
 * user becomes OWNER of the child so the agency can operate it.
 */
export async function createChildWorkspaceAction(input: unknown): Promise<ActionResult> {
  try {
    const { ctx, reseller } = await requireReseller();
    const parsed = childSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Name must be 2–80 characters." };

    const starter = await db.plan.findUnique({ where: { code: "starter" } });
    const child = await db.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: { name: parsed.data.name, slug: slugify(parsed.data.name), resellerId: reseller.id },
      });
      await tx.membership.create({
        data: { userId: ctx.user.id, workspaceId: ws.id, role: "OWNER" },
      });
      if (starter) {
        await tx.subscription.create({
          data: {
            workspaceId: ws.id,
            planId: starter.id,
            status: "active",
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      }
      await tx.wallet.create({ data: { workspaceId: ws.id, balancePaise: 0 } });
      return ws;
    });
    await provisionTrial(child.id);
    revalidatePath("/reseller");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("not enabled")) return { ok: false, error: String(e) };
    console.error(e);
    return { ok: false, error: "Could not create child workspace." };
  }
}

/** Save the wholesale rate card JSON (what the reseller pays us per minute). */
export async function saveRateCardAction(input: unknown): Promise<ActionResult> {
  try {
    const { reseller } = await requireReseller();
    const parsed = wholesaleRateCardSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Rates must be non-negative integers (paise/min)." };
    await db.resellerAccount.update({
      where: { id: reseller.id },
      data: { wholesaleRateCard: parsed.data },
    });
    revalidatePath("/reseller");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("not enabled")) return { ok: false, error: String(e) };
    console.error(e);
    return { ok: false, error: "Could not save rate card." };
  }
}
