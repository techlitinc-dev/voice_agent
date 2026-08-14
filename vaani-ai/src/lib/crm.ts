/**
 * CRM data layer (guide crm/02): workspace-scoped fetch helpers, activity
 * logging, and forecast math shared by the pipeline board, deals list, deal
 * detail page and server actions. Every query is scoped by workspaceId.
 */
import { db } from "./db";
import type { ActivityType, Prisma } from "@prisma/client";

/** Log one Activity row (system/AI actor unless a userId is given). */
export async function logCrmActivity(input: {
  workspaceId: string;
  type: ActivityType;
  title: string;
  description?: string | null;
  dealId?: string | null;
  contactId?: string | null;
  callId?: string | null;
  userId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await db.activity.create({
      data: {
        workspaceId: input.workspaceId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        dealId: input.dealId ?? null,
        contactId: input.contactId ?? null,
        callId: input.callId ?? null,
        userId: input.userId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.error("[crm] activity log failed", e);
  }
}

/** Default pipeline for a workspace (isDefault first, then oldest). */
export async function findDefaultPipeline(workspaceId: string) {
  return db.pipeline.findFirst({
    where: { workspaceId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Approval Workflows (docs/new-features/05 §3.7): should moving a deal into
 * `stageName` require manager approval? Pure — easily unit-tested.
 *  - Approvals disabled when threshold is null.
 *  - The deal value must be >= threshold.
 *  - The target stage name must be in approvalRequiredStages.
 *  - The actor must NOT already hold deals:approve (managers approving their own
 *    moves is fine — they're the approver; a non-approver always needs one).
 */
export function requiresApproval(input: {
  valuePaise: number;
  thresholdPaise: number | null | undefined;
  approvalRequiredStages: string[];
  stageName: string;
  canApprove: boolean; // actor holds deals:approve
}): boolean {
  if (input.thresholdPaise == null) return false;
  if (input.valuePaise < input.thresholdPaise) return false;
  if (!input.approvalRequiredStages.includes(input.stageName)) return false;
  if (input.canApprove) return false;
  return true;
}

/** All pipelines with their stages, ordered. */
export async function listPipelines(workspaceId: string) {
  return db.pipeline.findMany({
    where: { workspaceId },
    include: { stages: { orderBy: { order: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

/** One pipeline with stages (or the default when id is omitted). */
export async function getPipeline(workspaceId: string, pipelineId?: string) {
  const id = pipelineId || (await findDefaultPipeline(workspaceId))?.id;
  if (!id) return null;
  return db.pipeline.findFirst({
    where: { id, workspaceId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
}

export type PipelineBoardDeal = Prisma.DealGetPayload<{
  include: {
    contact: {
      select: { id: true; name: true; phone: true };
      include: { leadScore: { select: { score: true; grade: true } } };
    };
    owner: { select: { id: true; fullName: true } };
    stage: { select: { id: true; name: true } };
  };
}>;

/** Deals grouped by stage for the Kanban board, with optional filters. */
export async function fetchPipelineBoard(
  workspaceId: string,
  pipelineId: string,
  filters: {
    owner?: string; // "me" | userId
    ownerUserId?: string;
    priority?: string[]; // low | medium | high | urgent
    interest?: string[]; // HOT | WARM | COLD (via Deal.attributes.interestScore)
    q?: string;
  } = {},
): Promise<{ stages: NonNullable<Awaited<ReturnType<typeof getPipeline>>>["stages"]; deals: PipelineBoardDeal[] }> {
  const pipeline = await getPipeline(workspaceId, pipelineId);
  if (!pipeline) return { stages: [], deals: [] };

  const where: Prisma.DealWhereInput = {
    workspaceId,
    pipelineId: pipeline.id,
    ...(filters.owner === "me"
      ? { ownerUserId: filters.ownerUserId ?? undefined }
      : filters.owner && filters.owner !== "anyone"
        ? { ownerUserId: filters.owner }
        : {}),
    ...(filters.priority?.length ? { priority: { in: filters.priority } } : {}),
    ...(filters.q ? { OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { contact: { name: { contains: filters.q, mode: "insensitive" } } }] } : {}),
  };

  const deals = await db.deal.findMany({
    where,
    include: {
      contact: {
        select: { id: true, name: true, phone: true },
        include: { leadScore: { select: { score: true, grade: true } } },
      },
      owner: { select: { id: true, fullName: true } },
      stage: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Interest filter applies to the cached attributes JSON.
  const filtered = filters.interest?.length
    ? deals.filter((d) => {
        const attrs = (d.attributes ?? {}) as Record<string, unknown>;
        return filters.interest!.includes(String(attrs.interestScore ?? ""));
      })
    : deals;

  return { stages: pipeline.stages, deals: filtered };
}

/** Deals list (table view) with filters + pagination. */
export async function fetchDeals(
  workspaceId: string,
  opts: {
    pipelineId?: string;
    stageId?: string;
    status?: string;
    owner?: string;
    ownerUserId?: string;
    q?: string;
    take?: number;
    skip?: number;
  } = {},
) {
  const where: Prisma.DealWhereInput = {
    workspaceId,
    ...(opts.pipelineId ? { pipelineId: opts.pipelineId } : {}),
    ...(opts.stageId ? { stageId: opts.stageId } : {}),
    ...(opts.status ? { status: opts.status as Prisma.EnumDealStatusFilter } : {}),
    ...(opts.owner === "me"
      ? { ownerUserId: opts.ownerUserId ?? undefined }
      : opts.owner && opts.owner !== "anyone"
        ? { ownerUserId: opts.owner }
        : {}),
    ...(opts.q ? { OR: [{ title: { contains: opts.q, mode: "insensitive" } }, { contact: { name: { contains: opts.q, mode: "insensitive" } } }] } : {}),
  };
  const [deals, total] = await Promise.all([
    db.deal.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        stage: { select: { id: true, name: true, color: true } },
        pipeline: { select: { id: true, name: true } },
        owner: { select: { id: true, fullName: true } },
        _count: { select: { activities: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
    }),
    db.deal.count({ where }),
  ]);
  return { deals, total };
}

/** One deal with everything the detail page needs. */
export async function getDealDetail(workspaceId: string, dealId: string) {
  return db.deal.findFirst({
    where: { id: dealId, workspaceId },
    include: {
      contact: true,
      stage: true,
      pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
      owner: { select: { id: true, fullName: true, email: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 50, include: { call: { select: { id: true, durationSec: true, direction: true } } } },
      notes: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, fullName: true } } } },
      tasks: { where: { status: { in: ["PENDING", "IN_PROGRESS"] } }, orderBy: { dueAt: "asc" } },
      calls: { orderBy: { startedAt: "desc" }, take: 10 },
    },
  });
}

/** Forecast rows + totals from stage probabilities (guide crm/02 §6). */
export function computeForecast(
  stages: { id: string; name: string; probability: number }[],
  dealsByStage: Record<string, PipelineBoardDeal[]>,
) {
  const rows = stages.map((stage) => {
    const deals = dealsByStage[stage.id] ?? [];
    const value = deals.reduce((sum, d) => sum + d.valuePaise, 0);
    return {
      stageId: stage.id,
      stage: stage.name,
      probability: stage.probability,
      value,
      weighted: Math.round((value * stage.probability) / 100),
    };
  });
  return {
    rows,
    totalPipeline: rows.reduce((s, r) => s + r.value, 0),
    totalWeighted: rows.reduce((s, r) => s + r.weighted, 0),
  };
}

/** Task list for the CRM tasks page. */
export async function fetchTasks(
  workspaceId: string,
  opts: { status?: string; assigneeId?: string; assigneeUserId?: string; q?: string; take?: number } = {},
) {
  const where: Prisma.TaskWhereInput = {
    workspaceId,
    ...(opts.status ? { status: opts.status as Prisma.EnumTaskStatusFilter } : {}),
    ...(opts.assigneeId === "me"
      ? { assigneeId: opts.assigneeUserId ?? undefined }
      : opts.assigneeId && opts.assigneeId !== "anyone"
        ? { assigneeId: opts.assigneeId }
        : {}),
    ...(opts.q ? { OR: [{ title: { contains: opts.q, mode: "insensitive" } }, { deal: { title: { contains: opts.q, mode: "insensitive" } } }] } : {}),
  };
  return db.task.findMany({
    where,
    include: {
      deal: { select: { id: true, title: true } },
      contact: { select: { id: true, name: true, phone: true } },
      assignee: { select: { id: true, fullName: true } },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: opts.take ?? 100,
  });
}

export type TaskWithRelations = Prisma.TaskGetPayload<{
  include: {
    deal: { select: { id: true; title: true } };
    contact: { select: { id: true; name: true; phone: true } };
    assignee: { select: { id: true; fullName: true } };
  };
}>;

/** Task buckets for the tasks page tabs (guide crm/03 §2.1): Today, Upcoming,
 *  Overdue, Completed. Non-completed tasks appear in exactly one bucket. */
export async function fetchTaskBuckets(
  workspaceId: string,
  opts: { assigneeId?: string; assigneeUserId?: string } = {},
): Promise<{ today: TaskWithRelations[]; upcoming: TaskWithRelations[]; overdue: TaskWithRelations[]; completed: TaskWithRelations[] }> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const all = await fetchTasks(workspaceId, {
    assigneeId: opts.assigneeId,
    assigneeUserId: opts.assigneeUserId,
    take: 500,
  });

  const buckets = { today: [] as TaskWithRelations[], upcoming: [] as TaskWithRelations[], overdue: [] as TaskWithRelations[], completed: [] as TaskWithRelations[] };
  for (const t of all) {
    if (t.status === "DONE" || t.status === "CANCELLED") {
      buckets.completed.push(t);
      continue;
    }
    if (t.dueAt < now) {
      buckets.overdue.push(t);
    } else if (t.dueAt >= startOfDay && t.dueAt < endOfDay) {
      buckets.today.push(t);
    } else {
      buckets.upcoming.push(t);
    }
  }
  const sortByDue = (a: TaskWithRelations, b: TaskWithRelations) => a.dueAt.getTime() - b.dueAt.getTime();
  buckets.today.sort(sortByDue);
  buckets.upcoming.sort(sortByDue);
  buckets.overdue.sort(sortByDue);
  buckets.completed.sort((a, b) => (b.completedAt ?? b.dueAt).getTime() - (a.completedAt ?? a.dueAt).getTime());
  return buckets;
}

/** Activities + calls for a contact's activity view (guide crm/03 §3). */
export async function getContactCrmData(workspaceId: string, phone: string) {
  const contact = await db.contact.findFirst({
    where: { workspaceId, phone },
    include: {
      leadScore: true,
      deals: { include: { stage: true }, orderBy: { updatedAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { fullName: true } } } },
      tasks: {
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
        orderBy: { dueAt: "asc" },
        include: {
          deal: { select: { id: true, title: true } },
          contact: { select: { id: true, name: true, phone: true } },
          assignee: { select: { id: true, fullName: true } },
        },
      },
      campaignContacts: { include: { campaign: true } },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });
  if (!contact) return null;

  const calls = await db.call.findMany({
    where: { workspaceId, OR: [{ fromNumber: phone }, { toNumber: phone }] },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return { contact, calls };
}

/** Segment list with member counts (from the cached memberCount). */
export async function fetchSegments(workspaceId: string) {
  return db.segment.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
}

// Segmentation + lead-scoring engines (guide crm/04) live in dedicated modules.
export {
  evaluateSegment,
  parseSegmentRules,
  translateCondition,
  SEGMENT_FIELDS,
  SEGMENT_OPERATORS,
  type SegmentRules,
  type Condition,
  type SegmentField,
  type Operator,
} from "./crm/segments";
export {
  recomputeLeadScore,
  recomputeAllLeadScores,
  gradeForScore,
  MAX_SCORE,
  type ScoreFactors,
} from "./crm/scoring";
