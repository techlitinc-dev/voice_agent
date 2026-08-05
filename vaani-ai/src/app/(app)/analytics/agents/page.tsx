import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { agentPerformance, type AgentPerfCallRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function AgentPerformancePage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [calls, transfers] = await Promise.all([
    db.call.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since }, agentId: { not: null } },
      select: {
        agentId: true,
        agent: { select: { name: true } },
        scriptAdherenceScore: true,
        hallucinationFlag: true,
        deadAirSeconds: true,
        qaScores: { orderBy: { createdAt: "desc" as const }, take: 1, select: { totalScore: true, maxScore: true } },
      },
    }),
    db.transferRequest.groupBy({
      by: ["callId"],
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  // Map agentId -> transfer count via the call's agentId.
  const callAgent = new Map<string, string | null>();
  const callsFull = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, id: { in: transfers.map((t) => t.callId) } },
    select: { id: true, agentId: true },
  });
  for (const c of callsFull) callAgent.set(c.id, c.agentId);
  const transfersForAgent = new Map<string, number>();
  for (const t of transfers) {
    const agentId = callAgent.get(t.callId);
    if (!agentId) continue;
    transfersForAgent.set(agentId, (transfersForAgent.get(agentId) ?? 0) + t._count._all);
  }

  const rows: AgentPerfCallRow[] = calls.map((c) => ({
    agentId: c.agentId,
    agentName: c.agent?.name ?? "—",
    scriptAdherenceScore: c.scriptAdherenceScore,
    hallucinationFlag: c.hallucinationFlag,
    deadAirSeconds: c.deadAirSeconds,
    qaTotal: c.qaScores[0]?.totalScore ?? null,
    qaMax: c.qaScores[0]?.maxScore ?? null,
  }));

  const perf = agentPerformance(rows, transfersForAgent);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/analytics" className="text-sm text-muted-foreground hover:text-primary">← Analytics</Link>
        <h1 className="text-2xl font-bold">Agent performance — last 30 days</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Per-agent quality metrics</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="agent-performance-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Agent</th><th className="p-3">Calls</th>
                <th className="p-3">Script adherence</th><th className="p-3">Escalation rate</th>
                <th className="p-3">Hallucinations</th><th className="p-3">Avg dead air</th>
                <th className="p-3">Avg QA score</th>
              </tr>
            </thead>
            <tbody>
              {perf.map((a) => (
                <tr key={a.agentId} className="border-b last:border-0">
                  <td className="p-3 font-medium">{a.agentName}</td>
                  <td className="p-3">{a.calls}</td>
                  <td className="p-3">
                    {a.avgScriptAdherence === null ? "—" : (
                      <span className={a.avgScriptAdherence >= 70 ? "text-green-400" : "text-orange-400"}>
                        {a.avgScriptAdherence}/100
                      </span>
                    )}
                  </td>
                  <td className="p-3">{a.escalationRate}%</td>
                  <td className="p-3">
                    {a.hallucinations > 0 ? (
                      <span className="text-red-400" data-testid={`hallucination-count-${a.agentId}`}>{a.hallucinations}</span>
                    ) : "0"}
                  </td>
                  <td className="p-3">{a.avgDeadAirSec}s</td>
                  <td className="p-3">{a.avgQaPercent === null ? "—" : `${a.avgQaPercent}%`}</td>
                </tr>
              ))}
              {perf.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No agent calls in the window. Metrics appear after your first scored calls.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
