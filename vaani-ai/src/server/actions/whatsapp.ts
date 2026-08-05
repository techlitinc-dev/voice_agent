"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getWhatsAppQueue, WHATSAPP_SEND_JOB } from "@/lib/queue";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const templateSchema = z.object({
  name: z.string().min(2).max(60).regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscores only (Meta template-name rules)"),
  language: z.string().min(2).max(10),
  body: z.string().min(10).max(1024),
  dltTemplateId: z.string().max(60).nullable().optional(),
});

/** Create a template locally. Status starts DRAFT. OPERATOR GATE: submitting to
 *  Meta/Vobiz for approval happens in the Vobiz dashboard (Step 12 explains);
 *  the app tracks the DLT/Meta status. */
export async function createTemplateAction(input: unknown): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the template fields (name: lowercase/digits/underscores)." };
    const tpl = await db.whatsAppTemplate.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        language: parsed.data.language,
        body: parsed.data.body,
        dltTemplateId: parsed.data.dltTemplateId ?? null,
        status: "DRAFT",
      },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.template-create", entity: "WhatsAppTemplate", entityId: tpl.id });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true, id: tpl.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create the template." };
  }
}

/** Record the operator-side approval state (Meta/DLT decision made in the Vobiz
 *  dashboard). Only APPROVED templates can be sent. */
export async function setTemplateStatusAction(templateId: string, status: "PENDING" | "APPROVED" | "REJECTED"): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const s = z.enum(["PENDING", "APPROVED", "REJECTED"]).parse(status);
    const updated = await db.whatsAppTemplate.updateMany({
      where: { id: templateId, workspaceId: ctx.workspaceId },
      data: { status: s },
    });
    if (updated.count === 0) return { ok: false, error: "Template not found." };
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.template-status", entity: "WhatsAppTemplate", entityId: templateId, metadata: { status: s } });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not update the template." };
  }
}

export async function createWhatsAppCampaignAction(input: {
  name: string;
  templateId: string;
  listId: string;
}): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:write");
  try {
    const name = z.string().min(2).max(80).parse(input.name);
    const [template, list] = await Promise.all([
      db.whatsAppTemplate.findFirst({ where: { id: input.templateId, workspaceId: ctx.workspaceId, status: "APPROVED" } }),
      db.contactList.findFirst({ where: { id: input.listId, workspaceId: ctx.workspaceId } }),
    ]);
    if (!template) return { ok: false, error: "Pick an APPROVED template." };
    if (!list) return { ok: false, error: "Contact list not found." };
    const wc = await db.whatsAppCampaign.create({
      data: { workspaceId: ctx.workspaceId, name, templateId: template.id, listId: list.id, status: "DRAFT" },
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.campaign-create", entity: "WhatsAppCampaign", entityId: wc.id });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true, id: wc.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create the WhatsApp campaign." };
  }
}

/** Start sending: one throttled job per non-DNC contact. Dry-run gated downstream
 *  (WHATSAPP_DRY_RUN gate in src/worker/whatsapp.ts over guide 04's src/lib/vobiz.ts). */
export async function startWhatsAppCampaignAction(id: string): Promise<ActionResult> {
  const ctx = await requirePermission("campaigns:launch");
  try {
    const wc = await db.whatsAppCampaign.findFirst({
      where: { id, workspaceId: ctx.workspaceId, status: { in: ["DRAFT", "PAUSED"] } },
      include: { template: true },
    });
    if (!wc || !wc.listId) return { ok: false, error: "Campaign not found or already started." };
    if (wc.template.status !== "APPROVED") return { ok: false, error: "Template is not APPROVED." };

    const contacts = await db.contact.findMany({
      where: { workspaceId: ctx.workspaceId, listId: wc.listId, dnc: false, optOutAt: null },
      select: { phone: true, name: true },
    });
    if (contacts.length === 0) return { ok: false, error: "No dialable contacts in this list (all DNC?)." };

    const q = getWhatsAppQueue();
    for (let i = 0; i < contacts.length; i++) {
      await q.add(
        WHATSAPP_SEND_JOB,
        {
          workspaceId: ctx.workspaceId,
          whatsAppCampaignId: wc.id,
          phone: contacts[i].phone,
          templateName: wc.template.name,
          params: [contacts[i].name ?? "Customer"],
          index: i,
          total: contacts.length,
        },
        { jobId: `wa-${wc.id}-${i}` } // idempotent re-starts
      );
    }
    await db.whatsAppCampaign.update({ where: { id: wc.id }, data: { status: "RUNNING", startedAt: new Date() } });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "whatsapp.campaign-start", entity: "WhatsAppCampaign", entityId: wc.id, metadata: { recipients: contacts.length } });
    revalidatePath("/campaigns/whatsapp");
    return { ok: true, id: wc.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not start the WhatsApp campaign." };
  }
}
