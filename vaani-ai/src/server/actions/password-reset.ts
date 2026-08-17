"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revokeAllUserSessions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createResetToken, verifyResetToken } from "@/lib/password-reset";
import { sendPasswordResetEmail } from "@/lib/password-reset-email";
import { hashPassword, isBreachedPassword } from "@/lib/passwords";
import { clearFailedLogins } from "@/lib/lockout";
import { PASSWORD_RULE, PASSWORD_HINT, PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

export type PasswordResetResult = { ok: boolean; error?: string };

const requestSchema = z.object({
  email: z.string().email().toLowerCase(),
});

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(100).regex(PASSWORD_RULE, PASSWORD_HINT),
});

/** Public confirmation — identical whether or not the email exists (no enumeration). */
const REQUEST_OK = "If an account exists for that email, we've sent a reset link.";
const INVALID_TOKEN = "This reset link is invalid or has expired.";

/** Step 1: request a reset link. Never reveals whether the email is registered. */
export async function requestPasswordResetAction(input: unknown): Promise<PasswordResetResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: true, error: REQUEST_OK };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return { ok: true, error: REQUEST_OK };

  const token = await createResetToken(user.id);
  await sendPasswordResetEmail({ to: user.email, fullName: user.fullName, token });
  await logAudit({
    workspaceId: (await db.membership.findFirst({
      where: { userId: user.id },
      select: { workspaceId: true },
    }))?.workspaceId ?? user.id,
    userId: user.id,
    action: "auth.reset_requested",
    entity: "User",
    entityId: user.id,
  });
  return { ok: true, error: REQUEST_OK };
}

/** Step 2: consume the token and set a new password. Revokes all existing sessions. */
export async function resetPasswordAction(input: unknown): Promise<PasswordResetResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((i) => i.path[0] === "password");
    return { ok: false, error: passwordIssue?.message ?? PASSWORD_HINT };
  }

  const userId = await verifyResetToken(parsed.data.token);
  if (!userId) return { ok: false, error: INVALID_TOKEN };

  // Breach-list check (hardening doc §1.10) — HIBP k-anonymity, fail-open.
  if (await isBreachedPassword(parsed.data.password)) {
    return { ok: false, error: "This password appears in a known data breach. Choose a different one." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.user.update({ where: { id: userId }, data: { passwordHash } });
  await clearFailedLogins(userId);
  await revokeAllUserSessions(userId); // old sessions must die after a password change

  await logAudit({
    workspaceId: (await db.membership.findFirst({
      where: { userId },
      select: { workspaceId: true },
    }))?.workspaceId ?? userId,
    userId,
    action: "auth.password_reset",
    entity: "User",
    entityId: userId,
  });
  return { ok: true };
}
