"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { invalidateCache, agentConfigKey } from "@/lib/cache";
import { getTemplate } from "@/lib/templates";
import {
  buildAgentWorkflow,
  validateWorkflowDefinition,
  DEFAULT_CONTROLS,
  type ConversationControls,
} from "@/lib/workflow-builder";
import { llmFallbackChain } from "@/lib/voices";
import { nextVersionNumber, snapshotAgent, validateAbSplit } from "@/lib/versions";
import { checkFeatureGate } from "@/lib/feature-gates";
import {
  dograhCreateWorkflow,
  dograhUpdateWorkflow,
  dograhPublishWorkflow,
  dograhCreateTestRun,
  dograhWorkflowUiUrl,
  DograhError,
} from "@/lib/dograh";

export type ActionResult = { ok: boolean; error?: string; id?: string; url?: string };

// ---------- Zod schemas (boundaries) ----------

const conversationConfigSchema = z.object({
  allowBargeIn: z.boolean().default(true),
  vadSensitivity: z.enum(["low", "medium", "high"]).default("medium"),
  silenceTimeoutSec: z.coerce.number().int().min(5).max(120).default(20),
  fillerPhrases: z.array(z.string().max(60)).max(6).default(DEFAULT_CONTROLS.fillerPhrases),
  speakingPace: z.enum(["slow", "normal", "fast"]).default("normal"),
  voiceMap: z.record(z.string(), z.string()).default({}),
});

const agentSchema = z.object({
  name: z.string().min(2).max(80),
  template: z.string().optional(),
  greeting: z.string().min(5).max(500),
  systemPrompt: z.string().min(20).max(8000),
  languageMode: z.enum(["auto", "fixed", "caller-select"]),
  fixedLanguage: z.string().max(10).optional(),
  voiceId: z.string().min(1).max(40),
  customVoiceId: z.string().max(40).nullable().optional(),
  llmModel: z.string().min(3).max(120),
  temperature: z.coerce.number().min(0).max(1).default(0.7),
  maxTokens: z.coerce.number().int().min(1).max(4096).default(300),
  maxCallSeconds: z.coerce.number().int().min(60).max(3600),
  kbGuardrail: z.coerce.boolean().default(false),
  conversationConfig: conversationConfigSchema.default(conversationConfigSchema.parse({})),
});

// ---------- Plan gate (guide 09 owns billing; we only enforce maxAgents) ----------

async function assertAgentQuota(workspaceId: string): Promise<string | null> {
  const [count, sub] = await Promise.all([
    db.agent.count({ where: { workspaceId, NOT: { status: "ARCHIVED" } } }),
    db.subscription.findUnique({ where: { workspaceId }, include: { plan: true } }),
  ]);
  const max = sub?.plan.maxAgents ?? 2; // no subscription → starter-equivalent
  if (count >= max) {
    return `Your plan allows ${max} agent${max === 1 ? "" : "s"}. Archive one or upgrade in Billing.`;
  }
  return null;
}

// ---------- Helpers ----------

async function loadAgent(workspaceId: string, agentId: string) {
  return db.agent.findFirst({
    where: { id: agentId, workspaceId },
    include: {
      toolConfigs: { where: { enabled: true } },
      customVoice: { select: { provider: true, clonedVoiceId: true, language: true, status: true } },
    },
  });
}

/** Resolve the cloned brand voice hint for a workflow, if the agent has one READY. */
async function customVoiceHint(
  agent: { workspaceId: string; customVoiceId: string | null },
): Promise<{ provider: string; clonedVoiceId: string; language: string } | null> {
  if (!agent.customVoiceId) return null;
  const voice = await db.customVoice.findFirst({
    where: { id: agent.customVoiceId, workspaceId: agent.workspaceId, status: "READY", clonedVoiceId: { not: null } },
    select: { provider: true, clonedVoiceId: true, language: true },
  });
  return voice?.clonedVoiceId ? { provider: voice.provider, clonedVoiceId: voice.clonedVoiceId, language: voice.language } : null;
}

