"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentSession, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  totpQrDataUrl,
  verifyTotpCode,
} from "@/lib/totp";

export type TotpActionResult = {
  ok: boolean;
  error?: string;
  secret?: string;
  qrDataUrl?: string;
  backupCodes?: string[];
};

async function auditIfWorkspace(userId: string, action: string, entityId?: string) {
  const session = await getCurrentSession();
  if (!session?.activeWorkspaceId) return;
  await logAudit({
    workspaceId: session.activeWorkspaceId,
    userId, action, entity: "TotpSecret", entityId,
  });
}

/** Step 1 of enrollment: create/replace a PENDING secret and return QR + secret. */
export async function startTotpEnrollmentAction(): Promise<TotpActionResult> {
  const user = await requireUser();
  const existing = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (existing?.status === "ENABLED") {
    return { ok: false, error: "2FA is already enabled. Disable it first to re-enroll." };
  }
  const secret = generateTotpSecret();
  await db.totpSecret.upsert({
    where: { userId: user.id },
    update: { secret, status: "PENDING", enabledAt: null },
    create: { userId: user.id, secret, status: "PENDING" },
  });
  const qrDataUrl = await totpQrDataUrl(user.email, secret);
  return { ok: true, secret, qrDataUrl };
}

/** Step 2 of enrollment: confirm a code from the authenticator app → ENABLED + backup codes. */
export async function confirmTotpEnrollmentAction(input: unknown): Promise<TotpActionResult> {
  const user = await requireUser();
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter the 6-digit code." };

  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (!totp || totp.status !== "PENDING") {
    return { ok: false, error: "Start enrollment first." };
  }
  if (!verifyTotpCode(totp.secret, parsed.data.code)) {
    return { ok: false, error: "Wrong code. Check your authenticator app and try again." };
  }

  const backupCodes = generateBackupCodes(10);
  await db.$transaction(async (tx) => {
    await tx.totpSecret.update({
      where: { userId: user.id },
      data: { status: "ENABLED", enabledAt: new Date() },
    });
    await tx.backupCode.deleteMany({ where: { userId: user.id } });
    await tx.backupCode.createMany({
      data: backupCodes.map((code) => ({ userId: user.id, codeHash: hashBackupCode(code) })),
    });
  });
  await auditIfWorkspace(user.id, "totp.enable", totp.id);
  revalidatePath("/settings/security");
  return { ok: true, backupCodes };
}

/** Disable 2FA. Requires the current password (re-auth) — never disable silently. */
export async function disableTotpAction(input: unknown): Promise<TotpActionResult> {
  const user = await requireUser();
  const parsed = z.object({ password: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Password required." };

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) return { ok: false, error: "Wrong password." };

  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (!totp || totp.status !== "ENABLED") return { ok: false, error: "2FA is not enabled." };

  await db.$transaction(async (tx) => {
    await tx.totpSecret.update({ where: { userId: user.id }, data: { status: "DISABLED" } });
    await tx.backupCode.deleteMany({ where: { userId: user.id } });
  });
  await auditIfWorkspace(user.id, "totp.disable", totp.id);
  revalidatePath("/settings/security");
  return { ok: true };
}
