"use server";

import { revalidatePath } from "next/cache";
import dns from "node:dns/promises";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { putObject, ensureBucket } from "@/lib/storage";
import {
  isValidHexColor,
  logoContentType,
  logoStorageKey,
  validateLogoUpload,
} from "@/lib/branding";
import {
  normalizeDomain,
  verifyDomainOwnership,
  type DnsResolver,
} from "@/lib/domain-verify";
import { checkFeatureGate } from "@/lib/feature-gates";

export type BrandingResult = { ok: boolean; error?: string };

const BRANDING_BUCKET = process.env.S3_BUCKET_BRANDING ?? "vaani-branding";

const nodeResolver: DnsResolver = {
  resolveTxt: (h) => dns.resolveTxt(h),
  resolveCname: (h) => dns.resolveCname(h),
};

/** White-label is plan-gated (guide 09). Fail CLOSED when gates are unavailable. */
async function assertWhiteLabelAllowed(workspaceId: string): Promise<string | null> {
  try {
    const gate = await checkFeatureGate(workspaceId, "whiteLabel");
    if (!gate.allowed) {
      return "White-label requires the Enterprise plan (or the white-label add-on) — upgrade in Billing.";
    }
    return null;
  } catch (e) {
    console.error("[branding] feature gate check failed", e);
    return "Plan feature check unavailable — complete guide 09 billing first.";
  }
}

/** Logo upload (FormData: file). Stored in MinIO; Workspace.logoUrl holds the KEY. */
export async function uploadLogoAction(formData: FormData): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose a logo file." };
    const check = validateLogoUpload(file.name, file.size);
    if (!check.ok) return check;

    const key = logoStorageKey(ctx.workspaceId, file.name);
    const buf = Buffer.from(await file.arrayBuffer());
    await ensureBucket(BRANDING_BUCKET);
    await putObject(BRANDING_BUCKET, key, buf, logoContentType(file.name));

    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { logoUrl: key } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.logo", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { key },
    });
    revalidatePath("/settings/branding");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function removeLogoAction(): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { logoUrl: null } });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

const colorSchema = z.object({ primaryColor: z.string().refine(isValidHexColor, "Use #rrggbb.") });

export async function savePrimaryColorAction(input: unknown): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = colorSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Color must be hex like #7c3aed." };
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { primaryColor: parsed.data.primaryColor.toLowerCase() },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.color", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { primaryColor: parsed.data.primaryColor },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function saveCustomDomainAction(input: unknown): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const gateError = await assertWhiteLabelAllowed(ctx.workspaceId);
    if (gateError) return { ok: false, error: gateError };
    const parsed = z.object({ domain: z.string().min(4).max(253) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Enter a domain." };
    const domain = normalizeDomain(parsed.data.domain);
    if (!domain) return { ok: false, error: "That is not a valid hostname (e.g. app.yourbrand.com)." };
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { customDomain: domain, customDomainVerifiedAt: null }, // re-verify on change
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.domain.save", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { domain },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return { ok: false, error: "That domain is already claimed by another workspace." };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** DNS check (TXT vaani-verification=<workspaceId> or CNAME → app host). */
export async function verifyCustomDomainAction(): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    if (!workspace.customDomain) return { ok: false, error: "Save a custom domain first." };
    const appHost = (process.env.APP_URL ?? "http://localhost:3000").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const result = await verifyDomainOwnership({
      domain: workspace.customDomain,
      workspaceId: ctx.workspaceId,
      appHost,
      resolver: nodeResolver,
    });
    if (!result.ok) return { ok: false, error: result.error ?? "Verification failed." };
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { customDomainVerifiedAt: new Date() },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.domain.verify", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { domain: workspace.customDomain, method: result.method },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function removeCustomDomainAction(): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { customDomain: null, customDomainVerifiedAt: null },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Master white-label switch — plan-gated; requires a verified custom domain. */
export async function setWhiteLabelEnabledAction(enabled: boolean): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const gateError = await assertWhiteLabelAllowed(ctx.workspaceId);
    if (gateError) return { ok: false, error: gateError };
    if (enabled) {
      const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
      if (!ws.customDomainVerifiedAt) {
        return { ok: false, error: "Verify your custom domain first — white-label serves from your domain." };
      }
    }
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { whiteLabelEnabled: enabled } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: enabled ? "branding.whitelabel.enable" : "branding.whitelabel.disable",
      entity: "Workspace", entityId: ctx.workspaceId,
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
