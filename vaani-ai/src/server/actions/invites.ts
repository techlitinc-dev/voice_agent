"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, requireUser, setActiveWorkspace } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export type InviteActionResult = { ok: boolean; error?: string; inviteUrl?: string };

const INVITE_TTL_DAYS = 7;

function inviteUrlFor(token: string): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base}/invite/${token}`;
}

export async function createInviteAction(input: unknown): Promise<InviteActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z
    .object({
      email: z.string().email().toLowerCase(),
      role: z.enum(["ADMIN", "MANAGER", "AGENT", "VIEWER"]), // OWNER is never invitable
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Valid email and role required." };

  // Already a member?
  const existingMember = await db.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, user: { email: parsed.data.email } },
  });
  if (existingMember) return { ok: false, error: "This person is already a member." };

  // One pending invite per email per workspace: revoke older ones.
  await db.workspaceInvite.updateMany({
    where: { workspaceId: ctx.workspaceId, email: parsed.data.email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const invite = await db.workspaceInvite.create({
    data: {
      workspaceId: ctx.workspaceId,
      email: parsed.data.email,
      role: parsed.data.role,
      token: crypto.randomUUID(),
      invitedByUserId: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.invite", entity: "WorkspaceInvite", entityId: invite.id,
    metadata: { email: invite.email, role: invite.role },
  });
  revalidatePath("/settings/members");
  // Email delivery lands in guides 09/10 — for now the operator copies this link
  // from the UI and sends it manually.
  return { ok: true, inviteUrl: inviteUrlFor(invite.token) };
}

export async function revokeInviteAction(input: unknown): Promise<InviteActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z.object({ inviteId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const invite = await db.workspaceInvite.findFirst({
    where: { id: parsed.data.inviteId, workspaceId: ctx.workspaceId, status: "PENDING" },
  });
  if (!invite) return { ok: false, error: "Invite not found." };

  await db.workspaceInvite.update({ where: { id: invite.id }, data: { status: "REVOKED" } });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.invite_revoke", entity: "WorkspaceInvite", entityId: invite.id,
    metadata: { email: invite.email },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}

export async function acceptInviteAction(input: unknown): Promise<InviteActionResult> {
  const user = await requireUser(); // NOT requireWorkspace — the invitee may have none yet
  const parsed = z.object({ token: z.string().min(10) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invite." };

  const invite = await db.workspaceInvite.findUnique({ where: { token: parsed.data.token } });
  if (!invite || invite.status !== "PENDING") return { ok: false, error: "Invite is no longer valid." };
  if (invite.expiresAt < new Date()) {
    await db.workspaceInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return { ok: false, error: "Invite has expired. Ask for a new one." };
  }
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, error: `This invite was sent to ${invite.email}. Sign in with that email.` };
  }

  await db.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
      update: { role: invite.role },
      create: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role },
    });
    await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
  });
  await setActiveWorkspace(invite.workspaceId);
  await logAudit({
    workspaceId: invite.workspaceId, userId: user.id,
    action: "member.invite_accept", entity: "WorkspaceInvite", entityId: invite.id,
    metadata: { email: invite.email, role: invite.role },
  });
  return { ok: true };
}
