"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { validateToolConfig } from "@/lib/tool-configs";
import type { AgentToolType } from "@prisma/client";

export type ToolResult = { ok: boolean; error?: string; output?: string };

const TOOLS: AgentToolType[] = [
  "CALENDAR_BOOKING", "HUMAN_TRANSFER", "SMS", "WHATSAPP",
  "CRM_WRITE", "PAYMENT_LINK", "CUSTOM_WEBHOOK", "VOICEMAIL",
];

export async function upsertToolConfigAction(
  agentId: string,
  input: unknown,
): Promise<ToolResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = z
      .object({ tool: z.enum(TOOLS as [AgentToolType, ...AgentToolType[]]), enabled: z.coerce.boolean(), config: z.unknown() })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the tool form." };

    const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!agent) return { ok: false, error: "Agent not found." };

    const check = validateToolConfig(parsed.data.tool, parsed.data.config);
    if (!check.ok) return { ok: false, error: check.error };

    await db.agentToolConfig.upsert({
      where: { agentId_tool: { agentId, tool: parsed.data.tool } },
      update: { enabled: parsed.data.enabled, config: check.config as object },
      create: { agentId, tool: parsed.data.tool, enabled: parsed.data.enabled, config: check.config as object },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.tool_config", entity: "Agent", entityId: agentId,
      metadata: { tool: parsed.data.tool, enabled: parsed.data.enabled },
    });
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Dry-run "Test tool" button: executes the tool with safe sample input through the
 * SAME executor used in live calls (api/tools/execute route handler, imported here
 * as a plain function). VAANI_DRY_RUN=true (default) keeps it free.
 */
export async function testToolAction(agentId: string, tool: AgentToolType): Promise<ToolResult> {
  try {
    const ctx = await requirePermission("agents:read");
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      include: { toolConfigs: true },
    });
    if (!agent) return { ok: false, error: "Agent not found." };
    const row = agent.toolConfigs.find((t) => t.tool === tool);
    if (!row || !row.enabled) return { ok: false, error: "Enable and save the tool first." };

    const { executeTool } = await import("@/lib/tool-executor");
    const sample = sampleInput(tool);
    const result = await executeTool({
      workspaceId: ctx.workspaceId,
      agentId,
      tool,
      config: (row.config ?? {}) as Record<string, unknown>,
      input: sample,
    });
    return { ok: result.ok, error: result.error, output: JSON.stringify(result.data ?? result, null, 2).slice(0, 1500) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function sampleInput(tool: AgentToolType): Record<string, unknown> {
  switch (tool) {
    case "CALENDAR_BOOKING": return { action: "check" };
    case "SMS": return { to: "+919900000001", message: "Test message from Vaani AI (dry run)" };
    case "WHATSAPP": return { to: "+919900000001", template: "hello_world", params: ["Test"] };
    case "CRM_WRITE": return { lead: { name: "Test Lead", phone: "+919900000001", note: "dry run from Vaani" } };
    case "PAYMENT_LINK": return { amountPaise: 10000, description: "Test payment (dry run)", phone: "+919900000001" };
    case "CUSTOM_WEBHOOK": return { test: true };
    default: return {};
  }
}
