"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { invalidateCache, marketplaceKey } from "@/lib/cache";

export type MarketplaceResult = { ok: boolean; error?: string; id?: string };

/** Publish one of MY agents as a marketplace template. */
export async function publishTemplateAction(agentId: string, input: unknown): Promise<MarketplaceResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = z
      .object({
        name: z.string().min(3).max(80),
        industry: z.string().min(2).max(60),
        description: z.string().min(10).max(500),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the publish form fields." };

    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      include: { toolConfigs: { where: { enabled: true } } },
    });
    if (!agent) return { ok: false, error: "Agent not found." };

    const tpl = await db.marketplaceTemplate.create({
      data: {
        authorWorkspaceId: ctx.workspaceId,
        name: parsed.data.name,
        industry: parsed.data.industry,
        description: parsed.data.description,
        systemPrompt: agent.systemPrompt,
        greeting: agent.greeting,
        config: {
          voiceId: agent.voiceId,
          llmModel: agent.llmModel,
          languageMode: agent.languageMode,
          tools: agent.toolConfigs.map((t) => t.tool),
        },
        published: true,
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "marketplace.publish", entity: "MarketplaceTemplate", entityId: tpl.id,
      metadata: { agentId },
    });
    await invalidateCache(marketplaceKey());
    revalidatePath("/marketplace");
    return { ok: true, id: tpl.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Take MY template off the marketplace. */
export async function unpublishTemplateAction(templateId: string): Promise<MarketplaceResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const updated = await db.marketplaceTemplate.updateMany({
      where: { id: templateId, authorWorkspaceId: ctx.workspaceId },
      data: { published: false },
    });
    if (updated.count === 0) return { ok: false, error: "Template not found (only the author can unpublish)." };
    await invalidateCache(marketplaceKey());
    revalidatePath("/marketplace");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Install a published template into MY workspace as a new DRAFT agent. */
export async function installTemplateAction(templateId: string): Promise<MarketplaceResult> {
  try {
    const ctx = await requirePermission("agents:write");
    // Cross-workspace read is intended: only published templates.
    const tpl = await db.marketplaceTemplate.findFirst({ where: { id: templateId, published: true } });
    if (!tpl) return { ok: false, error: "Template not found." };

    const [count, sub] = await Promise.all([
      db.agent.count({ where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } } }),
      db.subscription.findUnique({ where: { workspaceId: ctx.workspaceId }, include: { plan: true } }),
    ]);
    const max = sub?.plan.maxAgents ?? 2;
    if (count >= max) {
      return { ok: false, error: `Your plan allows ${max} agents. Archive one or upgrade in Billing.` };
    }

    const cfg = (tpl.config ?? {}) as { voiceId?: string; llmModel?: string; languageMode?: string; tools?: string[] };
    const agent = await db.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: tpl.name,
          template: `marketplace:${tpl.id}`,
          greeting: tpl.greeting,
          systemPrompt: tpl.systemPrompt,
          voiceId: cfg.voiceId ?? "anushka",
          llmModel: cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct",
          languageMode: cfg.languageMode ?? "auto",
          status: "DRAFT",
        },
      });
      await tx.marketplaceTemplate.update({
        where: { id: tpl.id },
        data: { installs: { increment: 1 } },
      });
      return created;
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "marketplace.install", entity: "MarketplaceTemplate", entityId: tpl.id,
      metadata: { agentId: agent.id },
    });
    await invalidateCache(marketplaceKey());
    revalidatePath("/agents");
    revalidatePath("/marketplace");
    return { ok: true, id: agent.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