/** Guard: a customVoiceId from the form must belong to this workspace. */
async function assertCustomVoiceScoped(
  workspaceId: string,
  customVoiceId: string | null,
): Promise<boolean> {
  if (!customVoiceId) return true;
  const voice = await db.customVoice.findFirst({
    where: { id: customVoiceId, workspaceId },
    select: { id: true },
  });
  return Boolean(voice);
}

/** AGENT-10 plan gate: using a cloned voice requires premiumVoices (Enterprise
 *  plan or premium-voices add-on). Fail closed on gate-check error. */
async function assertVoiceCloneGate(workspaceId: string, customVoiceId: string | null): Promise<string | null> {
  if (!customVoiceId) return null;
  try {
    const gate = await checkFeatureGate(workspaceId, "premiumVoices");
    if (!gate.allowed) {
      return "Custom voice cloning requires the Enterprise plan or the premium-voices add-on (Settings → Custom voices).";
    }
  } catch {
    return "Custom voice cloning requires the Enterprise plan or the premium-voices add-on (Settings → Custom voices).";
  }
  return null;
}

function controlsOf(agent: { conversationConfig: unknown }): ConversationControls {
  const parsed = conversationConfigSchema.safeParse(agent.conversationConfig ?? {});
  return parsed.success ? parsed.data : conversationConfigSchema.parse({});
}

/** Build + validate the Dograh workflow JSON for an agent row (or version snapshot). */
function workflowFor(input: {
  name: string;
  greeting: string;
  systemPrompt: string;
  languageMode: string;
  fixedLanguage: string | null;
  voiceId: string;
  customVoice?: { provider: string; clonedVoiceId: string; language: string } | null;
  llmModel: string;
  temperature?: number;
  maxTokens?: number;
  maxCallSeconds: number;
  kbGuardrail: boolean;
  conversationConfig: unknown;
  tools: { tool: string; config: unknown }[];
  businessName: string;
}) {
  const fill = (t: string) => t.replaceAll("{{business_name}}", input.businessName);
  const def = buildAgentWorkflow({
    name: input.name,
    greeting: fill(input.greeting),
    systemPrompt: fill(input.systemPrompt),
    languageMode: input.languageMode as "auto" | "fixed" | "caller-select",
    fixedLanguage: input.fixedLanguage,
    voiceId: input.voiceId,
    customVoice: input.customVoice,
    llmModel: input.llmModel,
    temperature: input.temperature ?? 0.7,
    maxTokens: input.maxTokens ?? 300,
    llmFallbacks: llmFallbackChain(input.llmModel),
    maxCallSeconds: Math.min(1200, input.maxCallSeconds), // Dograh cap
    controls: controlsOf({ conversationConfig: input.conversationConfig }),
    kbGuardrail: input.kbGuardrail,
    tools: input.tools.map((t) => ({ tool: t.tool, config: (t.config ?? {}) as Record<string, unknown> })),
  });
  const check = validateWorkflowDefinition(def);
  if (!check.valid) throw new Error(`workflow invalid: ${check.errors.join("; ")}`);
  return def;
}

/** Push a workflow definition to Dograh: update existing workflow or create new. */
async function pushToDograh(
  existingId: string | null,
  name: string,
  definition: Record<string, unknown>,
  maxCallSeconds: number,
): Promise<{ id: string; uuid: string | null }> {
  if (existingId) {
    await dograhUpdateWorkflow(Number(existingId), {
      name,
      workflow_definition: definition,
      workflow_configurations: { max_call_duration: Math.min(1200, maxCallSeconds) },
    });
    await dograhPublishWorkflow(Number(existingId));
    const uuid = await db.agentVersion
      .findFirst({ where: { dograhWorkflowId: existingId }, select: { dograhWorkflowUuid: true } })
      .then((r) => r?.dograhWorkflowUuid ?? null);
    return { id: existingId, uuid };
  }
  const wf = await dograhCreateWorkflow(name, definition);
  await dograhPublishWorkflow(wf.id);
  return { id: String(wf.id), uuid: wf.workflow_uuid ?? null };
}

