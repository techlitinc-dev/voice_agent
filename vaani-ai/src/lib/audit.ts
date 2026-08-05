import { db } from "./db";
import type { Prisma } from "@prisma/client";

/**
 * Append an audit log entry (spec 3.2 — audit log of every user action).
 * Never throws — audit failure must not break requests.
 */
export async function logAudit(input: {
  workspaceId: string;
  userId?: string;
  action: string; // e.g. "auth.login", "member.role_change", "apikey.create"
  entity: string; // e.g. "User", "Membership", "ApiKey"
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}

/** Backwards-compatible alias used by the register action and later guides. */
export const audit = logAudit;
