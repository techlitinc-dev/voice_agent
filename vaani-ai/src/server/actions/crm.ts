"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { logCrmActivity, requiresApproval } from "@/lib/crm";
import { recomputeLeadScore } from "@/lib/crm/scoring";
import { invalidateCache, crmStatsKey } from "@/lib/cache";
import { sendStaffEmail, sendStaffWhatsApp } from "@/lib/notify";
import { hasPermission } from "@/lib/permissions";
import { formatINR } from "@/lib/money";

/** Invalidate cached CRM analytics for a workspace (guide crm/05 §9.2). */
async function invalidateCrmAnalytics(workspaceId: string) {
  for (const r of ["30d", "90d", "12m"]) {
    await invalidateCache(crmStatsKey(workspaceId, r));
    await invalidateCache(crmStatsKey(workspaceId, `${r}:funnel`));
  }
}

export type CrmActionResult = {
  ok: boolean;
  error?: string;
  dealId?: string;
  // Approval Workflows (docs/new-features/05 §3.7): set when the requested
  // stage move was intercepted and an ApprovalRequest was created instead.
  pendingApproval?: boolean;
  approvalRequestId?: string;
};

/** Notify workspace managers (STAFF_NOTIFICATION_EMAILS / _WHATSAPP) about a
 *  pending deal-approval request. The repo has no per-user in-app notification
 *  system — staff email/WhatsApp is the established channel (lib/notify.ts). */
async function notifyApprovers(input: {
  workspaceId: string;
  dealTitle: string;
  stageName: string;
  valuePaise: number;
  requestedByEmail: string;
  approvalRequestId: string;
}): Promise<void> {
  const value = `₹${(input.valuePaise / 100).toLocaleString("en-IN")}`;
  const subject = `[Vaani] Approval needed: ${input.dealTitle} → ${input.stageName} (${value})`;
  const text =
    `${input.requestedByEmail} requested moving "${input.dealTitle}" to "${input.stageName}" (${value}).\n` +
    `Approve or reject here: ${process.env.APP_URL ?? "https://app.vaani.ai"}/crm/approvals`;
  await sendStaffEmail(subject, text);
  await sendStaffWhatsApp("approval_requested", [input.dealTitle, input.stageName, value]);
}

const dealSchema = z.object({
  title: z.string().min(1).max(200),
  valuePaise: z.coerce.number().int().min(0),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  contactId: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  expectedClose: z.string().optional(),
  ownerUserId: z.string().optional(),
});

/** Create a deal (guide crm/02 §4). */
export async function createDealAction(input: z.infer<typeof dealSchema>): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:write");
  try {
    const data = dealSchema.parse(input);
    const deal = await db.deal.create({
      data: {
        workspaceId: ctx.workspaceId,
        pipelineId: data.pipelineId,
        stageId: data.stageId,
        title: data.title,
        valuePaise: data.valuePaise,
        priority: data.priority,
        contactId: data.contactId ?? null,
        ownerUserId: data.ownerUserId ?? null,
        expectedClose: data.expectedClose ? new Date(data.expectedClose) : null,
        source: "manual",
      },
    });
    await logCrmActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      dealId: deal.id,
      contactId: data.contactId ?? null,
      type: "DEAL_CREATED",
      title: `Deal created: ${deal.title}`,
      metadata: { valuePaise: deal.valuePaise, stageId: deal.stageId },
    });
    if (data.contactId) {
      await recomputeLeadScore(ctx.workspaceId, data.contactId).catch((e) => console.error("[crm] scoring failed", e));
    }
    await invalidateCrmAnalytics(ctx.workspaceId);
    revalidatePath("/crm/pipeline");
    revalidatePath("/crm/deals");
    return { ok: true, dealId: deal.id };
  } catch (e) {
    console.error("[crm] createDealAction failed", e);
    return { ok: false, error: "Could not create the deal. Check the fields." };
  }
}

