/** Scheduled digest sender — invoked hourly by node-cron (registered in Step 21's cron file). */
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import {
  buildDigestText,
  isDigestDue,
  frequencyWindowMs,
  type DigestFrequency,
  type DigestStats,
} from "../lib/digest";
import { computeAht, computeAsr, sumBilledPaise, sumWholesalePaise } from "../lib/analytics";
import { executeReport } from "../lib/reports/executor";
import { renderReportSummary } from "../lib/reports/export";
import type { ReportConfig } from "../lib/reports/types";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function sendMail(to: string[], subject: string, text: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    log(`[digest] SMTP_HOST unset — would send "${subject}" to ${to.join(", ")}`);
    return true; // counts as sent in dev so digests don't re-fire every hour
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "Vaani AI <no-reply@vaani.ai>",
    to: to.join(", "),
    subject,
    text,
  });
  return true;
}

/** Execute a report-scoped digest: run the saved report and email its summary. */
async function sendReportDigest(digest: { id: string; workspaceId: string; reportId: string; recipients: string[]; frequency: DigestFrequency }, _workspaceName: string): Promise<boolean> {
  const report = await db.savedReport.findFirst({ where: { id: digest.reportId, workspaceId: digest.workspaceId } });
  if (!report) {
    log(`[digest] report ${digest.reportId} not found for digest ${digest.id}`);
    return false;
  }
  const result = await executeReport(digest.workspaceId, (report.config ?? {}) as unknown as ReportConfig);
  const summary = renderReportSummary(result);
  const subject = `Vaani Report: ${report.name} — ${new Date().toLocaleDateString("en-IN")}`;
  await sendMail(digest.recipients, subject, summary);
  return true;
}

export async function sendDueDigests(): Promise<number> {
  const now = new Date();
  const digests = await db.scheduledDigest.findMany({
    where: { active: true },
    include: { workspace: { select: { name: true } } },
  });

  let sent = 0;
  for (const d of digests) {
    const freq = d.frequency as DigestFrequency;
    if (!isDigestDue(freq, d.lastSentAt, now) || d.recipients.length === 0) continue;
    try {
      if (d.reportId) {
        await sendReportDigest(
          { id: d.id, workspaceId: d.workspaceId, reportId: d.reportId, recipients: d.recipients, frequency: freq },
          d.workspace.name
        );
        await db.scheduledDigest.update({ where: { id: d.id }, data: { lastSentAt: now } });
        sent += 1;
        log(`[digest] sent report digest ${d.id} (report ${d.reportId}) to ${d.recipients.length} recipient(s)`);
        continue;
      }

      const since = new Date(now.getTime() - frequencyWindowMs(freq));
      const calls = await db.call.findMany({
        where: { workspaceId: d.workspaceId, createdAt: { gte: since } },
        select: {
          createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
          fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
          costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
          hallucinationFlag: true,
        },
      });
      const outcomes = new Map<string, number>();
      for (const c of calls) if (c.outcome) outcomes.set(c.outcome, (outcomes.get(c.outcome) ?? 0) + 1);
      const stats: DigestStats = {
        periodLabel: freq === "DAILY" ? "last 24 hours" : freq === "WEEKLY" ? "last 7 days" : "last 30 days",
        calls: calls.length,
        asrPercent: computeAsr(calls),
        ahtSeconds: computeAht(calls),
        billedPaise: sumBilledPaise(calls),
        wholesalePaise: sumWholesalePaise(calls),
        topOutcomes: [...outcomes.entries()]
          .map(([outcome, count]) => ({ outcome, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
        hallucinations: calls.filter((c) => c.hallucinationFlag).length,
      };
      const subject = `Vaani AI ${freq.toLowerCase()} digest — ${d.workspace.name}`;
      await sendMail(d.recipients, subject, buildDigestText(d.workspace.name, freq, stats));
      await db.scheduledDigest.update({ where: { id: d.id }, data: { lastSentAt: now } });
      sent += 1;
      log(`[digest] sent ${freq} digest for workspace ${d.workspaceId} to ${d.recipients.length} recipient(s)`);
    } catch (e) {
      console.error(`[digest] failed for digest ${d.id}`, e);
    }
  }
  return sent;
}
