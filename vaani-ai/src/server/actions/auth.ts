"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
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
import { hashPassword, isBreachedPassword, rehashIfNeeded, verifyPassword } from "@/lib/passwords";
import { clearFailedLogins, lockoutState, recordFailedLogin } from "@/lib/lockout";
import { rateLimit } from "@/lib/ratelimit-redis";

// Password rule shared with the register form client (src/lib/password-rules.ts).
import { PASSWORD_RULE, PASSWORD_HINT, PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

export type ActionResult = {
  ok: boolean;
  error?: string;
  requiresTotp?: boolean;
  pendingToken?: string;
};

const registerSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(100).regex(PASSWORD_RULE, PASSWORD_HINT),
  businessName: z.string().min(2).max(80),
});

function requestIp(): string | null {
  const h = headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip");
}

export async function registerAction(input: unknown): Promise<ActionResult> {
  const ip = requestIp() ?? "unknown";

  // Rate limit: 3 registrations / minute / IP (hardening doc §4.1).
  const allowed = await rateLimit(`register:${ip}`, 3, 60);
  if (!allowed) return { ok: false, error: "Too many attempts. Try again in a minute." };

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((i) => i.path[0] === "password");
    return { ok: false, error: passwordIssue?.message ?? "Invalid details. Check the form and try again." };
  }
  const { fullName, email, password, businessName } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "An account with this email already exists." };

  // Breach-list check (hardening doc §1.10) — HIBP k-anonymity, fail-open.
  if (await isBreachedPassword(password)) {
    return { ok: false, error: "This password appears in a known data breach. Choose a different one." };
  }

  const passwordHash = await hashPassword(password);
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

/** True when the user holds an OWNER or ADMIN role in any workspace
 *  (hardening doc §1.7 — TOTP is mandatory for these roles). */
async function hasPrivilegedRole(userId: string): Promise<boolean> {
  const memberships = await db.membership.findMany({
    where: { userId, role: { in: ["OWNER", "ADMIN"] } },
    select: { role: true },
  });
  return memberships.length > 0;
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  const ip = requestIp() ?? "unknown";

  // Rate limit: 10 logins / minute / IP (hardening doc §4.1).
  const allowed = await rateLimit(`login:${ip}`, 10, 60);
  if (!allowed) return { ok: false, error: "Too many login attempts. Try again in a minute." };

  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid email or password." };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return { ok: false, error: "Invalid email or password." };

  // Lockout gate (hardening doc §1.6) — check BEFORE verifying the password so
  // a locked account can't be used as an oracle.
  const state = lockoutState(user);
  if (state.locked) {
    return { ok: false, error: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes." };
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user.id);
    await logAudit({
      workspaceId: (await firstWorkspaceId(user.id)) ?? user.id,
      userId: user.id,
      action: "auth.login_failed",
      entity: "User",
      entityId: user.id,
    });
    return { ok: false, error: "Invalid email or password." };
  }
  await clearFailedLogins(user.id);

  // Rehash-on-login: legacy bcrypt hashes get upgraded to argon2id.
  if (rehashIfNeeded(user.passwordHash)) {
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    });
  }

  // TOTP second factor (spec 3.3): if enabled, do NOT create the session yet.
  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (totp && totp.status === "ENABLED") {
    const pendingToken = await createPendingTotpToken(user.id);
    return { ok: true, requiresTotp: true, pendingToken };
  }

  // TOTP enforcement (hardening doc §1.7): OWNER/ADMIN must have 2FA enabled.
  if (await hasPrivilegedRole(user.id)) {
    return { ok: false, error: "Two-factor authentication is required for your role. Contact an administrator." };
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

  // TOTP verify rate limit: 5 / minute / IP+email (hardening doc §4.1).
  const ip = requestIp() ?? "unknown";
  const userRow = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  const allowed = await rateLimit(`totp:${ip}:${userRow?.email ?? userId}`, 5, 60);
  if (!allowed) return { ok: false, error: "Too many attempts. Try again in a minute." };

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