/** Move a deal to another stage (Kanban drag + detail page). Derives status. */
export async function updateDealStageAction(dealId: string, stageId: string): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:write");
  try {
    const [deal, stage] = await Promise.all([
      db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } }),
      db.stage.findFirst({ where: { id: stageId, workspaceId: ctx.workspaceId } }),
    ]);
    if (!deal || !stage) return { ok: false, error: "Deal or stage not found." };
    if (deal.stageId === stage.id) return { ok: true, dealId };

    // Approval Workflows (docs/new-features/05 §3.7): a high-value deal moving
    // into an approval-required stage, by someone who can't self-approve, is
    // intercepted — the transition waits for a manager's approval.
    const workspace = await db.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { approvalThresholdPaise: true, approvalRequiredStages: true },
    });
    const needsApproval = requiresApproval({
      valuePaise: deal.valuePaise,
      thresholdPaise: workspace?.approvalThresholdPaise ?? null,
      approvalRequiredStages: workspace?.approvalRequiredStages ?? [],
      stageName: stage.name,
      canApprove: hasPermission(ctx.membership, "deals:approve"),
    });
    if (needsApproval) {
      const request = await db.approvalRequest.create({
        data: {
          workspaceId: ctx.workspaceId,
          dealId: deal.id,
          requestedByUserId: ctx.user.id,
          requestedStageId: stage.id,
          fromStageId: deal.stageId,
          valuePaise: deal.valuePaise,
        },
      });
      await logCrmActivity({
        workspaceId: ctx.workspaceId,
        userId: ctx.user.id,
        dealId: deal.id,
        contactId: deal.contactId,
        type: "APPROVAL_REQUESTED",
        title: `Approval requested → ${stage.name}`,
        description: `Deal worth ${formatINR(deal.valuePaise)} needs manager approval to move to "${stage.name}".`,
        metadata: { fromStageId: deal.stageId, toStageId: stage.id, valuePaise: deal.valuePaise, approvalRequestId: request.id },
      });
      await notifyApprovers({
        workspaceId: ctx.workspaceId,
        dealTitle: deal.title,
        stageName: stage.name,
        valuePaise: deal.valuePaise,
        requestedByEmail: ctx.user.email,
        approvalRequestId: request.id,
      });
      revalidatePath("/crm/pipeline");
      revalidatePath("/crm/deals");
      revalidatePath("/crm/approvals");
      revalidatePath(`/crm/deals/${deal.id}`);
      return { ok: true, pendingApproval: true, dealId: deal.id, approvalRequestId: request.id };
    }

    const status = stage.isWonStage ? "WON" : stage.isLostStage ? "LOST" : "OPEN";
    await db.deal.update({
      where: { id: deal.id },
      data: {
        stageId: stage.id,
        status,
        ...(status !== "OPEN"
          ? { closedAt: new Date(), closedReason: status === "WON" ? "Moved to Won" : "Moved to Lost" }
          : { closedAt: null, closedReason: null }),
      },
    });
    await logCrmActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      dealId: deal.id,
      contactId: deal.contactId,
      type: status === "WON" ? "DEAL_WON" : status === "LOST" ? "DEAL_LOST" : "STAGE_CHANGED",
      title: `Stage → ${stage.name}`,
      metadata: { fromStageId: deal.stageId, toStageId: stage.id },
    });
    if (deal.contactId) {
      await recomputeLeadScore(ctx.workspaceId, deal.contactId).catch((e) => console.error("[crm] scoring failed", e));
    }
    await invalidateCrmAnalytics(ctx.workspaceId);
    revalidatePath("/crm/pipeline");
    revalidatePath("/crm/deals");
    revalidatePath(`/crm/deals/${deal.id}`);
    return { ok: true, dealId: deal.id };
  } catch (e) {
    console.error("[crm] updateDealStageAction failed", e);
    return { ok: false, error: "Could not move the deal." };
  }
}

