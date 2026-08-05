"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { putObject, KB_BUCKET } from "@/lib/storage";
import {
  kbStorageKey,
  kbContentType,
  validateKbUpload,
  fetchUrlText,
} from "@/lib/knowledge";

export type KbResult = { ok: boolean; error?: string; id?: string };

/** agentId null/undefined = workspace-shared document (all agents). */
async function assertAgentOwnership(workspaceId: string, agentId?: string | null) {
  if (!agentId) return;
  const a = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
  if (!a) throw new Error("Agent not found.");
}

/** Upload a PDF/DOCX (FormData: file, title, agentId?). */
export async function uploadKbDocumentAction(formData: FormData): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const file = formData.get("file");
    const title = String(formData.get("title") ?? "").trim();
    const agentId = String(formData.get("agentId") ?? "") || null;
    if (!(file instanceof File)) return { ok: false, error: "No file uploaded." };
    if (title.length < 2) return { ok: false, error: "Give the document a title." };
    const check = validateKbUpload(file.name, file.size);
    if (!check.ok) return { ok: false, error: check.error };
    await assertAgentOwnership(ctx.workspaceId, agentId);

    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: ctx.workspaceId,
        agentId,
        type: file.name.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF",
        title,
        status: "PENDING",
      },
    });
    const buf = Buffer.from(await file.arrayBuffer());
    const key = kbStorageKey(ctx.workspaceId, doc.id, file.name);
    await putObject(KB_BUCKET, key, buf, kbContentType(file.name));

    // PDF/DOCX text extraction runs inside Dograh's KB (operator sync) — we store
    // the binary and leave contentText null.
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { storageKey: key } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.upload", entity: "KnowledgeDocument", entityId: doc.id,
      metadata: { title, type: doc.type },
    });
    revalidatePath(agentId ? `/agents/${agentId}` : "/knowledge");
    return { ok: true, id: doc.id };
  } catch (e) {
    return handleKbError(e);
  }
}

/** Paste FAQ / policy text directly. */
export async function addFaqDocumentAction(input: unknown): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const parsed = z
      .object({
        title: z.string().min(2).max(120),
        contentText: z.string().min(10).max(50000),
        agentId: z.string().optional(),
        reindexIntervalHours: z.coerce.number().int().min(1).max(720).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the FAQ form fields." };
    await assertAgentOwnership(ctx.workspaceId, parsed.data.agentId ?? null);

    const hours = parsed.data.reindexIntervalHours ?? null;
    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: ctx.workspaceId,
        agentId: parsed.data.agentId ?? null,
        type: "FAQ",
        title: parsed.data.title,
        contentText: parsed.data.contentText,
        status: "INDEXED", // text lives in our DB; operator syncs to Dograh KB UI
        lastIndexedAt: new Date(),
        reindexIntervalHours: hours,
        nextReindexAt: hours ? new Date(Date.now() + hours * 3600 * 1000) : null,
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.add_faq", entity: "KnowledgeDocument", entityId: doc.id,
    });
    revalidatePath(parsed.data.agentId ? `/agents/${parsed.data.agentId}` : "/knowledge");
    return { ok: true, id: doc.id };
  } catch (e) {
    return handleKbError(e);
  }
}

/** Add a URL document — we fetch and store the text now; re-index on schedule. */
export async function addUrlDocumentAction(input: unknown): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const parsed = z
      .object({
        title: z.string().min(2).max(120),
        sourceUrl: z.string().url().max(1000),
        agentId: z.string().optional(),
        reindexIntervalHours: z.coerce.number().int().min(1).max(720).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the URL form fields." };
    await assertAgentOwnership(ctx.workspaceId, parsed.data.agentId ?? null);

    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: ctx.workspaceId,
        agentId: parsed.data.agentId ?? null,
        type: "URL",
        title: parsed.data.title,
        sourceUrl: parsed.data.sourceUrl,
        status: "INDEXING",
      },
    });
    try {
      const text = await fetchUrlText(parsed.data.sourceUrl);
      const hours = parsed.data.reindexIntervalHours ?? 24; // URLs default to daily re-index
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          contentText: text,
          status: "INDEXED",
          lastIndexedAt: new Date(),
          error: null,
          reindexIntervalHours: hours,
          nextReindexAt: new Date(Date.now() + hours * 3600 * 1000),
        },
      });
    } catch (err) {
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : "fetch failed" },
      });
      return { ok: false, error: "Could not fetch that URL. It was saved as FAILED — check it and re-index." };
    }
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.add_url", entity: "KnowledgeDocument", entityId: doc.id,
      metadata: { sourceUrl: parsed.data.sourceUrl },
    });
    revalidatePath(parsed.data.agentId ? `/agents/${parsed.data.agentId}` : "/knowledge");
    return { ok: true, id: doc.id };
  } catch (e) {
    return handleKbError(e);
  }
}

/** Re-fetch a URL document now (also used by the scheduler). */
export async function reindexDocumentAction(docId: string): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const doc = await db.knowledgeDocument.findFirst({
      where: { id: docId, workspaceId: ctx.workspaceId },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.type !== "URL" || !doc.sourceUrl) {
      return { ok: false, error: "Only URL documents re-fetch; PDF/DOCX/FAQ are synced via the Dograh UI." };
    }
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "INDEXING" } });
    try {
      const text = await fetchUrlText(doc.sourceUrl);
      const hours = doc.reindexIntervalHours;
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          contentText: text,
          status: "INDEXED",
          lastIndexedAt: new Date(),
          error: null,
          nextReindexAt: hours ? new Date(Date.now() + hours * 3600 * 1000) : null,
        },
      });
      return { ok: true, id: doc.id };
    } catch (err) {
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : "fetch failed" },
      });
      return { ok: false, error: "Re-index failed (see document error)." };
    }
  } catch (e) {
    return handleKbError(e);
  }
}

/** Operator confirms the Dograh-UI KB sync is done (OPERATOR GATE, Step 10). */
export async function markDocIndexedAction(docId: string): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const updated = await db.knowledgeDocument.updateMany({
      where: { id: docId, workspaceId: ctx.workspaceId },
      data: { status: "INDEXED", lastIndexedAt: new Date(), error: null },
    });
    if (updated.count === 0) return { ok: false, error: "Document not found." };
    revalidatePath("/knowledge");
    return { ok: true, id: docId };
  } catch (e) {
    return handleKbError(e);
  }
}

export async function deleteKbDocumentAction(docId: string): Promise<KbResult> {
  try {
    const ctx = await requirePermission("knowledge:write");
    const deleted = await db.knowledgeDocument.deleteMany({
      where: { id: docId, workspaceId: ctx.workspaceId },
    });
    if (deleted.count === 0) return { ok: false, error: "Document not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kb.delete", entity: "KnowledgeDocument", entityId: docId,
    });
    revalidatePath("/knowledge");
    revalidatePath("/agents");
    return { ok: true };
  } catch (e) {
    return handleKbError(e);
  }
}

function handleKbError(e: unknown): KbResult {
  if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "Agent not found.")) {
    return { ok: false, error: e.message === "FORBIDDEN" ? "You need the knowledge:write permission for this (Admin or Owner)." : e.message };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
