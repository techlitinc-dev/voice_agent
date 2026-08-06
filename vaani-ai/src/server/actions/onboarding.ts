"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, requireWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  canGoLive,
  mergeChecklist,
  nextStep,
  parseChecklist,
  progressPercent,
  type OnboardingChecklist,
  type WizardStepKey,
} from "@/lib/onboarding";
import {
  buildSampleCalls,
  buildSampleContacts,
  sampleCallWhere,
  sampleContactWhere,
  SAMPLE_PREFIX,
} from "@/lib/sample-data";

export type OnboardingResult = { ok: boolean; error?: string };

export type OnboardingSnapshot = {
  currentStep: number;
  checklist: OnboardingChecklist;
  progress: number;
  sampleDataEnabled: boolean;
  completed: boolean;
  canFinish: boolean;
};

async function getOrCreateState(workspaceId: string) {
  return db.onboardingState.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId },
  });
}

/** Read-only snapshot used by the wizard, the dashboard widget and the app layout. */
export async function getOnboardingStateAction(): Promise<OnboardingSnapshot | null> {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return null;
  }
  const state = await getOrCreateState(ctx.workspaceId);
  const checklist = parseChecklist(state.checklist);
  return {
    currentStep: state.currentStep,
    checklist,
    progress: progressPercent(checklist),
    sampleDataEnabled: state.sampleDataEnabled,
    completed: state.completedAt != null,
    canFinish: canGoLive(checklist),
  };
}

/** Mark a checklist item done and advance currentStep to the next incomplete step. */
export async function markStepAction(key: WizardStepKey): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    if (key === "live") return { ok: false, error: "Use completeOnboardingAction to finish." };
    const state = await getOrCreateState(ctx.workspaceId);
    const checklist = mergeChecklist(parseChecklist(state.checklist), { [key]: true });
    await db.onboardingState.update({
      where: { workspaceId: ctx.workspaceId },
      data: { checklist, currentStep: nextStep(checklist) },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: `onboarding.step.${key}`, entity: "OnboardingState", entityId: state.id,
    });
    revalidatePath("/onboarding");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Industry pick — also stored on the Workspace (settings page shows it). */
export async function setWizardIndustryAction(industry: string): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const clean = industry.trim().toLowerCase();
    if (clean.length < 2 || clean.length > 40) return { ok: false, error: "Pick an industry." };
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { industry: clean } });
    return markStepAction("industry");
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Finish the wizard. Requires industry + template (canGoLive). */
export async function completeOnboardingAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const state = await getOrCreateState(ctx.workspaceId);
    const checklist = parseChecklist(state.checklist);
    if (!canGoLive(checklist)) {
      return { ok: false, error: "Pick an industry and a template agent first." };
    }
    await db.onboardingState.update({
      where: { workspaceId: ctx.workspaceId },
      data: { completedAt: new Date(), currentStep: 5 },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "onboarding.completed", entity: "OnboardingState", entityId: state.id,
      metadata: { checklist },
    });
    revalidatePath("/onboarding");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Dismiss the dashboard checklist widget (persists in checklist.dismissed). */
export async function dismissChecklistAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requireWorkspace();
    const state = await getOrCreateState(ctx.workspaceId);
    await db.onboardingState.update({
      where: { workspaceId: ctx.workspaceId },
      data: { checklist: mergeChecklist(parseChecklist(state.checklist), { dismissed: true }) },
    });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Sample data mode ON: seed demo contacts + campaign + calls into THIS workspace. */
export async function seedSampleDataAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const wsId = ctx.workspaceId;
    const state = await getOrCreateState(wsId);
    if (state.sampleDataEnabled) return { ok: true }; // idempotent

    const agent = await db.agent.findFirst({
      where: { workspaceId: wsId },
      orderBy: { createdAt: "asc" },
    });
    const number = await db.phoneNumber.findFirst({
      where: { workspaceId: wsId },
      orderBy: { createdAt: "asc" },
    });
    const businessNumber = number?.number ?? "+917777000099";

    const list = await db.contactList.create({
      data: { workspaceId: wsId, name: `${SAMPLE_PREFIX}demo list` },
    });
    await db.contact.createMany({ data: buildSampleContacts(wsId) });

    let campaignId: string | null = null;
    if (agent) {
      const campaign = await db.campaign.create({
        data: {
          workspaceId: wsId,
          name: `${SAMPLE_PREFIX}demo campaign`,
          type: "APPOINTMENT_REMINDER",
          agentId: agent.id,
          listId: list.id,
          status: "COMPLETED",
          finishedAt: new Date(),
        },
      });
      campaignId = campaign.id;
    }

    const calls = buildSampleCalls({
      workspaceId: wsId,
      agentId: agent?.id ?? null,
      campaignId,
      businessNumber,
    });
    for (const c of calls) {
      await db.call.create({ data: c });
    }

    await db.onboardingState.update({
      where: { workspaceId: wsId },
      data: { sampleDataEnabled: true },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "onboarding.sample_data.seed", entity: "OnboardingState", entityId: state.id,
    });
    revalidatePath("/dashboard");
    revalidatePath("/calls");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Sample data mode OFF: delete ONLY rows carrying the sample markers. */
export async function clearSampleDataAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const wsId = ctx.workspaceId;

    // Delete QA scores + events of sample calls first (children), then the calls.
    const sampleCalls = await db.call.findMany({
      where: sampleCallWhere(wsId),
      select: { id: true },
    });
    const callIds = sampleCalls.map((c) => c.id);
    await db.qaScore.deleteMany({ where: { workspaceId: wsId, callId: { in: callIds } } });
    await db.callEvent.deleteMany({ where: { callId: { in: callIds } } });
    await db.transcriptEntry.deleteMany({ where: { callId: { in: callIds } } });
    await db.call.deleteMany({ where: sampleCallWhere(wsId) });

    await db.contact.deleteMany({ where: sampleContactWhere(wsId) });
    await db.campaign.deleteMany({
      where: { workspaceId: wsId, name: { startsWith: SAMPLE_PREFIX } },
    });
    await db.contactList.deleteMany({
      where: { workspaceId: wsId, name: { startsWith: SAMPLE_PREFIX } },
    });

    await db.onboardingState.update({
      where: { workspaceId: wsId },
      data: { sampleDataEnabled: false },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "onboarding.sample_data.clear", entity: "OnboardingState",
    });
    revalidatePath("/dashboard");
    revalidatePath("/calls");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
