import { db } from "./db";

export const SKILL_PREFIX = "skill:";
export const AVAILABLE_KEY = "availability:online";

/** "skill:sales" → "sales". Everything else is ignored. */
export function userSkills(grantedPermissions: string[]): string[] {
  return grantedPermissions
    .filter((p) => p.startsWith(SKILL_PREFIX) && p.length > SKILL_PREFIX.length)
    .map((p) => p.slice(SKILL_PREFIX.length));
}

export function isAvailable(grantedPermissions: string[]): boolean {
  return grantedPermissions.includes(AVAILABLE_KEY);
}

/** Visibility rule: untagged transfers are visible to all; tagged transfers are
 *  visible to members with the skill OR to members with no skills (fallback pool). */
export function canSeeTransfer(
  tr: { skill: string | null },
  skills: string[]
): boolean {
  if (!tr.skill) return true;
  return skills.length === 0 || skills.includes(tr.skill);
}

/** Atomic accept: only one agent can win a QUEUED/RINGING request. */
export async function acceptTransfer(
  workspaceId: string,
  userId: string,
  transferRequestId: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await db.transferRequest.updateMany({
    where: { id: transferRequestId, workspaceId, status: { in: ["QUEUED", "RINGING"] } },
    data: { status: "ACCEPTED", acceptedByUserId: userId, acceptedAt: new Date() },
  });
  return r.count === 1 ? { ok: true } : { ok: false, error: "Already handled." };
}

export async function declineTransfer(
  workspaceId: string,
  userId: string,
  transferRequestId: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await db.transferRequest.updateMany({
    where: { id: transferRequestId, workspaceId, status: { in: ["QUEUED", "RINGING"] } },
    data: { status: "CANCELLED" },
  });
  return r.count === 1 ? { ok: true } : { ok: false, error: "Already handled." };
}
