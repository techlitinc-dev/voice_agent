"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isPermissionKey } from "@/lib/permissions";
import type { Role } from "@prisma/client";

export type MemberActionResult = { ok: boolean; error?: string };

const roleSchema = z.enum(["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"]);

/** Count OWNER memberships in a workspace (to protect the last owner). */
async function ownerCount(workspaceId: string): Promise<number> {
  return db.membership.count({ where: { workspaceId, role: "OWNER" } });
}

export async function updateMemberRoleAction(input: unknown): Promise<MemberActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z
    .object({ membershipId: z.string().min(1), role: roleSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  // Tenant scope: the membership MUST belong to the current workspace.
  const target = await db.membership.findFirst({
    where: { id: parsed.data.membershipId, workspaceId: ctx.workspaceId },
  });
  if (!target) return { ok: false, error: "Member not found." };
  if (target.userId === ctx.user.id) return { ok: false, error: "You cannot change your own role." };
  if (target.role === "OWNER" && parsed.data.role !== "OWNER" && (await ownerCount(ctx.workspaceId)) <= 1) {
    return { ok: false, error: "Cannot demote the last owner." };
  }

  await db.membership.update({
    where: { id: target.id },
    data: { role: parsed.data.role as Role },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.role_change", entity: "Membership", entityId: target.id,
    metadata: { from: target.role, to: parsed.data.role, targetUserId: target.userId },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}

export async function updateMemberPermissionsAction(input: unknown): Promise<MemberActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z
    .object({
      membershipId: z.string().min(1),
      grantedPermissions: z.array(z.string()).max(64),
      revokedPermissions: z.array(z.string()).max(64),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const granted = parsed.data.grantedPermissions.filter(isPermissionKey);
  const revoked = parsed.data.revokedPermissions.filter(isPermissionKey);
  if (granted.length !== parsed.data.grantedPermissions.length ||
      revoked.length !== parsed.data.revokedPermissions.length) {
    return { ok: false, error: "Unknown permission key." };
  }
  if (granted.some((k) => revoked.includes(k))) {
    return { ok: false, error: "A permission cannot be both granted and revoked." };
  }

  const target = await db.membership.findFirst({
    where: { id: parsed.data.membershipId, workspaceId: ctx.workspaceId },
  });
  if (!target) return { ok: false, error: "Member not found." };
  if (target.role === "OWNER") {
    return { ok: false, error: "Owner permissions cannot be restricted." };
  }

  await db.membership.update({
    where: { id: target.id },
    data: { grantedPermissions: granted, revokedPermissions: revoked },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.permissions_update", entity: "Membership", entityId: target.id,
    metadata: { granted, revoked, targetUserId: target.userId },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}

export async function removeMemberAction(input: unknown): Promise<MemberActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z.object({ membershipId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const target = await db.membership.findFirst({
    where: { id: parsed.data.membershipId, workspaceId: ctx.workspaceId },
  });
  if (!target) return { ok: false, error: "Member not found." };
  if (target.userId === ctx.user.id) return { ok: false, error: "You cannot remove yourself." };
  if (target.role === "OWNER" && (await ownerCount(ctx.workspaceId)) <= 1) {
    return { ok: false, error: "Cannot remove the last owner." };
  }

  await db.membership.delete({ where: { id: target.id } });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.remove", entity: "Membership", entityId: target.id,
    metadata: { targetUserId: target.userId },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}