// ---------- CRUD ----------

export async function createAgentAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = agentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please check the form fields." };
    const quotaError = await assertAgentQuota(ctx.workspaceId);
    if (quotaError) return { ok: false, error: quotaError };

    const { kbGuardrail, conversationConfig, ...fields } = parsed.data;
    // empty string from an unselected <select> → null
    if (fields.customVoiceId === "") fields.customVoiceId = null;
    const voiceOk = await assertCustomVoiceScoped(ctx.workspaceId, fields.customVoiceId ?? null);
    if (!voiceOk) return { ok: false, error: "That custom voice does not belong to this workspace." };
    const cloneGate = await assertVoiceCloneGate(ctx.workspaceId, fields.customVoiceId ?? null);
    if (cloneGate) return { ok: false, error: cloneGate };
    const agent = await db.agent.create({
      data: {
        ...fields,
        workspaceId: ctx.workspaceId,
        status: "DRAFT",
        conversationConfig: { ...conversationConfig, kbGuardrail },
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.create", entity: "Agent", entityId: agent.id,
      metadata: { name: agent.name },
    });
    revalidatePath("/agents");
    return { ok: true, id: agent.id };
  } catch (e) {
    return handleError(e);
  }
}

export async function createAgentFromTemplateAction(templateCode: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const t = getTemplate(templateCode);
    if (!t) return { ok: false, error: "Unknown template." };
    const quotaError = await assertAgentQuota(ctx.workspaceId);
    if (quotaError) return { ok: false, error: quotaError };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });

    const agent = await db.agent.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: `${t.name} — ${workspace.name}`,
        template: t.code,
        greeting: t.greeting,
        systemPrompt: t.systemPrompt,
        languageMode: "auto",
        voiceId: t.suggestedVoice,
        llmModel: t.suggestedLlm,
        status: "DRAFT",
        conversationConfig: { ...DEFAULT_CONTROLS, kbGuardrail: false },
      },
    });
    // Suggested tools from the template → enabled AgentToolConfig rows.
    if (t.suggestedTools.length > 0) {
      await db.agentToolConfig.createMany({
        data: t.suggestedTools.map((tool) => ({ agentId: agent.id, tool, enabled: true, config: {} })),
      });
    }
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.create_from_template", entity: "Agent", entityId: agent.id,
      metadata: { template: templateCode },
    });
    revalidatePath("/agents");
    return { ok: true, id: agent.id };
  } catch (e) {
    return handleError(e);
  }
}

export async function updateAgentAction(agentId: string, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = agentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please check the form fields." };

    const { kbGuardrail, conversationConfig, ...fields } = parsed.data;
    // empty string from an unselected <select> → null
    if (fields.customVoiceId === "") fields.customVoiceId = null;
    const voiceOk = await assertCustomVoiceScoped(ctx.workspaceId, fields.customVoiceId ?? null);
    if (!voiceOk) return { ok: false, error: "That custom voice does not belong to this workspace." };
    const cloneGate = await assertVoiceCloneGate(ctx.workspaceId, fields.customVoiceId ?? null);
    if (cloneGate) return { ok: false, error: cloneGate };
    // Tenant scope: the WHERE includes workspaceId — an id from the URL is not enough.
    const updated = await db.agent.updateMany({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      data: {
        ...fields,
        conversationConfig: { ...conversationConfig, kbGuardrail },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return { ok: false, error: "Agent not found." };

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.update", entity: "Agent", entityId: agentId,
    });
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: agentId };
  } catch (e) {
    return handleError(e);
  }
}

