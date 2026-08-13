import { requirePermission } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import {
  getCrmStats, getDateRange, getFunnel, getRevenueTimeSeries, getRevenueBySource,
  getRepPerformance, getStageAging, getCohorts, getVoiceAttribution, getForecast,
} from "@/lib/crm/queries";

export const dynamic = "force-dynamic";

/** Streaming CSV export of CRM analytics (guide crm/05 §8). Tenant-scoped,
 *  deals:read-gated. Follows the /api/exports pattern. */
export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requirePermission("deals:read");
  } catch (e) {
    const forbidden = e instanceof Error && e.message === "FORBIDDEN";
    return new Response(forbidden ? "forbidden" : "unauthorized", { status: forbidden ? 403 : 401 });
  }
  const url = new URL(req.url);
  const range = getDateRange(url.searchParams.get("range") ?? undefined);
  const rangeKey = url.searchParams.get("range") ?? "30d";

  const [stats, funnel, revenue, bySource, reps, aging, cohorts, voice, forecast] = await Promise.all([
    getCrmStats(ctx.workspaceId, range),
    getFunnel(ctx.workspaceId),
    getRevenueTimeSeries(ctx.workspaceId, range),
    getRevenueBySource(ctx.workspaceId, range),
    getRepPerformance(ctx.workspaceId, range),
    getStageAging(ctx.workspaceId),
    getCohorts(ctx.workspaceId),
    getVoiceAttribution(ctx.workspaceId, range),
    getForecast(ctx.workspaceId),
  ]);

  const csv = [
    toCsv(["section", "metric", "value"], [
      ["kpis", "open_pipeline_value", String(stats.openPipelineValue)],
      ["kpis", "open_deal_count", String(stats.openDealCount)],
      ["kpis", "won_value", String(stats.wonValue)],
      ["kpis", "won_count", String(stats.wonCount)],
      ["kpis", "win_rate_pct", String(stats.winRate)],
      ["kpis", "avg_deal_size", String(stats.avgDealSize)],
      ["forecast", "this_month_weighted", String(forecast.thisMonth)],
      ["forecast", "next_month_weighted", String(forecast.nextMonthWeighted)],
    ]),
    "\r\n",
    toCsv(["section", "stage", "deals", "value_paise"], funnel.map((f) => ["funnel", f.name, String(f.dealCount), String(f.valuePaise)])),
    "\r\n",
    toCsv(["section", "date", "value_paise", "count"], revenue.map((r) => ["revenue", r.date, String(r.valuePaise), String(r.count)])),
    "\r\n",
    toCsv(["section", "source", "deals", "revenue_paise", "avg_size_paise"], bySource.map((s) => ["source", s.source, String(s.deals), String(s.revenue), String(s.avgSize)])),
    "\r\n",
    toCsv(["section", "rep", "deals_won", "revenue_paise", "win_rate_pct", "open_deals"], reps.map((r) => ["rep", r.name, String(r.dealsWon), String(r.revenue), String(r.winRate), String(r.openDeals)])),
    "\r\n",
    toCsv(["section", "deal", "stage", "days_in_stage", "alert", "owner"], aging.map((a) => ["aging", a.title, a.stage, String(a.daysInStage), a.alert, a.owner ?? ""])),
    "\r\n",
    toCsv(["section", "month", "count", "avg_to_contacted_d", "avg_to_won_d", "win_rate_pct"], cohorts.map((c) => ["cohort", c.month, String(c.count), c.avgToContacted !== null ? String(c.avgToContacted) : "", c.avgToWon !== null ? String(c.avgToWon) : "", String(c.winRate)])),
    "\r\n",
    toCsv(["section", "metric", "value"], [
      ["voice", "total_calls", String(voice.totalCalls)],
      ["voice", "calls_that_created_deal", String(voice.callsThatCreatedDeal)],
      ["voice", "calls_that_moved_stage", String(voice.callsThatMovedStage)],
      ["voice", "revenue_from_calls_paise", String(voice.revenueFromCalls)],
      ["voice", "total_won_revenue_paise", String(voice.totalWonRevenue)],
    ]),
  ].join("");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaani-crm-analytics-${rangeKey}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
