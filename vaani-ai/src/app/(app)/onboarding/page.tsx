import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { AGENT_TEMPLATES } from "@/lib/templates";
import { parseChecklist, progressPercent, canGoLive, nextStep } from "@/lib/onboarding";
import { WizardClient } from "./wizard-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Get started — Vaani AI" };

export default async function OnboardingPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [workspace, state, trial, agents, numbers] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } }),
    db.onboardingState.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: {},
      create: { workspaceId: ctx.workspaceId },
    }),
    db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.agent.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, status: true, dograhWorkflowId: true },
    }),
    db.phoneNumber.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, number: true, label: true },
    }),
  ]);

  const checklist = parseChecklist(state.checklist);
  const industryTemplates = workspace.industry
    ? AGENT_TEMPLATES.filter(
        (t) => t.industry.toLowerCase().replace(/[^a-z0-9]+/g, "-") === workspace.industry,
      )
    : [];
  const templates = (industryTemplates.length > 0 ? industryTemplates : AGENT_TEMPLATES).map((t) => ({
    code: t.code,
    name: t.name,
    industry: t.industry,
    description: t.description,
  }));

  // Inline server action: assign the operator-provisioned trial sandbox DID.
  async function useSandboxNumberAction(): Promise<{ ok: boolean; error?: string }> {
    "use server";
    const { requirePermission } = await import("@/lib/auth");
    const { registerNumberAction, assignAgentAction } = await import("@/server/actions/numbers");
    const ctx2 = await requirePermission("settings:write");
    const sandbox = process.env.TRIAL_SANDBOX_NUMBER ?? "";
    if (!/^\+[1-9]\d{7,14}$/.test(sandbox)) {
      return { ok: false, error: "Trial sandbox number is not configured yet (operator sets TRIAL_SANDBOX_NUMBER)." };
    }
    const reg = await registerNumberAction({
      number: sandbox,
      label: "Trial sandbox",
      numberType: "LOCAL",
      monthlyRentPaise: 0,
    });
    if (!reg.ok && !reg.error?.includes("already registered")) return reg;
    const row = await db.phoneNumber.findFirst({
      where: { workspaceId: ctx2.workspaceId, number: sandbox },
    });
    if (!row) return { ok: false, error: "Sandbox number registration failed." };
    const agent = await db.agent.findFirst({
      where: { workspaceId: ctx2.workspaceId, status: "PUBLISHED" },
      orderBy: { createdAt: "asc" },
    });
    if (agent) {
      const asg = await assignAgentAction(row.id, agent.id);
      if (!asg.ok) return asg;
    }
    await db.trialState.upsert({
      where: { workspaceId: ctx2.workspaceId },
      update: { sandboxNumberId: row.id },
      create: { workspaceId: ctx2.workspaceId, sandboxNumberId: row.id },
    });
    return { ok: true };
  }

  return (
    <WizardClient
      initialStep={state.completedAt ? 5 : nextStep(checklist)}
      checklist={checklist}
      progress={progressPercent(checklist)}
      canFinish={canGoLive(checklist)}
      completed={state.completedAt != null}
      workspaceName={workspace.name}
      industry={workspace.industry ?? ""}
      templates={templates}
      agents={agents.map((a) => ({
        id: a.id,
        name: a.name,
        published: a.status === "PUBLISHED" && a.dograhWorkflowId != null,
      }))}
      numbers={numbers}
      kycStatus={trial?.kycStatus ?? "NOT_STARTED"}
      trialMinutesLeft={trial ? Math.max(0, trial.trialMinutesLimit - trial.trialMinutesUsed) : 0}
      sandboxConfigured={/^\+[1-9]\d{7,14}$/.test(process.env.TRIAL_SANDBOX_NUMBER ?? "")}
      useSandboxNumber={useSandboxNumberAction}
    />
  );
}
