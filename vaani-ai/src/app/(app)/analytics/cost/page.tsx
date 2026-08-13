import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission, requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/money";
import { marginPercent } from "@/lib/analytics";
import { getDateRange } from "@/lib/analytics";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import {
  getCostByAgent,
  getCampaignRoi,
  getRevenueRecognition,
  getMrr,
  getTenantProfitability,
  getCostBreakdown,
  type CostByAgentRow,
  type CampaignRoiRow,
} from "@/lib/analytics/attribution";
import { CostBreakdownDonut, CostSummaryPanel } from "./cost-breakdown";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost & margins — Vaani AI" };

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function AgentCostTable({ rows }: { rows: CostByAgentRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Cost per agent (unit economics)</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm" data-testid="cost-per-agent-table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">Agent</th><th className="p-3">Calls</th>
              <th className="p-3">Avg cost/call</th><th className="p-3">Avg duration</th>
              <th className="p-3">Cost/min</th><th className="p-3">Avg billed</th>
              <th className="p-3">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No agent calls in window.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.agentId} className="border-b last:border-0">
                  <td className="p-3 font-medium">{r.agentName}</td>
                  <td className="p-3">{r.calls}</td>
                  <td className="p-3">{formatINR(r.avgCostPaise)}</td>
                  <td className="p-3">{formatDuration(r.avgDurationSec)}</td>
                  <td className="p-3">{formatINR(r.costPerMinPaise)}</td>
                  <td className="p-3">{formatINR(r.avgBilledPaise)}</td>
                  <td className={`p-3 ${r.marginPct >= 0 ? "text-green-400" : "text-red-400"}`}>{r.marginPct}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function CampaignRoiTable({ rows }: { rows: CampaignRoiRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Campaign ROI</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm" data-testid="campaign-roi-table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">Campaign</th><th className="p-3">Calls</th>
              <th className="p-3">Cost</th><th className="p-3">Revenue (billed)</th>
              <th className="p-3">Margin</th><th className="p-3">Margin %</th>
              <th className="p-3">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No campaign calls in window.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.campaignId} className="border-b last:border-0">
                  <td className="p-3 font-medium">{r.campaignName}</td>
                  <td className="p-3">{r.calls}</td>
                  <td className="p-3">{formatINR(r.totalCostPaise)}</td>
                  <td className="p-3">{formatINR(r.revenuePaise)}</td>
                  <td className={`p-3 ${r.marginPaise >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatINR(r.marginPaise)}
                  </td>
                  <td className="p-3">{r.marginPct}%</td>
                  <td className="p-3 font-semibold">{r.roi.toFixed(2)}×</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default async function CostAnalyticsPage({
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
  // Reseller profitability needs billing:read; non-reseller workspaces just skip the section.
  let billingCtx = null;
  try {
    billingCtx = await requirePermission("billing:read");
  } catch {
    /* not a reseller / no permission — hide per-tenant section */
  }

  const range = getDateRange(searchParams.range ?? "30d");
  const rangeKey = searchParams.range ?? "30d";

  const [breakdown, byAgent, campaignRoi, recognition, mrr, tenantRows, reseller] = await Promise.all([
    getCostBreakdown(ctx.workspaceId, range),
    getCostByAgent(ctx.workspaceId, range),
    getCampaignRoi(ctx.workspaceId, range),
    getRevenueRecognition(ctx.workspaceId, range),
    getMrr(ctx.workspaceId),
    billingCtx ? getTenantProfitability(billingCtx.workspaceId, range) : Promise.resolve([]),
    billingCtx ? db.resellerAccount.findUnique({ where: { parentWorkspaceId: billingCtx.workspaceId } }) : Promise.resolve(null),
  ]);

  const totalWholesale = breakdown.telephony + breakdown.stt + breakdown.llm + breakdown.tts;
  const totalBilled = breakdown.billed;
  const marginPaise = totalBilled - totalWholesale;
  const marginPct = marginPercent(totalBilled, totalWholesale);

  const donutData = [
    { key: "telephony", name: "Telephony", value: breakdown.telephony },
    { key: "stt", name: "STT", value: breakdown.stt },
    { key: "llm", name: "LLM", value: breakdown.llm },
    { key: "tts", name: "TTS", value: breakdown.tts },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/analytics" className="text-sm text-muted-foreground hover:text-primary">← Analytics</Link>
          <h1 className="text-2xl font-bold">Cost & margins</h1>
        </div>
        <DateRangePicker current={rangeKey} />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card data-testid="tile-wholesale"><CardHeader><CardTitle className="text-sm">Wholesale cost</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{formatINR(totalWholesale)}</CardContent></Card>
        <Card data-testid="tile-billed"><CardHeader><CardTitle className="text-sm">Billed to you</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-primary">{formatINR(totalBilled)}</CardContent></Card>
        <Card data-testid="tile-margin-cost"><CardHeader><CardTitle className="text-sm">Gross margin</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-green-400">{formatINR(marginPaise)}</CardContent></Card>
        <Card data-testid="tile-margin-pct"><CardHeader><CardTitle className="text-sm">Margin %</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{marginPct}%</CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Cost breakdown by provider</CardTitle></CardHeader>
          <CardContent data-testid="cost-breakdown-donut">
            <CostBreakdownDonut data={donutData} total={totalWholesale} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
          <CardContent data-testid="cost-summary-panel">
            <CostSummaryPanel summary={{ totalCostPaise: totalWholesale, revenuePaise: totalBilled, marginPaise, marginPct }} />
          </CardContent>
        </Card>
      </div>

      <AgentCostTable rows={byAgent} />
      <CampaignRoiTable rows={campaignRoi} />

      {/* Revenue recognition */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Revenue recognition</CardTitle>
          <p className="text-xs text-muted-foreground">Recognized = billed on COMPLETED calls; pending = active calls × avg cost; deferred = wallet balance not yet consumed.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="revenue-recognition">
            <div>
              <p className="text-xs text-muted-foreground">Recognized revenue</p>
              <p className="text-2xl font-bold text-primary">{formatINR(recognition.recognizedPaise)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending revenue</p>
              <p className="text-2xl font-bold">{formatINR(recognition.pendingEstimatePaise)}</p>
              <p className="text-xs text-muted-foreground">{recognition.pendingCalls} active calls</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deferred (wallet balance)</p>
              <p className="text-2xl font-bold">{formatINR(recognition.deferredPaise)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Bad debt (expired top-ups)</p>
              <p className="text-2xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground">Not tracked yet</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MRR */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card data-testid="tile-plan-mrr"><CardHeader><CardTitle className="text-sm">Plan MRR</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{formatINR(mrr.planMrrPaise)}</CardContent></Card>
        <Card data-testid="tile-usage-mrr"><CardHeader><CardTitle className="text-sm">Usage MRR (month to date)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{formatINR(mrr.usageMrrPaise)}</CardContent></Card>
        <Card data-testid="tile-total-mrr"><CardHeader><CardTitle className="text-sm">Total MRR</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-primary">{formatINR(mrr.totalMrrPaise)}</CardContent></Card>
      </div>

      {/* Per-tenant profitability (reseller view) */}
      {reseller && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Profitability per child tenant</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm" data-testid="tenant-profitability-table">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3">Child</th><th className="p-3">Revenue</th><th className="p-3">Cost</th>
                  <th className="p-3">Margin</th><th className="p-3">Margin %</th><th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {tenantRows.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No child usage in window.</td></tr>
                ) : (
                  tenantRows.map((r) => (
                    <tr key={r.workspaceId} className="border-b last:border-0">
                      <td className="p-3 font-medium">{r.name} <span className="text-xs text-muted-foreground">({r.slug})</span></td>
                      <td className="p-3">{formatINR(r.revenuePaise)}</td>
                      <td className="p-3">{formatINR(r.costPaise)}</td>
                      <td className={`p-3 ${r.marginPaise >= 0 ? "text-green-400" : "text-red-400"}`}>{formatINR(r.marginPaise)}</td>
                      <td className="p-3">{r.marginPct}%</td>
                      <td className="p-3">
                        <Badge variant={r.status === "healthy" ? "success" : r.status === "low" ? "warning" : "danger"}>
                          {r.status === "healthy" ? "✓ Healthy" : r.status === "low" ? "⚠ Low margin" : "✗ Losing money"}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
