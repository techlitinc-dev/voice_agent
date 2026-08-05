"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  getCurrentSession,
  requireUser,
  revokeAllUserSessions,
  revokeSessionById,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export type SessionActionResult = { ok: boolean; error?: string };

/** Revoke one of YOUR sessions (device history → forced logout, spec 3.3). */
export async function revokeSessionAction(input: unknown): Promise<SessionActionResult> {
  const user = await requireUser();
  const current = await getCurrentSession();
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const target = await db.session.findFirst({
    where: { id: parsed.data.sessionId, userId: user.id },
  });
  if (!target) return { ok: false, error: "Session not found." };
  if (current && target.id === current.id) {
    return { ok: false, error: "Use Sign out to end your current session." };
  }

  await revokeSessionById(target.id);
  if (current?.activeWorkspaceId) {
    await logAudit({
      workspaceId: current.activeWorkspaceId, userId: user.id,
      action: "session.revoke", entity: "Session", entityId: target.id,
      metadata: { deviceName: target.deviceName },
    });
  }
  revalidatePath("/settings/sessions");
  return { ok: true };
}

/** "Log out all devices" — revokes every session of yours except the current one. */
export async function revokeOtherSessionsAction(): Promise<SessionActionResult> {
  const user = await requireUser();
  const current = await getCurrentSession();
  await revokeAllUserSessions(user.id, current?.id);
  if (current?.activeWorkspaceId) {
    await logAudit({
      workspaceId: current.activeWorkspaceId, userId: user.id,
      action: "session.revoke_all", entity: "User", entityId: user.id,
    });
  }
  revalidatePath("/settings/sessions");
  return { ok: true };
}