export async function cloneAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const quotaError = await assertAgentQuota(ctx.workspaceId);
    if (quotaError) return { ok: false, error: quotaError };
    const agent = await loadAgent(ctx.workspaceId, agentId);
    if (!agent) return { ok: false, error: "Agent not found." };
    // never clone Dograh linkage — the copy publishes its own workflow later
    const copy = await db.agent.create({
      data: {
        workspaceId: agent.workspaceId,
        name: `${agent.name} (copy)`,
        template: agent.template,
        greeting: agent.greeting,
        systemPrompt: agent.systemPrompt,
        languageMode: agent.languageMode,
        fixedLanguage: agent.fixedLanguage,
        voiceId: agent.voiceId,
        customVoiceId: agent.customVoiceId,
        llmModel: agent.llmModel,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        maxCallSeconds: agent.maxCallSeconds,
        recordingDisclosureText: agent.recordingDisclosureText,
        conversationConfig: (agent.conversationConfig ?? {}) as object,
        status: "DRAFT",
        version: 1,
      },
    });
    if (agent.toolConfigs.length > 0) {
      await db.agentToolConfig.createMany({
        data: agent.toolConfigs.map((t) => ({ agentId: copy.id, tool: t.tool, enabled: t.enabled, config: t.config ?? {} })),
      });
    }
    revalidatePath("/agents");
    return { ok: true, id: copy.id };
  } catch (e) {
    return handleError(e);
  }
}

export async function archiveAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:delete");
    const updated = await db.agent.updateMany({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      data: { status: "ARCHIVED" },
    });
    if (updated.count === 0) return { ok: false, error: "Agent not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.archive", entity: "Agent", entityId: agentId,
    });
    revalidatePath("/agents");
    return { ok: true };
  } catch (e) {
    return handleError(e);
  }
}

/** AGENT-27 unpublish: take the LIVE agent offline. The latest PUBLISHED main
 *  version flips to DRAFT and the Agent's status returns to DRAFT — a number
 *  assignment stays but the workflow is no longer live. Publish later re-freezes
 *  a new snapshot. */
export async function unpublishAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      select: { id: true, status: true },
    });
    if (!agent) return { ok: false, error: "Agent not found." };
    if (agent.status !== "PUBLISHED") return { ok: false, error: "Only a published agent can be unpublished." };

    await db.$transaction([
      // Draft the live main version (A/B variants get archived — no live traffic).
      db.agentVersion.updateMany({
        where: { agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
        data: { status: "DRAFT" },
      }),
      db.agent.update({
        where: { id: agentId },
        data: { status: "DRAFT", pinnedVersionId: null },
      }),
    ]);
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.unpublish", entity: "Agent", entityId: agentId,
    });
    await invalidateCache(agentConfigKey(agentId));
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (e) {
    return handleError(e);
  }
}

// ---------- Version control: publish / rollback / A/B ----------

/**
 * Publish the CURRENT draft: freeze a new AgentVersion snapshot, push its workflow
 * to Dograh, mark the version PUBLISHED, mirror ids onto the Agent row.
 */
