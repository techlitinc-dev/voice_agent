"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { canCreateReport } from "@/lib/reports/access";
import { logAudit } from "@/lib/audit";

const reportConfigSchema = z.object({
  source: z.enum(["calls", "campaigns", "deals", "cost", "contacts", "tasks", "activities"]),
  dateRange: z.object({
    preset: z.string(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["eq", "neq", "in", "gt", "lt", "between", "isnull"]),
        value: z.unknown().optional(),
      })
    )
    .default([]),
  groupBy: z.array(z.string()).default([]),
  sortBy: z
    .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
    .optional(),
  metrics: z
    .array(
      z.enum([
        "count", "avgDuration", "sumDuration", "sumBilled", "avgBilled",
        "connectRate", "hotCount", "warmCount", "coldCount",
        "sumCost", "margin", "marginPercent",
        "dealsCreated", "dealsWon", "sumValue", "revenue",
      ])
    )
    .default(["count"]),
  chart: z.object({
    type: z.enum(["table", "bar", "line", "pie", "area", "funnel", "heatmap"]),
    xAxis: z.string().optional(),
    yAxis: z.string().optional(),
  }),
  limit: z.number().int().min(1).max(10000).optional(),
  title: z.string().optional(),
});

const saveReportSchema = z.object({
  name: z.string().min(1).max(120),
  visibility: z.enum(["shared", "private"]).default("shared"),
  config: reportConfigSchema,
});

const scheduleSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  recipients: z
    .string()
    .min(3)
    .transform((s) => s.split(",").map((e) => e.trim()).filter(Boolean))
    .pipe(z.array(z.string().email()).min(1)),
});

function actionError(label: string, e: unknown, fallback: string) {
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false as const, error: "Forbidden — only ADMIN/OWNER can manage reports" };
  }
  console.error(label, e);
  return { ok: false as const, error: fallback };
}

/** Save a report (create). Only ADMIN/OWNER. */
export async function saveReport(input: { name: string; visibility: "shared" | "private"; config: unknown }) {
  try {
    const ctx = await requireWorkspace();
    if (!canCreateReport(ctx.membership.role)) {
      return { ok: false as const, error: "Only ADMIN/OWNER can create reports" };
    }
    const parsed = saveReportSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

    const report = await db.savedReport.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        reportType: parsed.data.config.source,
        config: parsed.data.config as object,
        visibility: parsed.data.visibility,
        createdByUserId: ctx.user.id,
      },
    });
    await logAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      action: "report.created",
      entity: "SavedReport",
      entityId: report.id,
      metadata: { name: report.name, source: parsed.data.config.source },
    });
    revalidatePath("/reports");
    return { ok: true as const, id: report.id };
  } catch (e) {
    return actionError("saveReport", e, "Could not save report");
  }
}

/** Delete a report. Only ADMIN/OWNER (or the creator). */
export async function deleteReport(id: string) {
  try {
    const ctx = await requireWorkspace();
    const report = await db.savedReport.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!report) return { ok: false as const, error: "Not found" };
    const canDelete = canCreateReport(ctx.membership.role) || report.createdByUserId === ctx.user.id;
    if (!canDelete) return { ok: false as const, error: "Only ADMIN/OWNER (or the creator) can delete reports" };
    await db.savedReport.delete({ where: { id } });
    await logAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      action: "report.deleted",
      entity: "SavedReport",
      entityId: id,
      metadata: { name: report.name },
    });
    revalidatePath("/reports");
    return { ok: true as const };
  } catch (e) {
    return actionError("deleteReport", e, "Could not delete report");
  }
}

/** Schedule a saved report as a digest. Only ADMIN/OWNER. */
export async function scheduleReport(input: { reportId: string; frequency: "DAILY" | "WEEKLY" | "MONTHLY"; recipients: string }) {
  try {
    const ctx = await requireWorkspace();
    if (!canCreateReport(ctx.membership.role)) {
      return { ok: false as const, error: "Only ADMIN/OWNER can schedule reports" };
    }
    const report = await db.savedReport.findFirst({ where: { id: input.reportId, workspaceId: ctx.workspaceId } });
    if (!report) return { ok: false as const, error: "Report not found" };

    const parsed = scheduleSchema.safeParse({ frequency: input.frequency, recipients: input.recipients });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

    await db.scheduledDigest.create({
      data: {
        workspaceId: ctx.workspaceId,
        reportId: report.id,
        frequency: parsed.data.frequency,
        recipients: parsed.data.recipients,
      },
    });
    await logAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      action: "report.scheduled",
      entity: "SavedReport",
      entityId: report.id,
      metadata: { frequency: parsed.data.frequency, recipients: parsed.data.recipients },
    });
    revalidatePath("/reports");
    return { ok: true as const };
  } catch (e) {
    return actionError("scheduleReport", e, "Could not schedule report");
  }
}
