/**
 * node-cron schedules owned by guide 08. Registered once from the worker's main().
 * - Digests: DIGEST_CRON (default "5 * * * *" — hourly at :05; sendDueDigests
 *   decides per-digest whether it is due).
 * - Retention: RETENTION_CRON (default "30 3 * * *" — nightly 03:30 server time).
 * - Task reminders: TASK_REMINDER_CRON (default every 15 minutes — guide crm/03
 *   §2.4 — notifies assignees of tasks due within their reminderMin).
 * Invalid expressions fall back to the defaults (logged), never crash the worker.
 */
import cron from "node-cron";
import { db } from "../lib/db";
import { sendDueDigests } from "./digest";
import { enforceRetention } from "./retention";
import { sendStaffEmail } from "../lib/notify";
import { evaluateSegment } from "../lib/crm/segments";
import { recomputeAllLeadScores } from "../lib/crm/scoring";

const DIGEST_CRON = process.env.DIGEST_CRON ?? "5 * * * *";
const RETENTION_CRON = process.env.RETENTION_CRON ?? "30 3 * * *";
const TASK_REMINDER_CRON = process.env.TASK_REMINDER_CRON ?? "*/15 * * * *";
const SEGMENT_REFRESH_CRON = process.env.SEGMENT_REFRESH_CRON ?? "*/15 * * * *";
const LEAD_SCORE_CRON = process.env.LEAD_SCORE_CRON ?? "30 2 * * *";

/** Remind assignees of tasks due within their reminder window (guide crm/03 §2.4).
 *  Each PENDING task is notified exactly once (remindedAt guard). Notifications go
 *  to staff email (SMTP) — no per-user inbox exists yet. Never throws. */
export async function sendTaskReminders(): Promise<number> {
  const now = new Date();
  const tasks = await db.task.findMany({
    where: {
      status: "PENDING",
      dueAt: { gte: now },
      remindedAt: null,
      assigneeId: { not: null },
    },
    include: {
      assignee: { select: { email: true, fullName: true } },
      deal: { select: { title: true } },
    },
    take: 100,
  });

  let sent = 0;
  for (const task of tasks) {
    const reminderTime = new Date(task.dueAt.getTime() - task.reminderMin * 60 * 1000);
    if (reminderTime > now) continue; // not yet within the reminder window
    const due = task.dueAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    await sendStaffEmail(
      `[Vaani] Task due soon: ${task.title}`,
      `Hi ${task.assignee?.fullName ?? "there"},\n\nTask: ${task.title}\nDue: ${due}${task.deal ? `\nDeal: ${task.deal.title}` : ""}\n\nView: ${process.env.APP_URL ?? "http://localhost:3000"}/crm/tasks`,
    );
    await db.task.update({ where: { id: task.id }, data: { remindedAt: now } });
    sent += 1;
  }
  return sent;
}

/** Re-evaluate dynamic segments and cache memberCount (guide crm/04 §1.6). */
export async function refreshSegments(): Promise<number> {
  const segments = await db.segment.findMany({ where: { isDynamic: true }, select: { id: true, workspaceId: true, rules: true, matchMode: true } });
  let updated = 0;
  for (const segment of segments) {
    try {
      const members = await evaluateSegment(segment.workspaceId, segment);
      await db.segment.update({
        where: { id: segment.id },
        data: { memberCount: members.length, lastEvalAt: new Date() },
      });
      updated += 1;
    } catch (e) {
      console.error(`[cron] segment refresh failed for ${segment.id}`, e);
    }
  }
  return updated;
}

/** Nightly: recompute lead scores for contacts touched in the last 7 days
 *  (guide crm/04 §2.4 — periodic recompute). */
export async function nightlyLeadScoreSweep(): Promise<number> {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  let total = 0;
  for (const ws of workspaces) {
    try {
      total += await recomputeAllLeadScores(ws.id, 7);
    } catch (e) {
      console.error(`[cron] lead-score sweep failed for workspace ${ws.id}`, e);
    }
  }
  return total;
}

export function startCronJobs(): void {
  const digestExpr = cron.validate(DIGEST_CRON) ? DIGEST_CRON : "5 * * * *";
  const retentionExpr = cron.validate(RETENTION_CRON) ? RETENTION_CRON : "30 3 * * *";
  const reminderExpr = cron.validate(TASK_REMINDER_CRON) ? TASK_REMINDER_CRON : "*/15 * * * *";
  const segmentExpr = cron.validate(SEGMENT_REFRESH_CRON) ? SEGMENT_REFRESH_CRON : "*/15 * * * *";
  const scoreExpr = cron.validate(LEAD_SCORE_CRON) ? LEAD_SCORE_CRON : "30 2 * * *";
  if (digestExpr !== DIGEST_CRON) console.error(`[cron] invalid DIGEST_CRON "${DIGEST_CRON}" — using "5 * * * *"`);
  if (retentionExpr !== RETENTION_CRON) console.error(`[cron] invalid RETENTION_CRON "${RETENTION_CRON}" — using "30 3 * * *"`);
  if (reminderExpr !== TASK_REMINDER_CRON) console.error(`[cron] invalid TASK_REMINDER_CRON "${TASK_REMINDER_CRON}" — using "*/15 * * * *"`);
  if (segmentExpr !== SEGMENT_REFRESH_CRON) console.error(`[cron] invalid SEGMENT_REFRESH_CRON "${SEGMENT_REFRESH_CRON}" — using "*/15 * * * *"`);
  if (scoreExpr !== LEAD_SCORE_CRON) console.error(`[cron] invalid LEAD_SCORE_CRON "${LEAD_SCORE_CRON}" — using "30 2 * * *"`);

  cron.schedule(digestExpr, () => {
    sendDueDigests().catch((e) => console.error("[cron] digest error", e));
  });
  cron.schedule(retentionExpr, () => {
    enforceRetention().catch((e) => console.error("[cron] retention error", e));
  });
  cron.schedule(reminderExpr, () => {
    sendTaskReminders().catch((e) => console.error("[cron] task-reminder error", e));
  });
  cron.schedule(segmentExpr, () => {
    refreshSegments().catch((e) => console.error("[cron] segment-refresh error", e));
  });
  cron.schedule(scoreExpr, () => {
    nightlyLeadScoreSweep().catch((e) => console.error("[cron] lead-score error", e));
  });
  console.log(new Date().toISOString(), `[cron] schedules registered: digests "${digestExpr}", retention "${retentionExpr}", task-reminders "${reminderExpr}", segments "${segmentExpr}", lead-scores "${scoreExpr}"`);
}
