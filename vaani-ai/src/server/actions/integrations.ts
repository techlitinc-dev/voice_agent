"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { CrmProvider as CrmProviderEnum, CalendarProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getCrmProvider, validateFieldMapping } from "@/lib/integrations/crm";

export type IntegrationResult = { ok: boolean; error?: string; output?: string };

const crmProviderSchema = z.nativeEnum(CrmProviderEnum);

export async function disconnectCrmAction(provider: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    await db.crmConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { active: false },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "crm.disconnect", entity: "CrmConnection", metadata: { provider: p } });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

/** Save a field mapping from the JSON editor (validates canonical keys). */
export async function updateCrmFieldMappingAction(provider: string, mappingJson: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    let parsed: unknown;
    try {
      parsed = JSON.parse(mappingJson);
    } catch {
      return { ok: false, error: "Invalid JSON." };
    }
    const check = validateFieldMapping(parsed);
    if (!check.ok) return { ok: false, error: check.error };
    const updated = await db.crmConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { fieldMapping: check.mapping },
    });
    if (updated.count === 0) return { ok: false, error: "Connect the CRM first." };
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

export async function toggleCrmTwoWaySyncAction(provider: string, enabled: boolean): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    const updated = await db.crmConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { twoWaySyncEnabled: enabled === true },
    });
    if (updated.count === 0) return { ok: false, error: "Connect the CRM first." };
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

/** "Test connection" — verifies the stored token by listing fields (refresh-on-401
 *  for Zoho). */
export async function testCrmConnectionAction(provider: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:read");
    const p = crmProviderSchema.parse(provider.toUpperCase());
    const conn = await db.crmConnection.findFirst({
      where: { workspaceId: ctx.workspaceId, provider: p, active: true },
    });
    if (!conn) return { ok: false, error: "Not connected." };
    try {
      const fields = await getCrmProvider(p).listFields(conn);
      return { ok: true, output: `Token valid. ${fields.length} writable fields: ${fields.slice(0, 6).join(", ")}…` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Connection test failed." };
    }
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}

export async function disconnectCalendarAction(provider: string): Promise<IntegrationResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const p = z.nativeEnum(CalendarProvider).parse(provider.toUpperCase());
    await db.calendarConnection.updateMany({
      where: { workspaceId: ctx.workspaceId, provider: p },
      data: { active: false },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "calendar.disconnect", entity: "CalendarConnection", metadata: { provider: p } });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong." };
  }
}
