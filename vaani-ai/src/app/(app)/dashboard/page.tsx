import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/money";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, PhoneCall, PhoneIncoming, IndianRupee, Percent, Users, Star } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { getDateRange, previousRange } from "@/lib/analytics";
import {
  getAlerts,
  getCallsByAgent,
  getCallsByCampaign,
  getCallsBySource,
  getCallsTimeSeries,
  getCsat,
  getKpiWithTrend,
  getSentimentTrend,
} from "@/lib/dashboard/queries";
import { LiveTiles } from "./live-tiles";
import { CallsOverTime, RevenueVsCost, CallsByAgent, CallsByCampaign, CallsBySource } from "./charts";
import { SentimentTrend } from "@/components/sentiment-trend";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — Vaani AI" };

function kpiId(label: string): string {
  return `kpi-${label.toLowerCase().replace(/\s+/g, "-")}`;
}

function KpiRow(props: {
  kpis: Awaited<ReturnType<typeof getKpiWithTrend>>;
  csat: { value: number; scored: number };
}) {
  const { kpis, csat } = props;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" data-testid="kpi-row">
      <StatCard
        label="Calls"
        value={String(kpis.totalCalls.value)}
        trend={{ value: kpis.totalCalls.trend, positive: kpis.totalCalls.trend >= 0 }}
        icon={PhoneCall}
        className={kpiId("Calls")}
      />
      <StatCard
        label="Connect rate"
        value={`${kpis.connectRate.value}%`}
        trend={{ value: kpis.connectRate.trend, positive: kpis.connectRate.trend >= 0 }}
        icon={PhoneIncoming}
        className={kpiId("Connect rate")}
      />
      <StatCard
        label="Revenue"
        value={formatINR(kpis.revenue.value)}
        trend={{ value: kpis.revenue.trend, positive: kpis.revenue.trend >= 0 }}
        icon={IndianRupee}
        className={kpiId("Revenue")}
      />
      <StatCard
        label="Gross margin"
        value={`${kpis.marginPct.value}%`}
        trend={{ value: kpis.marginPct.trend, positive: kpis.marginPct.trend >= 0 }}
        icon={Percent}
        className={kpiId("Gross margin")}
      />
      <StatCard
        label="CSAT"
        value={`${csat.value}%`}
        sub={csat.scored > 0 ? `${csat.scored} scored` : "no scores yet"}
        icon={Star}
        className={kpiId("CSAT")}
      />
      <StatCard
        label="Active users"
        value={String(kpis.activeUsers.value)}
        trend={{ value: kpis.activeUsers.trend, positive: kpis.activeUsers.trend >= 0 }}
        icon={Users}
        className={kpiId("Active users")}
      />
    </div>
  );
}

function AlertsPanel({ alerts }: { alerts: Awaited<ReturnType<typeof getAlerts>> }) {
  return (
    <Card data-testid="alerts-panel">
      <CardHeader><CardTitle className="text-sm">Alerts</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">All clear — no alerts right now.</p>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="flex items-start gap-2" data-testid={`alert-${a.id}`}>
              <Badge variant={a.severity === "danger" ? "danger" : a.severity === "warning" ? "warning" : "info"} className="mt-0.5 shrink-0">
                {a.severity}
              </Badge>
              <div>
                <p className="text-sm font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.detail}</p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({
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
  const workspace = await db.workspace.findUnique({ where: { id: ctx.workspaceId } });
  const wallet = await db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } });
  const range = searchParams.range ?? "7d";
  const current = getDateRange(range);
  const previous = previousRange(current);

  const [kpis, csat, timeSeries, byAgent, byCampaign, bySource, alerts, sentimentTrend] = await Promise.all([
    getKpiWithTrend(ctx.workspaceId, current, previous),
    getCsat(ctx.workspaceId, current),
    getCallsTimeSeries(ctx.workspaceId, current, "day"),
    getCallsByAgent(ctx.workspaceId, current),
    getCallsByCampaign(ctx.workspaceId, current),
    getCallsBySource(ctx.workspaceId, current),
    getAlerts(ctx.workspaceId),
    getSentimentTrend(ctx.workspaceId, current),
  ]);

  return (
    <main className="mx-auto max-w-7xl p-8" data-testid="executive-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{workspace?.name}</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.user.fullName} · {ctx.membership.role}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker current={range} />
          <Link href="/api/exports/analytics-summary.csv">
            <Button variant="outline" size="sm" data-testid="export-csv"><Download className="h-4 w-4" /> Export</Button>
          </Link>
          <Link href="/settings/members">
            <Button variant="outline" size="sm">Settings</Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <LiveTiles />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader><CardTitle>Wallet balance</CardTitle></CardHeader>
            <CardContent className="text-3xl font-bold text-primary">
              {formatINR(wallet?.balancePaise ?? 0)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Signed in as</CardTitle></CardHeader>
            <CardContent>
              <p>{ctx.user.fullName}</p>
              <p className="text-sm text-muted-foreground">{ctx.user.email} · {ctx.membership.role}</p>
            </CardContent>
          </Card>
        </div>

        <KpiRow kpis={kpis} csat={csat} />

        <div className="grid gap-4 lg:grid-cols-2">
          <CallsOverTime data={timeSeries} />
          <RevenueVsCost data={timeSeries} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <CallsByAgent data={byAgent} />
          <CallsByCampaign data={byCampaign} />
          <CallsBySource data={bySource} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SentimentTrend data={sentimentTrend} />
          <AlertsPanel alerts={alerts} />
        </div>
      </div>
    </main>
  );
}