export async function publishAgentAction(agentId: string, label?: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const agent = await loadAgent(ctx.workspaceId, agentId);
    if (!agent) return { ok: false, error: "Agent not found." };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    const kbGuardrail =
      (agent.conversationConfig as { kbGuardrail?: boolean } | null)?.kbGuardrail === true;

    const definition = workflowFor({
      ...agent,
      kbGuardrail,
      customVoice: await customVoiceHint(agent),
      tools: agent.toolConfigs,
      businessName: workspace.name,
    });
    const versions = await db.agentVersion.findMany({
      where: { agentId: agent.id, workspaceId: ctx.workspaceId },
      select: { version: true },
    });
    const snapshot = snapshotAgent(agent);

    // A/B safety: publishing a new main version removes any stale A/B variant.
    await db.agentVersion.updateMany({
      where: { agentId: agent.id, workspaceId: ctx.workspaceId, isAbVariant: true, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    });
    // Demote the previous live main version so rollback has a target (guide 11).
    await db.agentVersion.updateMany({
      where: { agentId: agent.id, workspaceId: ctx.workspaceId, isAbVariant: false, status: "PUBLISHED" },
      data: { status: "DRAFT" },
    });

    const pushed = await pushToDograh(null, agent.name, definition as Record<string, unknown>, agent.maxCallSeconds);

    const version = await db.agentVersion.create({
      data: {
        agentId: agent.id,
        workspaceId: ctx.workspaceId,
        version: nextVersionNumber(versions),
        status: "PUBLISHED",
        label: label ?? null,
        systemPrompt: snapshot.systemPrompt,
        greeting: snapshot.greeting,
        config: { ...snapshot.config, kbGuardrail } as object,
        dograhWorkflowId: pushed.id,
        dograhWorkflowUuid: pushed.uuid,
        publishedAt: new Date(),
        createdByUserId: ctx.user.id,
      },
    });

    await db.agent.update({
      where: { id: agent.id },
      data: { status: "PUBLISHED", dograhWorkflowId: pushed.id, dograhWorkflowUuid: pushed.uuid, pinnedVersionId: null },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.publish", entity: "Agent", entityId: agent.id,
      metadata: { version: version.version, dograhWorkflowId: pushed.id },
    });
    await invalidateCache(agentConfigKey(agent.id));
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: version.id };
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Rollback (one click): re-publish an OLDER version — its stored snapshot is pushed
 * back to Dograh (reusing its Dograh workflow id), the version flips to PUBLISHED,
 * and the Agent's editable fields are overwritten with the snapshot so the UI shows
 * exactly what is live.
 */
export async function rollbackAgentAction(agentId: string, versionId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const version = await db.agentVersion.findFirst({
      where: { id: versionId, agentId, workspaceId: ctx.workspaceId },
    });
    if (!version) return { ok: false, error: "Version not found." };
    if (version.isAbVariant) return { ok: false, error: "Cannot roll back to an A/B variant." };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    const cfg = (version.config ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(cfg.tools) ? (cfg.tools as { tool: string; config: unknown }[]) : [];
    const customVoiceId = (cfg.customVoiceId as string | null) ?? null;
    const customVoice = customVoiceId
      ? await customVoiceHint({ workspaceId: ctx.workspaceId, customVoiceId })
      : null;

    const definition = workflowFor({
      name: `rollback-v${version.version}`,
      greeting: version.greeting,
      systemPrompt: version.systemPrompt,
      languageMode: String(cfg.languageMode ?? "auto"),
      fixedLanguage: (cfg.fixedLanguage as string | null) ?? null,
      voiceId: String(cfg.voiceId ?? "anushka"),
      customVoice,
      llmModel: String(cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct"),
      temperature: typeof cfg.temperature === "number" ? cfg.temperature : 0.7,
      maxTokens: typeof cfg.maxTokens === "number" ? cfg.maxTokens : 300,
      maxCallSeconds: Number(cfg.maxCallSeconds ?? 600),
      kbGuardrail: cfg.kbGuardrail === true,
      conversationConfig: cfg.conversationConfig ?? {},
      tools,
      businessName: workspace.name,
    });

    const pushed = await pushToDograh(
      version.dograhWorkflowId,
      `rollback-v${version.version}`,
      definition as Record<string, unknown>,
      Number(cfg.maxCallSeconds ?? 600),
    );
    const uuid = pushed.uuid ?? version.dograhWorkflowUuid;

    await db.$transaction([
      db.agentVersion.updateMany({
        where: { agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      }),
      db.agentVersion.update({
        where: { id: version.id },
        data: { status: "PUBLISHED", publishedAt: new Date(), dograhWorkflowId: pushed.id, dograhWorkflowUuid: uuid },
      }),
      db.agent.update({
        where: { id: agentId },
        data: {
          status: "PUBLISHED",
          dograhWorkflowId: pushed.id,
          dograhWorkflowUuid: uuid,
          pinnedVersionId: null,
          systemPrompt: version.systemPrompt,
          greeting: version.greeting,
          voiceId: String(cfg.voiceId ?? "anushka"),
          customVoiceId,
          llmModel: String(cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct"),
          temperature: typeof cfg.temperature === "number" ? cfg.temperature : 0.7,
          maxTokens: typeof cfg.maxTokens === "number" ? cfg.maxTokens : 300,
          languageMode: String(cfg.languageMode ?? "auto"),
          fixedLanguage: (cfg.fixedLanguage as string | null) ?? null,
          maxCallSeconds: Number(cfg.maxCallSeconds ?? 600),
        },
      }),
    ]);
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.rollback", entity: "Agent", entityId: agentId,
      metadata: { toVersion: version.version, dograhWorkflowId: pushed.id },
    });
    await invalidateCache(agentConfigKey(agentId));
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: version.id };
  } catch (e) {
    return handleError(e);
  }
}

/** Create an A/B variant from a published version with a traffic split (1–99%). */
export async function createAbVariantAction(
  agentId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const parsed = z
      .object({
        fromVersionId: z.string().min(1),
        abTrafficPercent: z.coerce.number().int(),
        label: z.string().max(80).optional(),
        systemPrompt: z.string().min(20).max(8000).optional(),
        greeting: z.string().min(5).max(500).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the A/B form fields." };

    const existing = await db.agentVersion.findMany({
      where: { agentId, workspaceId: ctx.workspaceId, isAbVariant: true, status: "PUBLISHED" },
      select: { id: true },
    });
    const split = validateAbSplit({ existingAbVariants: existing, trafficPercent: parsed.data.abTrafficPercent });
    if (!split.ok) return { ok: false, error: split.error };

    const source = await db.agentVersion.findFirst({
      where: { id: parsed.data.fromVersionId, agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
    });
    if (!source) return { ok: false, error: "Source version not found or not published." };
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    const cfg = (source.config ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(cfg.tools) ? (cfg.tools as { tool: string; config: unknown }[]) : [];
    const customVoiceId = (cfg.customVoiceId as string | null) ?? null;
    const customVoice = customVoiceId
      ? await customVoiceHint({ workspaceId: ctx.workspaceId, customVoiceId })
      : null;

    const systemPrompt = parsed.data.systemPrompt ?? source.systemPrompt;
    const greeting = parsed.data.greeting ?? source.greeting;
    const definition = workflowFor({
      name: `ab-variant`,
      greeting, systemPrompt,
      languageMode: String(cfg.languageMode ?? "auto"),
      fixedLanguage: (cfg.fixedLanguage as string | null) ?? null,
      voiceId: String(cfg.voiceId ?? "anushka"),
      customVoice,
      llmModel: String(cfg.llmModel ?? "meta-llama/llama-3.1-70b-instruct"),
      temperature: typeof cfg.temperature === "number" ? cfg.temperature : 0.7,
      maxTokens: typeof cfg.maxTokens === "number" ? cfg.maxTokens : 300,
      maxCallSeconds: Number(cfg.maxCallSeconds ?? 600),
      kbGuardrail: cfg.kbGuardrail === true,
      conversationConfig: cfg.conversationConfig ?? {},
      tools,
      businessName: workspace.name,
    });
    const pushed = await pushToDograh(null, "ab-variant", definition as Record<string, unknown>, Number(cfg.maxCallSeconds ?? 600));

    const versions = await db.agentVersion.findMany({
      where: { agentId, workspaceId: ctx.workspaceId }, select: { version: true },
    });
    const variant = await db.agentVersion.create({
      data: {
        agentId,
        workspaceId: ctx.workspaceId,
        version: nextVersionNumber(versions),
        status: "PUBLISHED",
        label: parsed.data.label ?? `A/B variant (${parsed.data.abTrafficPercent}% traffic)`,
        systemPrompt,
        greeting,
        config: { ...cfg } as object,
        dograhWorkflowId: pushed.id,
        dograhWorkflowUuid: pushed.uuid,
        isAbVariant: true,
        abTrafficPercent: parsed.data.abTrafficPercent,
        publishedAt: new Date(),
        createdByUserId: ctx.user.id,
      },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.ab_variant", entity: "Agent", entityId: agentId,
      metadata: { variantVersion: variant.version, pct: parsed.data.abTrafficPercent },
    });
    await invalidateCache(agentConfigKey(agentId));
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, id: variant.id };
  } catch (e) {
    return handleError(e);
  }
}

/** End the A/B test: archive the variant; the main version serves 100% again. */
export async function removeAbVariantAction(agentId: string, variantId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const updated = await db.agentVersion.updateMany({
      where: { id: variantId, agentId, workspaceId: ctx.workspaceId, isAbVariant: true },
      data: { status: "ARCHIVED" },
    });
    if (updated.count === 0) return { ok: false, error: "Variant not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.ab_variant_end", entity: "Agent", entityId: agentId,
      metadata: { variantId },
    });
    await invalidateCache(agentConfigKey(agentId));
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (e) {
    return handleError(e);
  }
}

// ---------- Version pinning (AGENT-33) ----------

/** Pin a PUBLISHED version: every call to this agent uses THIS version (its own
 *  Dograh workflow) regardless of A/B split — the pinned version serves 100%. */
export async function pinVersionAction(agentId: string, versionId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const version = await db.agentVersion.findFirst({
      where: { id: versionId, agentId, workspaceId: ctx.workspaceId, status: "PUBLISHED" },
      select: { id: true },
    });
    if (!version) return { ok: false, error: "Only a published version can be pinned." };
    const updated = await db.agent.updateMany({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      data: { pinnedVersionId: version.id },
    });
    if (updated.count === 0) return { ok: false, error: "Agent not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.pin_version", entity: "Agent", entityId: agentId,
      metadata: { versionId: version.id },
    });
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (e) {
    return handleError(e);
  }
}

/** Unpin: routing goes back to the A/B split (or the main version if no variant). */
export async function unpinVersionAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:write");
    const updated = await db.agent.updateMany({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      data: { pinnedVersionId: null },
    });
    if (updated.count === 0) return { ok: false, error: "Agent not found." };
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.unpin_version", entity: "Agent", entityId: agentId,
    });
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (e) {
    return handleError(e);
  }
}