/** Update deal fields (edit form + detail header). */
export async function updateDealAction(dealId: string, input: Partial<z.infer<typeof dealSchema>>): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:write");
  try {
    const existing = await db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } });
    if (!existing) return { ok: false, error: "Deal not found." };
    const data = dealSchema.partial().parse(input);

    // If the stage changed, keep status in sync.
    let status = existing.status;
    let targetStage: { id: string; name: string; isWonStage: boolean; isLostStage: boolean } | null = null;
    if (data.stageId && data.stageId !== existing.stageId) {
      const stage = await db.stage.findFirst({ where: { id: data.stageId, workspaceId: ctx.workspaceId } });
      if (stage) {
        targetStage = stage;
        status = stage.isWonStage ? "WON" : stage.isLostStage ? "LOST" : "OPEN";
      }
    }

    // Approval Workflows (docs/new-features/05 §3.7): the edit form is a second
    // stage-transition path — a high-value deal moving into an approval-required
    // stage must not bypass approvals. Intercept BEFORE writing the stage change.
    if (targetStage) {
      const workspace = await db.workspace.findUnique({
        where: { id: ctx.workspaceId },
        select: { approvalThresholdPaise: true, approvalRequiredStages: true },
      });
      const effectiveValue = data.valuePaise ?? existing.valuePaise;
      const needsApproval = requiresApproval({
        valuePaise: effectiveValue,
        thresholdPaise: workspace?.approvalThresholdPaise ?? null,
        approvalRequiredStages: workspace?.approvalRequiredStages ?? [],
        stageName: targetStage.name,
        canApprove: hasPermission(ctx.membership, "deals:approve"),
      });
      if (needsApproval) {
        const request = await db.approvalRequest.create({
          data: {
            workspaceId: ctx.workspaceId,
            dealId: existing.id,
            requestedByUserId: ctx.user.id,
            requestedStageId: targetStage.id,
            fromStageId: existing.stageId,
            valuePaise: effectiveValue,
          },
        });
        await logCrmActivity({
          workspaceId: ctx.workspaceId,
          userId: ctx.user.id,
          dealId: existing.id,
          contactId: existing.contactId,
          type: "APPROVAL_REQUESTED",
          title: `Approval requested → ${targetStage.name}`,
          description: `Deal worth ${formatINR(effectiveValue)} needs manager approval to move to "${targetStage.name}".`,
          metadata: { fromStageId: existing.stageId, toStageId: targetStage.id, valuePaise: effectiveValue, approvalRequestId: request.id },
        });
        await notifyApprovers({
          workspaceId: ctx.workspaceId,
          dealTitle: existing.title,
          stageName: targetStage.name,
          valuePaise: effectiveValue,
          requestedByEmail: ctx.user.email,
          approvalRequestId: request.id,
        });
        revalidatePath("/crm/pipeline");
        revalidatePath("/crm/deals");
        revalidatePath("/crm/approvals");
        revalidatePath(`/crm/deals/${existing.id}`);
        return { ok: true, pendingApproval: true, dealId: existing.id, approvalRequestId: request.id };
      }
    }

    await db.deal.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.valuePaise !== undefined ? { valuePaise: data.valuePaise } : {}),
        ...(data.pipelineId !== undefined ? { pipelineId: data.pipelineId } : {}),
        ...(data.stageId !== undefined ? { stageId: data.stageId } : {}),
        ...(data.contactId !== undefined ? { contactId: data.contactId ?? null } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.ownerUserId !== undefined ? { ownerUserId: data.ownerUserId ?? null } : {}),
        ...(data.expectedClose !== undefined
          ? { expectedClose: data.expectedClose ? new Date(data.expectedClose) : null }
          : {}),
        ...(data.stageId && data.stageId !== existing.stageId ? { status } : {}),
      },
    });
    const scoringContactId = data.contactId ?? existing.contactId;
    if (scoringContactId) {
      await recomputeLeadScore(ctx.workspaceId, scoringContactId).catch((e) => console.error("[crm] scoring failed", e));
    }
    await invalidateCrmAnalytics(ctx.workspaceId);
    revalidatePath("/crm/pipeline");
    revalidatePath("/crm/deals");
    revalidatePath(`/crm/deals/${existing.id}`);
    return { ok: true, dealId: existing.id };
  } catch (e) {
    console.error("[crm] updateDealAction failed", e);
    return { ok: false, error: "Could not update the deal." };
  }
}

