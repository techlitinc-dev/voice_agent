"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/money";
import type { FunnelStage } from "@/lib/analytics";
import type { CohortRow, TimeToConversion } from "@/lib/analytics";

// ---------- Call-to-deal funnel (guide 02 §1) ----------

export function CallToDealFunnel({ stages }: { stages: FunnelStage[] }) {
  const maxCount = stages[0]?.count ?? 0;
  return (
    <div className="space-y-2" data-testid="call-to-deal-funnel">
      {stages.map((s, i) => {
        const widthPct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
        const nextStage = stages[i + 1];
        const dropoff = nextStage && s.count > 0 ? Math.round(((s.count - nextStage.count) / s.count) * 100) : 0;
        return (
          <div key={s.stage}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{s.stage}</span>
              <span className="text-sm text-muted-foreground">
                {s.count.toLocaleString()}
                {s.conversion !== null && ` (${s.conversion}%)`}
              </span>
            </div>
            <div className="relative h-10 rounded-md bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-500"
                style={{ width: `${widthPct}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-end pr-3 text-xs font-medium">
                {s.valuePaise ? formatINR(s.valuePaise) : ""}
              </span>
            </div>
            {nextStage && (
              <p className="mt-1 text-xs text-muted-foreground">
                ↓ {dropoff}% drop-off to “{nextStage.stage}”
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Drop-off insight (guide 02 §2) ----------

export type DropoffInsight = {
  from: string;
  to: string;
  dropoffPct: number;
  suggestion: string;
};

export function DropoffInsights({ insight }: { insight: DropoffInsight | null }) {
  if (!insight) return <p className="text-sm text-muted-foreground">No drop-off data yet.</p>;
  return (
    <div className="space-y-2" data-testid="dropoff-insights">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-amber-500">⚠</span>
        <div>
          <p className="text-sm font-medium">
            {insight.from} → {insight.to}: {insight.dropoffPct}% drop-off
          </p>
          <p className="text-xs text-muted-foreground">{insight.suggestion}</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Cohort retention heatmap (guide 02 §3.4) ----------

function cohortColor(pct: number): string {
  if (pct <= 0) return "bg-muted text-muted-foreground";
  if (pct < 10) return "bg-blue-200 text-blue-900";
  if (pct < 25) return "bg-blue-300 text-blue-950";
  if (pct < 40) return "bg-blue-400 text-white";
  if (pct < 60) return "bg-blue-500 text-white";
  return "bg-blue-600 text-white";
}

export function CohortHeatmap({ cohorts }: { cohorts: CohortRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="cohort-heatmap">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Cohort</th>
            <th className="py-2 text-center">Size</th>
            {(["week0", "week1", "week2", "week4", "week8"] as const).map((wk) => (
              <th key={wk} className="py-2 text-center capitalize">
                {wk === "week0" ? "Week 0" : wk === "week1" ? "Week 1" : wk === "week2" ? "Week 2" : wk === "week4" ? "Week 4" : "Week 8"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                No cohort data yet — contacts need a first campaign call.
              </td>
            </tr>
          ) : (
            cohorts.map((row) => (
              <tr key={row.cohortMonth} className="border-b last:border-0">
                <td className="py-2 font-medium">
                  {new Date(row.cohortMonth + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                </td>
                <td className="py-2 text-center">{row.cohortSize}</td>
                {(["week0", "week1", "week2", "week4", "week8"] as const).map((wk) => {
                  const pct = row.cohortSize > 0 ? Math.round((row[wk] / row.cohortSize) * 100) : 0;
                  return (
                    <td key={wk} className={`py-2 text-center font-medium ${cohortColor(pct)}`}>
                      {row[wk]} ({pct}%)
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Time to conversion (guide 02 §4) ----------

const TTC_LABELS: Record<string, string> = {
  "0-3": "0-3 days",
  "4-7": "4-7 days",
  "8-14": "8-14 days",
  "15-30": "15-30 days",
  "30+": "30+ days",
};

export function TimeToConversionChart({ data }: { data: TimeToConversion }) {
  const entries = Object.entries(data.buckets) as [keyof TimeToConversion["buckets"], number][];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const max = Math.max(1, ...entries.map(([, v]) => v));

  return (
    <div className="space-y-2" data-testid="time-to-conversion">
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">No closed-won deals from calls in this period.</p>
      ) : (
        <>
          {entries.map(([key, value]) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm">{TTC_LABELS[key]}</span>
                <span className="text-sm text-muted-foreground">
                  {value} deal{value !== 1 ? "s" : ""} ({total > 0 ? Math.round((value / total) * 100) : 0}%)
                </span>
              </div>
              <div className="relative h-6 rounded bg-muted overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-violet-400" style={{ width: `${(value / max) * 100}%` }} />
              </div>
            </div>
          ))}
          <div className="flex gap-6 pt-2 text-sm">
            <p>
              <span className="text-muted-foreground">Median:</span>{" "}
              <span className="font-semibold">{data.median !== null ? `${data.median} days` : "—"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Average:</span>{" "}
              <span className="font-semibold">{data.average !== null ? `${data.average.toFixed(1)} days` : "—"}</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Campaign / agent funnel comparison tables (guide 02 §5, §6) ----------

export type CampaignFunnelRow = {
  campaignId: string;
  campaignName: string;
  calls: number;
  answered: number;
  hot: number;
  dealsCreated: number;
  won: number;
  callToWin: number; // 1 decimal %
};

export function CampaignFunnelTable({ rows }: { rows: CampaignFunnelRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="campaign-funnel-table">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Campaign</th>
            <th className="py-2 text-right">Calls</th>
            <th className="py-2 text-right">Answered</th>
            <th className="py-2 text-right">HOT</th>
            <th className="py-2 text-right">Deals</th>
            <th className="py-2 text-right">Won</th>
            <th className="py-2 text-right">Call-to-win</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-muted-foreground">No campaign calls in this period.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.campaignId} className="border-b last:border-0">
                <td className="py-2 font-medium">{r.campaignName}</td>
                <td className="py-2 text-right">{r.calls.toLocaleString()}</td>
                <td className="py-2 text-right">{r.answered} ({r.calls > 0 ? Math.round((r.answered / r.calls) * 100) : 0}%)</td>
                <td className="py-2 text-right">{r.hot} ({r.calls > 0 ? Math.round((r.hot / r.calls) * 100) : 0}%)</td>
                <td className="py-2 text-right">{r.dealsCreated}</td>
                <td className="py-2 text-right">{r.won}</td>
                <td className="py-2 text-right font-semibold">{r.callToWin}%</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export type AgentFunnelRow = {
  agentId: string;
  agentName: string;
  calls: number;
  hot: number;
  hotRate: number;
  dealsCreated: number;
  revenuePerDeal: number;
};

export function AgentFunnelTable({ rows }: { rows: AgentFunnelRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="agent-funnel-table">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Agent</th>
            <th className="py-2 text-right">Calls</th>
            <th className="py-2 text-right">HOT rate</th>
            <th className="py-2 text-right">Deals created</th>
            <th className="py-2 text-right">Revenue/deal</th>
            <th className="py-2">Best at</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-muted-foreground">No agent calls in this period.</td>
            </tr>
          ) : (
            rows.map((r) => {
              const best = r.calls > 0
                ? r.dealsCreated > 0 ? "Pipeline" : r.hotRate >= 30 ? "Qualifying" : "Volume"
                : "—";
              return (
                <tr key={r.agentId} className="border-b last:border-0">
                  <td className="py-2 font-medium">{r.agentName}</td>
                  <td className="py-2 text-right">{r.calls.toLocaleString()}</td>
                  <td className="py-2 text-right">{r.hotRate}%</td>
                  <td className="py-2 text-right">{r.dealsCreated}</td>
                  <td className="py-2 text-right">{r.revenuePerDeal > 0 ? formatINR(r.revenuePerDeal) : "—"}</td>
                  <td className="py-2">
                    <Badge variant={r.dealsCreated > 0 ? "success" : r.hotRate >= 30 ? "info" : "secondary"}>{best}</Badge>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export { Card, CardContent, CardHeader, CardTitle };
