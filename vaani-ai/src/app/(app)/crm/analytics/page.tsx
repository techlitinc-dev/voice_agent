import { redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { cache, crmStatsKey } from "@/lib/cache";
import { formatINR } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getCrmStats, getDateRange, getFunnel, getRevenueTimeSeries, getRevenueBySource,
  getRepPerformance, getStageAging, getCohorts, getVoiceAttribution, getForecast,
} from "@/lib/crm/queries";
import {
  FunnelChart, RevenueOverTime, RevenueBySource, RepLeaderboard, StageAgingTable, CohortTable, ForecastCards,
} from "./charts";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "CRM Analytics — Vaani AI" };

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default async function CrmAnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string; by?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const range = getDateRange(searchParams.range);
  const rangeKey = searchParams.range ?? "30d";
  const by = searchParams.by === "week" ? "week" : "day";

  // Cache KPIs + funnel (60s TTL); heavier views computed directly.
  const [stats, funnel] = await Promise.all([
    cache(crmStatsKey(ctx.workspaceId, rangeKey), 60, () => getCrmStats(ctx.workspaceId, range)),
    cache(crmStatsKey(ctx.workspaceId, `${rangeKey}:funnel`), 60, () => getFunnel(ctx.workspaceId)),
  ]);
  const [revenue, bySource, reps, aging, cohorts, voice, forecast] = await Promise.all([
    getRevenueTimeSeries(ctx.workspaceId, range, by),
    getRevenueBySource(ctx.workspaceId, range),
    getRepPerformance(ctx.workspaceId, range),
    getStageAging(ctx.workspaceId),
    getCohorts(ctx.workspaceId),
    getVoiceAttribution(ctx.workspaceId, range),
    getForecast(ctx.workspaceId),
  ]);

  const daysLabel = rangeKey === "90d" ? "90 days" : rangeKey === "12m" ? "12 months" : "30 days";
  const rangeLabel = searchParams.range === "90d" ? "90d" : searchParams.range === "12m" ? "12m" : "30d";

  return (
    <div className="space-y-6" data-testid="crm-analytics-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">CRM analytics — last {daysLabel}</h2>
        <div className="flex items-center gap-2">
          <form className="flex items-center gap-2">
            <select name="range" defaultValue={searchParams.range ?? "30d"} className="h-9 rounded-md border border-border bg-background px-3 text-sm">
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="12m">Last 12 months</option>
            </select>
            <Button type="submit" variant="outline" size="sm">Apply</Button>
          </form>
          <Link href={`/api/exports/crm-analytics.csv?range=${rangeLabel}`}>
            <Button variant="outline" size="sm" data-testid="export-csv"><Download className="h-4 w-4" /> Export CSV</Button>
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open pipeline" value={formatINR(stats.openPipelineValue)} sub={`${stats.openDealCount} deals`} />
        <StatCard label={`Won (${rangeLabel})`} value={formatINR(stats.wonValue)} sub={`${stats.wonCount} deals`} />
        <StatCard label="Win rate" value={`${stats.winRate}%`} sub={`${stats.createdDeals} created in period`} />
        <StatCard label="Avg deal size" value={formatINR(stats.avgDealSize)} sub="closed-won" />
      </div>

      {/* Funnel + revenue */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Pipeline funnel</CardTitle></CardHeader>
          <CardContent><FunnelChart stages={funnel} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Won revenue over time</CardTitle>
            <Link href={`/crm/analytics?range=${rangeLabel}&by=${by === "week" ? "day" : "week"}`} className="text-xs text-primary hover:underline">
              {by === "day" ? "View weekly" : "View daily"}
            </Link>
          </CardHeader>
          <CardContent><RevenueOverTime data={revenue} /></CardContent>
        </Card>
      </div>

      {/* Source + rep leaderboard */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Won revenue by source</CardTitle></CardHeader>
          <CardContent><RevenueBySource data={bySource} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Sales rep leaderboard</CardTitle></CardHeader>
          <CardContent><RepLeaderboard reps={reps} /></CardContent>
        </Card>
      </div>

      {/* Forecast */}
      <ForecastCards thisMonth={forecast.thisMonth} nextMonthWeighted={forecast.nextMonthWeighted} />

      {/* Voice attribution */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Voice-to-pipeline attribution</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Calls that created a deal</p>
              <p className="text-lg font-bold">{voice.callsThatCreatedDeal} / {voice.totalCalls} ({voice.dealCreateRate}%)</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Calls that moved a stage</p>
              <p className="text-lg font-bold">{voice.callsThatMovedStage} / {voice.totalCalls} ({voice.stageMoveRate}%)</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Revenue from AI calls</p>
              <p className="text-lg font-bold">{formatINR(voice.revenueFromCalls)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total won in period</p>
              <p className="text-lg font-bold">{formatINR(voice.totalWonRevenue)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stage aging + cohorts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Stage aging (stale deals)</CardTitle></CardHeader>
          <CardContent><StageAgingTable rows={aging} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Cohort velocity (by creation month)</CardTitle></CardHeader>
          <CardContent><CohortTable rows={cohorts} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