/** Delete a deal. */
export async function deleteDealAction(dealId: string): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:delete");
  try {
    const deal = await db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } });
    if (!deal) return { ok: false, error: "Deal not found." };
    await db.deal.delete({ where: { id: deal.id } });
    await logCrmActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      contactId: deal.contactId,
      type: "MANUAL",
      title: `Deal deleted: ${deal.title}`,
    });
    await invalidateCrmAnalytics(ctx.workspaceId);
    revalidatePath("/crm/pipeline");
    revalidatePath("/crm/deals");
    return { ok: true };
  } catch (e) {
    console.error("[crm] deleteDealAction failed", e);
    return { ok: false, error: "Could not delete the deal." };
  }
}

/** Add a note to a deal. */
export async function addDealNoteAction(dealId: string, body: string): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:write");
  try {
    const deal = await db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId }, select: { id: true, contactId: true } });
    if (!deal) return { ok: false, error: "Deal not found." };
    const note = await db.dealNote.create({ data: { dealId: deal.id, userId: ctx.user.id, body } });
    await logCrmActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      dealId: deal.id,
      contactId: deal.contactId,
      type: "NOTE_ADDED",
      title: "Note added",
      description: body.slice(0, 200),
      metadata: { noteId: note.id },
    });
    revalidatePath(`/crm/deals/${deal.id}`);
    return { ok: true };
  } catch (e) {
    console.error("[crm] addDealNoteAction failed", e);
    return { ok: false, error: "Could not add the note." };
  }
}

/** Complete (or reopen) a task. */
export async function updateTaskStatusAction(taskId: string, status: "DONE" | "PENDING"): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:write");
  try {
    const task = await db.task.findFirst({ where: { id: taskId, workspaceId: ctx.workspaceId } });
    if (!task) return { ok: false, error: "Task not found." };
    await db.task.update({
      where: { id: task.id },
      data: { status, completedAt: status === "DONE" ? new Date() : null },
    });
    if (status === "DONE" && task.dealId) {
      await logCrmActivity({
        workspaceId: ctx.workspaceId,
        userId: ctx.user.id,
        dealId: task.dealId,
        contactId: task.contactId,
        type: "TASK_COMPLETED",
        title: `Task completed: ${task.title}`,
      });
    }
    if (status === "DONE" && task.contactId) {
      await recomputeLeadScore(ctx.workspaceId, task.contactId).catch((e) => console.error("[crm] scoring failed", e));
    }
    revalidatePath("/crm/tasks");
    if (task.dealId) revalidatePath(`/crm/deals/${task.dealId}`);
    return { ok: true };
  } catch (e) {
    console.error("[crm] updateTaskStatusAction failed", e);
    return { ok: false, error: "Could not update the task." };
  }
}