// ---------- Test-in-browser (readme §4.1) ----------

/**
 * "Test call" button: create a Dograh test run (no real phone call) and return the
 * Dograh web-UI URL where the operator talks to the agent via the web-call/WebRTC
 * widget. The agent must be published first (needs a Dograh workflow id).
 */
export async function createTestRunAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:read");
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
    });
    if (!agent) return { ok: false, error: "Agent not found." };
    if (!agent.dograhWorkflowId) {
      return { ok: false, error: "Publish the agent first — test calls run against the Dograh workflow." };
    }
    await dograhCreateTestRun(Number(agent.dograhWorkflowId));
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "agent.test_run", entity: "Agent", entityId: agentId,
    });
    return { ok: true, id: agent.id, url: dograhWorkflowUiUrl(agent.dograhWorkflowId) };
  } catch (e) {
    return handleError(e);
  }
}

/** Deep link for the "Open advanced flow editor" button. */
export async function advancedEditorUrlAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("agents:read");
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId },
      select: { dograhWorkflowId: true },
    });
    if (!agent) return { ok: false, error: "Agent not found." };
    if (!agent.dograhWorkflowId) return { ok: false, error: "Publish the agent first." };
    return { ok: true, url: dograhWorkflowUiUrl(agent.dograhWorkflowId) };
  } catch (e) {
    return handleError(e);
  }
}

// ---------- Errors ----------

function handleError(e: unknown): ActionResult {
  if (e instanceof DograhError) {
    console.error(e);
    return { ok: false, error: "Voice engine error. Check Dograh is running (guide 04)." };
  }
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false, error: "You need a higher role for this (see the permission matrix)." };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
