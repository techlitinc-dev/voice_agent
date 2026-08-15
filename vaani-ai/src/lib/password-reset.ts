import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

export const RESET_TOKEN_TTL_MINUTES = 60;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Create a single-use password reset token for a user. Any previous unused
 * tokens for the user are invalidated (deleteMany) so only the newest link works.
 * Returns the RAW token — it is hashed before storage and only ever shown in the
 * reset email.
 */
export async function createResetToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.passwordResetToken.deleteMany({
    where: { userId, usedAt: null },
  });
  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
    },
  });
  return raw;
}

/**
 * Validate a raw reset token and atomically consume it (updateMany guarded by
 * `usedAt: null` + `expiresAt > now` so a token can never be replayed — the
 * second use sees 0 rows and returns null).
 */
export async function verifyResetToken(raw: string): Promise<string | null> {
  const res = await db.passwordResetToken.updateMany({
    where: {
      tokenHash: hashToken(raw),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (res.count === 0) return null;
  const token = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { userId: true },
  });
  return token?.userId ?? null;
}
