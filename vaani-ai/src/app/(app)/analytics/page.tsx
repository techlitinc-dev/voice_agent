import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { computeAht, computeAsr, marginPercent } from "@/lib/analytics";
import { AnalyticsCharts } from "./charts";

export const dynamic = "force-dynamic";

export const metadata = { title: "Analytics — Vaani AI" };
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const agentFilter = searchParams.agent?.trim() || null;
  const calls = await db.call.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      createdAt: { gte: since },
      ...(agentFilter ? { agentId: agentFilter } : {}),
    },
    select: {
      createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
      fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
      costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // --- Aggregate per day ---
  const byDay = new Map<string, { date: string; calls: number; minutes: number; billed: number }>();
  for (const c of calls) {
    const date = c.createdAt.toISOString().slice(0, 10);
    const row = byDay.get(date) ?? { date, calls: 0, minutes: 0, billed: 0 };
    row.calls++;
    row.minutes += Math.round(c.durationSec / 60);
    row.billed += c.billedPaise / 100;
    byDay.set(date, row);
  }
  const daily = [...byDay.values()];

  // --- Outcomes + costs ---
  const outcomes = new Map<string, number>();
  const cost = { telephony: 0, stt: 0, llm: 0, tts: 0 };
  let totalBilled = 0;
  for (const c of calls) {
    if (c.outcome) outcomes.set(c.outcome, (outcomes.get(c.outcome) ?? 0) + 1);
    cost.telephony += c.costTelephonyPaise / 100;
    cost.stt += c.costSttPaise / 100;
    cost.llm += c.costLlmPaise / 100;
    cost.tts += c.costTtsPaise / 100;
    totalBilled += c.billedPaise / 100;
  }
  const outcomeData = [...outcomes.entries()].map(([name, value]) => ({ name, value }));
  const costData = [
    { name: "Telephony", value: Math.round(cost.telephony * 100) / 100 },
    { name: "STT", value: Math.round(cost.stt * 100) / 100 },
    { name: "LLM", value: Math.round(cost.llm * 100) / 100 },
    { name: "TTS", value: Math.round(cost.tts * 100) / 100 },
  ];
  const totalCost = cost.telephony + cost.stt + cost.llm + cost.tts;
  const asr = computeAsr(calls);
  const aht = computeAht(calls);
  const marginPaise = Math.round((totalBilled - totalCost) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Analytics — last 30 days</h1>
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex items-center gap-2">
            <select name="agent" defaultValue={agentFilter ?? ""}
              data-testid="analytics-agent-filter"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm">
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button data-testid="analytics-agent-apply"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Apply
            </button>
          </form>
          <div className="flex gap-4 text-sm">
            <Link href="/analytics/funnel" className="text-primary hover:underline" data-testid="nav-funnel-cohorts">Funnel & cohorts →</Link>
            <Link href="/analytics/campaigns" className="text-primary hover:underline" data-testid="nav-campaign-reports">Campaign reports →</Link>
            <Link href="/analytics/agents" className="text-primary hover:underline" data-testid="nav-agent-performance">Agent performance →</Link>
            <Link href="/analytics/cost" className="text-primary hover:underline" data-testid="nav-cost-analytics">Cost & margins →</Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card data-testid="tile-total-calls"><CardHeader><CardTitle className="text-sm">Total calls</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{calls.length}</CardContent></Card>
        <Card data-testid="tile-asr"><CardHeader><CardTitle className="text-sm">Answer rate (ASR)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-primary">{asr}%</CardContent></Card>
        <Card data-testid="tile-aht"><CardHeader><CardTitle className="text-sm">Avg call (AHT)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{aht}s</CardContent></Card>
        <Card data-testid="tile-margin"><CardHeader><CardTitle className="text-sm">Gross margin</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-green-400">{formatINR(marginPaise)}</CardContent></Card>
      </div>

      <AnalyticsCharts daily={daily} outcomes={outcomeData} costs={costData} />

      <p className="text-xs text-muted-foreground">
        Margin card = billed − wholesale across the 30-day window (margin{" "}
        {marginPercent(Math.round(totalBilled * 100), Math.round(totalCost * 100))}%).
      </p>
    </div>
  );
}