/** Create a task (guide crm/03 §2.3). */
export async function createTaskAction(input: {
  title: string;
  description?: string;
  type: "CALL" | "SMS" | "WHATSAPP" | "EMAIL" | "MEETING" | "DOCUMENT" | "FOLLOW_UP" | "CUSTOM";
  dealId?: string;
  contactId?: string;
  assigneeId?: string;
  dueAt: string; // ISO
  reminderMin?: number;
}): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:write");
  try {
    const title = z.string().min(1).max(200).parse(input.title);
    const type = z.enum(["CALL", "SMS", "WHATSAPP", "EMAIL", "MEETING", "DOCUMENT", "FOLLOW_UP", "CUSTOM"]).parse(input.type);
    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) return { ok: false, error: "dueAt must be a valid ISO date." };

    // Deal and contact must belong to the workspace.
    if (input.dealId) {
      const deal = await db.deal.findFirst({ where: { id: input.dealId, workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!deal) return { ok: false, error: "Deal not found in this workspace." };
    }
    if (input.contactId) {
      const contact = await db.contact.findFirst({ where: { id: input.contactId, workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!contact) return { ok: false, error: "Contact not found in this workspace." };
    }

    const task = await db.task.create({
      data: {
        workspaceId: ctx.workspaceId,
        title,
        description: input.description ?? null,
        type,
        dealId: input.dealId ?? null,
        contactId: input.contactId ?? null,
        assigneeId: input.assigneeId ?? null,
        dueAt,
        reminderMin: Math.min(10080, Math.max(0, input.reminderMin ?? 30)),
      },
    });
    revalidatePath("/crm/tasks");
    return { ok: true, dealId: task.id };
  } catch (e) {
    console.error("[crm] createTaskAction failed", e);
    return { ok: false, error: "Could not create the task." };
  }
}

/** Delete a task. */
export async function deleteTaskAction(taskId: string): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:write");
  try {
    const task = await db.task.findFirst({ where: { id: taskId, workspaceId: ctx.workspaceId } });
    if (!task) return { ok: false, error: "Task not found." };
    await db.task.delete({ where: { id: task.id } });
    revalidatePath("/crm/tasks");
    return { ok: true };
  } catch (e) {
    console.error("[crm] deleteTaskAction failed", e);
    return { ok: false, error: "Could not delete the task." };
  }
}

/** Create a segment (rules JSON). */
export async function createSegmentAction(input: {
  name: string;
  description?: string;
  rules: { field: string; op: string; value: string | number | boolean | string[] }[];
  matchMode?: "all" | "any";
}): Promise<CrmActionResult> {
  const ctx = await requirePermission("segments:write");
  try {
    const name = z.string().min(2).max(120).parse(input.name);
    const matchMode = input.matchMode === "any" ? "any" : "all";
    const conditions = input.rules
      .filter((r) => r.field && String(r.value ?? "").trim() !== "")
      .map((r) => ({ field: r.field, op: r.op, value: r.value }));
    if (conditions.length === 0) return { ok: false, error: "Add at least one condition." };
    const segment = await db.segment.create({
      data: {
        workspaceId: ctx.workspaceId,
        name,
        description: input.description ?? null,
        // Store the normalized SegmentRules shape {matchMode, conditions}.
        rules: { matchMode, conditions } as object,
        matchMode,
        isDynamic: true,
      },
    });
    revalidatePath("/crm/segments");
    return { ok: true, dealId: segment.id };
  } catch (e) {
    console.error("[crm] createSegmentAction failed", e);
    return { ok: false, error: "Could not create the segment." };
  }
}

/** Delete a segment. */
export async function deleteSegmentAction(segmentId: string): Promise<CrmActionResult> {
  const ctx = await requirePermission("segments:delete");
  try {
    await db.segment.deleteMany({ where: { id: segmentId, workspaceId: ctx.workspaceId } });
    revalidatePath("/crm/segments");
    return { ok: true };
  } catch (e) {
    console.error("[crm] deleteSegmentAction failed", e);
    return { ok: false, error: "Could not delete the segment." };
  }
}

/** Save & Create Campaign (guide crm/04 §1.2): create a ContactList populated
 *  with the segment's matching contacts, and a DRAFT campaign on it. */
export async function createCampaignFromSegmentAction(input: {
  segmentId: string;
  campaignName: string;
}): Promise<CrmActionResult> {
  const ctx = await requirePermission("segments:write");
  try {
    const segment = await db.segment.findFirst({ where: { id: input.segmentId, workspaceId: ctx.workspaceId } });
    if (!segment) return { ok: false, error: "Segment not found." };

    const { evaluateSegment } = await import("@/lib/crm");
    const members = await evaluateSegment(ctx.workspaceId, segment);
    if (members.length === 0) return { ok: false, error: "Segment has no matching contacts." };

    const list = await db.contactList.create({
      data: { workspaceId: ctx.workspaceId, name: `${segment.name} (segment)` },
    });
    await db.contact.updateMany({
      where: { id: { in: members.map((m) => m.id) } },
      data: { listId: list.id },
    });

    const agent = await db.agent.findFirst({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "asc" } });
    if (!agent) return { ok: false, error: "Create an agent first — campaigns need one." };
    const campaign = await db.campaign.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.campaignName || `Campaign from ${segment.name}`,
        agentId: agent.id,
        listId: list.id,
        status: "DRAFT",
      },
    });
    revalidatePath("/crm/segments");
    revalidatePath("/campaigns");
    return { ok: true, dealId: campaign.id };
  } catch (e) {
    console.error("[crm] createCampaignFromSegmentAction failed", e);
    return { ok: false, error: "Could not create the campaign from segment." };
  }
}

