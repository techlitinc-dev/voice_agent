"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  createPendingTotpToken,
  createSession,
  destroySession,
  getCurrentSession,
  requireUser,
  setActiveWorkspace,
  verifyPendingTotpToken,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { provisionUserWithWorkspace } from "@/lib/provision";
import { findMatchingBackupCode, verifyTotpCode } from "@/lib/totp";

export type ActionResult = {
  ok: boolean;
  error?: string;
  requiresTotp?: boolean;
  pendingToken?: string;
};

const registerSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(100),
  businessName: z.string().min(2).max(80),
});

export async function registerAction(input: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid details. Password must be 8+ characters." };
  const { fullName, email, password, businessName } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "An account with this email already exists." };

  const passwordHash = await bcrypt.hash(password, 10);
  const { user, workspace } = await provisionUserWithWorkspace({
    fullName, email, passwordHash, businessName,
  });

  await createSession(user.id, workspace.id);
  await logAudit({
    workspaceId: workspace.id,
    userId: user.id,
    action: "workspace.create",
    entity: "Workspace",
    entityId: workspace.id,
    metadata: { businessName },
  });
  return { ok: true };
}

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

async function firstWorkspaceId(userId: string): Promise<string | undefined> {
  const membership = await db.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return membership?.workspaceId;
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid email or password." };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return { ok: false, error: "Invalid email or password." };

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) return { ok: false, error: "Invalid email or password." };

  // TOTP second factor (spec 3.3): if enabled, do NOT create the session yet.
  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (totp && totp.status === "ENABLED") {
    const pendingToken = await createPendingTotpToken(user.id);
    return { ok: true, requiresTotp: true, pendingToken };
  }

  const workspaceId = await firstWorkspaceId(user.id);
  await createSession(user.id, workspaceId);
  if (workspaceId) {
    await logAudit({
      workspaceId, userId: user.id,
      action: "auth.login", entity: "User", entityId: user.id,
      metadata: { method: "password" },
    });
  }
  return { ok: true };
}

const totpLoginSchema = z.object({
  pendingToken: z.string().min(10),
  code: z.string().min(6).max(20), // 6-digit TOTP or a backup code like "k7f2-9qx4"
});

/** Second step of login when TOTP is enabled. Accepts a TOTP code OR a backup code. */
export async function verifyLoginTotpAction(input: unknown): Promise<ActionResult> {
  const parsed = totpLoginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid code." };

  const userId = await verifyPendingTotpToken(parsed.data.pendingToken);
  if (!userId) return { ok: false, error: "Session expired. Sign in again." };

  const totp = await db.totpSecret.findUnique({ where: { userId } });
  if (!totp || totp.status !== "ENABLED") return { ok: false, error: "2FA is not enabled." };

  const code = parsed.data.code.trim();
  let method: "totp" | "backup_code";
  if (verifyTotpCode(totp.secret, code)) {
    method = "totp";
  } else {
    const codes = await db.backupCode.findMany({ where: { userId, usedAt: null } });
    const matchId = findMatchingBackupCode(code, codes);
    if (!matchId) return { ok: false, error: "Invalid code." };
    await db.backupCode.update({ where: { id: matchId }, data: { usedAt: new Date() } });
    method = "backup_code";
  }

  const workspaceId = await firstWorkspaceId(userId);
  await createSession(userId, workspaceId);
  if (workspaceId) {
    await logAudit({
      workspaceId, userId,
      action: "auth.login", entity: "User", entityId: userId,
      metadata: { method },
    });
  }
  return { ok: true };
}

export async function logoutAction() {
  const session = await getCurrentSession();
  if (session?.activeWorkspaceId) {
    await logAudit({
      workspaceId: session.activeWorkspaceId,
      userId: session.userId,
      action: "auth.logout",
      entity: "Session",
      entityId: session.id,
    });
  }
  await destroySession();
  redirect("/login");
}

/** Used by the workspace switcher UI. */
export async function switchWorkspaceAction(workspaceId: string): Promise<ActionResult> {
  const user = await requireUser();
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return { ok: false, error: "Not a member of this workspace." };
  await setActiveWorkspace(workspaceId);
  return { ok: true };
}
