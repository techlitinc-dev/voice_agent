import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { marginPercent, sumBilledPaise, sumWholesalePaise, type AnalyticsCallRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

type GroupRow = { label: string; calls: number; minutes: number; wholesalePaise: number; billedPaise: number };

function groupStats(label: string, rows: AnalyticsCallRow[]): GroupRow {
  return {
    label,
    calls: rows.length,
    minutes: Math.round(rows.reduce((a, c) => a + c.durationSec, 0) / 60),
    wholesalePaise: sumWholesalePaise(rows),
    billedPaise: sumBilledPaise(rows),
  };
}

export default async function CostAnalyticsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const calls = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
    select: {
      createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
      fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
      costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
      agentId: true, campaignId: true,
      agent: { select: { name: true } },
      campaign: { select: { name: true } },
    },
  });

  const totalWholesale = sumWholesalePaise(calls);
  const totalBilled = sumBilledPaise(calls);

  // Per-provider totals (spec §8 cost breakdown).
  const provider = [
    { label: "Telephony (Vobiz)", paise: calls.reduce((a, c) => a + c.costTelephonyPaise, 0) },
    { label: "STT (Sarvam)", paise: calls.reduce((a, c) => a + c.costSttPaise, 0) },
    { label: "LLM (OpenRouter)", paise: calls.reduce((a, c) => a + c.costLlmPaise, 0) },
    { label: "TTS (Sarvam)", paise: calls.reduce((a, c) => a + c.costTtsPaise, 0) },
  ];

  const byAgent = new Map<string, AnalyticsCallRow[]>();
  const agentNames = new Map<string, string>();
  const byCampaign = new Map<string, AnalyticsCallRow[]>();
  const campaignNames = new Map<string, string>();
  for (const c of calls) {
    if (c.agentId) {
      byAgent.set(c.agentId, [...(byAgent.get(c.agentId) ?? []), c]);
      agentNames.set(c.agentId, c.agent?.name ?? "—");
    }
    if (c.campaignId) {
      byCampaign.set(c.campaignId, [...(byCampaign.get(c.campaignId) ?? []), c]);
      campaignNames.set(c.campaignId, c.campaign?.name ?? "—");
    }
  }
  const agentRows = [...byAgent.entries()].map(([id, rows]) => groupStats(agentNames.get(id) ?? "—", rows));
  const campaignRows = [...byCampaign.entries()].map(([id, rows]) => groupStats(campaignNames.get(id) ?? "—", rows));

  function CostTable({ title, rows, testid }: { title: string; rows: GroupRow[]; testid: string }) {
    return (
      <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid={testid}>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Name</th><th className="p-3">Calls</th><th className="p-3">Minutes</th>
                <th className="p-3">Wholesale</th><th className="p-3">Billed</th>
                <th className="p-3">Margin</th><th className="p-3">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b last:border-0">
                  <td className="p-3 font-medium">{r.label}</td>
                  <td className="p-3">{r.calls}</td>
                  <td className="p-3">{r.minutes}</td>
                  <td className="p-3">{formatINR(r.wholesalePaise)}</td>
                  <td className="p-3">{formatINR(r.billedPaise)}</td>
                  <td className={`p-3 ${r.billedPaise - r.wholesalePaise >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatINR(r.billedPaise - r.wholesalePaise)}
                  </td>
                  <td className="p-3">{marginPercent(r.billedPaise, r.wholesalePaise)}%</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No data in window.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/analytics" className="text-sm text-muted-foreground hover:text-primary">← Analytics</Link>
        <h1 className="text-2xl font-bold">Cost & margins — last 30 days</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card data-testid="tile-wholesale"><CardHeader><CardTitle className="text-sm">Wholesale cost</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{formatINR(totalWholesale)}</CardContent></Card>
        <Card data-testid="tile-billed"><CardHeader><CardTitle className="text-sm">Billed to you</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-primary">{formatINR(totalBilled)}</CardContent></Card>
        <Card data-testid="tile-margin-cost"><CardHeader><CardTitle className="text-sm">Gross margin</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-green-400">{formatINR(totalBilled - totalWholesale)}</CardContent></Card>
        <Card data-testid="tile-margin-pct"><CardHeader><CardTitle className="text-sm">Margin %</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{marginPercent(totalBilled, totalWholesale)}%</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Wholesale cost by provider</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm" data-testid="provider-cost-table">
          {provider.map((p) => (
            <p key={p.label} className="flex justify-between border-b border-border/40 py-1">
              <span className="text-muted-foreground">{p.label}</span>
              <span>{formatINR(p.paise)}</span>
            </p>
          ))}
        </CardContent>
      </Card>

      <CostTable title="Per-agent unit economics" rows={agentRows} testid="cost-per-agent-table" />
      <CostTable title="Per-campaign unit economics" rows={campaignRows} testid="cost-per-campaign-table" />
    </div>
  );
}
