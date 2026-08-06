"use server";

import { revalidatePath } from "next/cache";
import { KycDocumentType } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { putObject, ensureBucket } from "@/lib/storage";

export type KycResult = { ok: boolean; error?: string };

const KYC_BUCKET = process.env.S3_BUCKET_KYC ?? "vaani-kyc";
const KYC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const KYC_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** FormData: file (pdf/png/jpg ≤5MB), documentType (KycDocumentType), documentRef? */
export async function submitKycDocumentAction(formData: FormData): Promise<KycResult> {
  try {
    const ctx = await requirePermission("settings:write");

    const file = formData.get("file");
    const documentType = String(formData.get("documentType") ?? "");
    const documentRef = String(formData.get("documentRef") ?? "").trim() || null;

    if (!(file instanceof File)) return { ok: false, error: "Attach a document file." };
    if (!(Object.values(KycDocumentType) as string[]).includes(documentType)) {
      return { ok: false, error: "Pick a document type." };
    }
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const mime = KYC_MIME[ext];
    if (!mime) return { ok: false, error: "Document must be PDF, PNG or JPG." };
    if (file.size <= 0) return { ok: false, error: "File is empty." };
    if (file.size > KYC_MAX_BYTES) return { ok: false, error: "Document must be under 5 MB." };

    // A fresh submission supersedes a REJECTED one; PENDING stays PENDING.
    const storageKey = `kyc/${ctx.workspaceId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await ensureBucket(KYC_BUCKET);
    await putObject(KYC_BUCKET, storageKey, buf, mime);

    const record = await db.kycRecord.create({
      data: {
        workspaceId: ctx.workspaceId,
        documentType: documentType as KycDocumentType,
        documentRef,
        storageKey,
        status: "PENDING",
      },
    });

    await db.trialState.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: { kycStatus: "PENDING" },
      create: { workspaceId: ctx.workspaceId, kycStatus: "PENDING" },
    });

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kyc.submit", entity: "KycRecord", entityId: record.id,
      metadata: { documentType, documentRef },
    });
    revalidatePath("/settings/kyc");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