/** Create a pipeline with its stages (ADMIN/OWNER). */
export async function createPipelineAction(input: {
  name: string;
  isDefault?: boolean;
  stages: { name: string; probability: number; color?: string }[];
}): Promise<CrmActionResult> {
  const ctx = await requirePermission("pipelines:write");
  try {
    const name = z.string().min(2).max(80).parse(input.name);
    if (input.stages.length < 1) return { ok: false, error: "Add at least one stage." };
    // Only one default pipeline per workspace.
    if (input.isDefault) {
      await db.pipeline.updateMany({ where: { workspaceId: ctx.workspaceId }, data: { isDefault: false } });
    }
    const pipeline = await db.pipeline.create({
      data: {
        workspaceId: ctx.workspaceId,
        name,
        isDefault: input.isDefault ?? false,
        stages: {
          create: input.stages.map((s, i) => ({
            workspaceId: ctx.workspaceId,
            name: s.name,
            order: i,
            probability: s.probability,
            color: s.color ?? null,
          })),
        },
      },
    });
    revalidatePath("/crm/pipeline");
    return { ok: true, dealId: pipeline.id };
  } catch (e) {
    console.error("[crm] createPipelineAction failed", e);
    return { ok: false, error: "Could not create the pipeline." };
  }
}

// ---------- Approval Workflows (docs/new-features/05 §3.7) ----------

/** Workspace-level approval settings (threshold in paise, required stage names).
 *  Threshold null disables approvals. settings:write gates the config UI. */
export async function updateApprovalSettingsAction(input: {
  thresholdPaise: number | null;
  approvalRequiredStages: string[];
}): Promise<CrmActionResult> {
  const ctx = await requirePermission("settings:write");
  try {
    const thresholdPaise =
      input.thresholdPaise == null || input.thresholdPaise <= 0 ? null : z.number().int().min(1).parse(input.thresholdPaise);
    const approvalRequiredStages = z
      .array(z.string().min(1).max(80))
      .max(50)
      .parse(input.approvalRequiredStages);
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { approvalThresholdPaise: thresholdPaise, approvalRequiredStages },
    });
    await db.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.user.id,
        action: "approvals.settings.updated",
        entity: "Workspace",
        entityId: ctx.workspaceId,
        metadata: { thresholdPaise, approvalRequiredStages },
      },
    });
    revalidatePath("/settings/crm");
    return { ok: true };
  } catch (e) {
    console.error("[crm] updateApprovalSettingsAction failed", e);
    return { ok: false, error: "Could not update approval settings." };
  }
}

/** Load a PENDING ApprovalRequest scoped to the workspace. */
async function findPendingApproval(approvalRequestId: string, workspaceId: string) {
  return db.approvalRequest.findFirst({
    where: { id: approvalRequestId, workspaceId, status: "PENDING" },
    include: { deal: true, requestedBy: { select: { email: true, fullName: true } } },
  });
}

