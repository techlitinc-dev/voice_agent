import { redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { getDateRange } from "@/lib/analytics";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import {
  getCallToDealFunnel,
  getCampaignFunnels,
  getAgentFunnels,
  biggestDropoffInsight,
} from "@/lib/analytics/funnel";
import { getContactCohorts, getTimeToConversion } from "@/lib/analytics/cohorts";
import {
  CallToDealFunnel,
  DropoffInsights,
  CohortHeatmap,
  TimeToConversionChart,
  CampaignFunnelTable,
  AgentFunnelTable,
} from "@/components/analytics/funnel-cohort-charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funnel & Cohorts — Vaani AI" };

export default async function FunnelAnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const range = getDateRange(searchParams.range ?? "30d");
  const rangeKey = searchParams.range ?? "30d";

  const [funnel, cohorts, ttc, campaigns, agents] = await Promise.all([
    getCallToDealFunnel(ctx.workspaceId, range),
    getContactCohorts(ctx.workspaceId),
    getTimeToConversion(ctx.workspaceId, range),
    getCampaignFunnels(ctx.workspaceId, range),
    getAgentFunnels(ctx.workspaceId, range),
  ]);
  const insight = biggestDropoffInsight(funnel);

  const callsMade = funnel[0]?.count ?? 0;
  const won = funnel[funnel.length - 1]?.count ?? 0;
  const overallWinRate = callsMade > 0 ? Math.round((won / callsMade) * 1000) / 10 : 0;
  const wonValue = funnel[funnel.length - 1]?.valuePaise ?? 0;

  return (
    <div className="space-y-6" data-testid="funnel-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Funnel & cohort analysis</h1>
          <p className="text-sm text-muted-foreground">Where revenue leaks: call → lead → deal → won.</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker current={rangeKey} />
          <Link href="/analytics" className="text-sm text-primary hover:underline" data-testid="nav-back-analytics">← Analytics</Link>
        </div>
      </div>

      {/* Call-to-deal funnel + drop-off */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Call-to-deal funnel</CardTitle></CardHeader>
          <CardContent><CallToDealFunnel stages={funnel} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Biggest drop-off</CardTitle></CardHeader>
          <CardContent><DropoffInsights insight={insight} /></CardContent>
        </Card>
      </div>

      {/* Overall */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Overall call-to-win</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-primary">{overallWinRate}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Won revenue (range)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{formatINR(wonValue)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Deals won</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{won.toLocaleString()}</CardContent>
        </Card>
      </div>

      {/* Cohort retention */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Contact cohort retention</CardTitle>
          <p className="text-xs text-muted-foreground">
            % of each month&apos;s first-called contacts that called again within 1/2/4/8 weeks.
          </p>
        </CardHeader>
        <CardContent><CohortHeatmap cohorts={cohorts} /></CardContent>
      </Card>

      {/* Time to conversion */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Days to close (first call → deal won)</CardTitle></CardHeader>
        <CardContent><TimeToConversionChart data={ttc} /></CardContent>
      </Card>

      {/* Campaign + agent comparison */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Campaign funnel comparison</CardTitle></CardHeader>
          <CardContent><CampaignFunnelTable rows={campaigns} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Agent funnel comparison</CardTitle></CardHeader>
          <CardContent><AgentFunnelTable rows={agents} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
