/**
 * Contact cohort retention + time-to-conversion queries
 * (docs/analytics/02 §3, §4). DB-touching, workspace-scoped.
 *
 * Cohort assignment uses the app's real call→contact link:
 * Call.campaignId → CampaignContact.contactId. Contacts whose first campaign
 * call fell in month M form cohort M; we then count how many of them had
 * another call within 7/14/28/56 days of that first call (retention buckets).
 */
import { db } from "../db";
import { type CohortRow, computeTimeToConversion, retentionBucket, type TimeToConversion, type DateRange } from "../analytics";

const RETENTION_KEYS = ["week0", "week1", "week2", "week4", "week8"] as const;

/** Contact cohort retention matrix (guide 02 §3). Newest cohort first. */
export async function getContactCohorts(workspaceId: string, months = 6): Promise<CohortRow[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months + 1);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  // All campaign calls in the window.
  const calls = await db.call.findMany({
    where: { workspaceId, campaignId: { not: null }, startedAt: { gte: since } },
    select: { id: true, campaignId: true, startedAt: true },
  });

  // Map campaignId → contactIds (CampaignContact join rows).
  const campaignIds = [...new Set(calls.map((c) => c.campaignId).filter(Boolean) as string[])];
  const cc = await db.campaignContact.findMany({
    where: { campaignId: { in: campaignIds } },
    select: { campaignId: true, contactId: true },
  });
  const contactsByCampaign = new Map<string, string[]>();
  for (const row of cc) {
    const list = contactsByCampaign.get(row.campaignId) ?? [];
    list.push(row.contactId);
    contactsByCampaign.set(row.campaignId, list);
  }

  // First call per contact (across campaigns).
  const firstByContact = new Map<string, Date>();
  // contactId → all subsequent call timestamps (after their first call).
  const laterCallsByContact = new Map<string, Date[]>();
  for (const c of calls) {
    if (!c.campaignId) continue;
    for (const contactId of contactsByCampaign.get(c.campaignId) ?? []) {
      const first = firstByContact.get(contactId);
      if (!first || c.startedAt < first) {
        firstByContact.set(contactId, c.startedAt);
      }
    }
  }
  for (const c of calls) {
    if (!c.campaignId) continue;
    for (const contactId of contactsByCampaign.get(c.campaignId) ?? []) {
      const first = firstByContact.get(contactId);
      if (!first || c.startedAt <= first) continue;
      const list = laterCallsByContact.get(contactId) ?? [];
      list.push(c.startedAt);
      laterCallsByContact.set(contactId, list);
    }
  }

  // Aggregate into month cohorts.
  const byMonth = new Map<string, Map<string, Set<string>>>();
  for (const [contactId, firstAt] of firstByContact) {
    if (firstAt < since) continue;
    const key = `${firstAt.getFullYear()}-${String(firstAt.getMonth() + 1).padStart(2, "0")}`;
    let month = byMonth.get(key);
    if (!month) {
      month = new Map<string, Set<string>>();
      for (const wk of RETENTION_KEYS) month.set(wk, new Set<string>());
      byMonth.set(key, month);
    }
    month.get("week0")!.add(contactId); // every cohort member is retained in week 0
    for (const later of laterCallsByContact.get(contactId) ?? []) {
      const bucket = retentionBucket(later.getTime() - firstAt.getTime());
      if (bucket) month.get(bucket)!.add(contactId);
    }
  }

  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0])) // newest cohort first
    .map(([cohortMonth, m]) => ({
      cohortMonth,
      cohortSize: m.get("week0")!.size,
      week0: m.get("week0")!.size,
      week1: m.get("week1")!.size,
      week2: m.get("week2")!.size,
      week4: m.get("week4")!.size,
      week8: m.get("week8")!.size,
    }))
    .filter((r) => r.cohortSize > 0);
}

/** Days from first call → deal won (guide 02 §4). Uses Deal.createdFromCall. */
export async function getTimeToConversion(workspaceId: string, range: DateRange): Promise<TimeToConversion> {
  const deals = await db.deal.findMany({
    where: { workspaceId, status: "WON", closedAt: { gte: range.start, lte: range.end } },
    select: { closedAt: true, createdFromCall: { select: { startedAt: true } } },
  });

  const daysToClose: number[] = [];
  for (const d of deals) {
    if (!d.closedAt || !d.createdFromCall) continue;
    const days = Math.floor((d.closedAt.getTime() - d.createdFromCall.startedAt.getTime()) / 86400000);
    if (days >= 0) daysToClose.push(days);
  }
  return computeTimeToConversion(daysToClose);
}