/** Complete the stage transition after approval (same logic as updateDealStageAction). */
async function applyApprovedTransition(request: NonNullable<Awaited<ReturnType<typeof findPendingApproval>>>, ctx: { workspaceId: string; user: { id: string } }) {
  const stage = await db.stage.findFirst({
    where: { id: request.requestedStageId, workspaceId: ctx.workspaceId },
  });
  if (!stage) throw new Error("requested stage missing");
  const status = stage.isWonStage ? "WON" : stage.isLostStage ? "LOST" : "OPEN";
  await db.deal.update({
    where: { id: request.dealId },
    data: {
      stageId: stage.id,
      status,
      ...(status !== "OPEN"
        ? { closedAt: new Date(), closedReason: status === "WON" ? "Moved to Won" : "Moved to Lost" }
        : { closedAt: null, closedReason: null }),
    },
  });
  await logCrmActivity({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    dealId: request.dealId,
    contactId: request.deal.contactId,
    type: status === "WON" ? "DEAL_WON" : status === "LOST" ? "DEAL_LOST" : "STAGE_CHANGED",
    title: `Stage → ${stage.name}`,
    description: "Approved stage transition.",
    metadata: { fromStageId: request.fromStageId, toStageId: stage.id, approvalRequestId: request.id },
  });
  if (request.deal.contactId) {
    await recomputeLeadScore(ctx.workspaceId, request.deal.contactId).catch((e) => console.error("[crm] scoring failed", e));
  }
}

/** Manager approves a pending deal-stage transition (completes the move). */
export async function approveDealStageAction(approvalRequestId: string, note?: string): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:approve");
  try {
    const request = await findPendingApproval(approvalRequestId, ctx.workspaceId);
    if (!request) return { ok: false, error: "Approval request not found or already decided." };

    await db.approvalRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", approvedByUserId: ctx.user.id, decidedAt: new Date(), note: note ?? null },
    });
    await applyApprovedTransition(request, ctx);
    await logCrmActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      dealId: request.dealId,
      contactId: request.deal.contactId,
      type: "APPROVAL_RESOLVED",
      title: "Approval approved",
      description: `${ctx.user.email} approved the move${note ? `: ${note}` : ""}.`,
      metadata: { approvalRequestId: request.id, decision: "APPROVED" },
    });
    await invalidateCrmAnalytics(ctx.workspaceId);
    revalidatePath("/crm/pipeline");
    revalidatePath("/crm/deals");
    revalidatePath("/crm/approvals");
    revalidatePath(`/crm/deals/${request.dealId}`);
    return { ok: true, dealId: request.dealId };
  } catch (e) {
    console.error("[crm] approveDealStageAction failed", e);
    return { ok: false, error: "Could not approve the request." };
  }
}

/** Manager rejects a pending deal-stage transition (deal stays in fromStageId). */
export async function rejectDealStageAction(approvalRequestId: string, note?: string): Promise<CrmActionResult> {
  const ctx = await requirePermission("deals:approve");
  try {
    const request = await findPendingApproval(approvalRequestId, ctx.workspaceId);
    if (!request) return { ok: false, error: "Approval request not found or already decided." };

    await db.approvalRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", approvedByUserId: ctx.user.id, decidedAt: new Date(), note: note ?? null },
    });
    await logCrmActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      dealId: request.dealId,
      contactId: request.deal.contactId,
      type: "APPROVAL_REJECTED",
      title: "Approval rejected",
      description: `${ctx.user.email} rejected the move${note ? `: ${note}` : ""}.`,
      metadata: { approvalRequestId: request.id, decision: "REJECTED" },
    });
    revalidatePath("/crm/pipeline");
    revalidatePath("/crm/deals");
    revalidatePath("/crm/approvals");
    revalidatePath(`/crm/deals/${request.dealId}`);
    return { ok: true, dealId: request.dealId };
  } catch (e) {
    console.error("[crm] rejectDealStageAction failed", e);
    return { ok: false, error: "Could not reject the request." };
  }
}
