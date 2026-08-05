"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isPermissionKey } from "@/lib/permissions";
import {
  apiKeyPrefix,
  generateApiKeySecret,
  hashApiKey,
  isValidCidr,
} from "@/lib/apikeys";

export type ApiKeyActionResult = { ok: boolean; error?: string; apiKey?: string };

const createSchema = z.object({
  name: z.string().min(2).max(60),
  scopes: z.array(z.string()).min(1).max(40),
  ipAllowlist: z.array(z.string()).max(20).default([]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** Creates the key. The full secret is returned ONCE — it is never stored. */
export async function createApiKeyAction(input: unknown): Promise<ApiKeyActionResult> {
  const ctx = await requirePermission("apikeys:write");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Name and at least one scope required." };

  if (!parsed.data.scopes.every(isPermissionKey)) {
    return { ok: false, error: "Unknown scope. Scopes must be permission keys." };
  }
  if (!parsed.data.ipAllowlist.every(isValidCidr)) {
    return { ok: false, error: "Invalid CIDR in IP allowlist (e.g. 203.0.113.10/32)." };
  }

  const secret = generateApiKeySecret();
  const record = await db.apiKey.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: parsed.data.name,
      keyPrefix: apiKeyPrefix(secret),
      keyHash: hashApiKey(secret),
      scopes: parsed.data.scopes,
      ipAllowlist: parsed.data.ipAllowlist,
      createdByUserId: ctx.user.id,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "apikey.create", entity: "ApiKey", entityId: record.id,
    metadata: { name: record.name, keyPrefix: record.keyPrefix, scopes: record.scopes },
  });
  revalidatePath("/settings/api-keys");
  return { ok: true, apiKey: secret };
}

export async function revokeApiKeyAction(input: unknown): Promise<ApiKeyActionResult> {
  const ctx = await requirePermission("apikeys:write");
  const parsed = z.object({ apiKeyId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const key = await db.apiKey.findFirst({
    where: { id: parsed.data.apiKeyId, workspaceId: ctx.workspaceId, revokedAt: null },
  });
  if (!key) return { ok: false, error: "API key not found." };

  await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "apikey.revoke", entity: "ApiKey", entityId: key.id,
    metadata: { name: key.name, keyPrefix: key.keyPrefix },
  });
  revalidatePath("/settings/api-keys");
  return { ok: true };
}
