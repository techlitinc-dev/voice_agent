import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { buildHeatmap, computeFunnel, perNumberStats, ratePercent } from "@/lib/analytics";
import { FunnelChart, Heatmap } from "./campaign-charts";

export const dynamic = "force-dynamic";

export default async function CampaignReportsPage({
  searchParams,
}: {
  searchParams: { campaign?: string };
}) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const campaigns = await db.campaign.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const selectedId = searchParams.campaign ?? campaigns[0]?.id ?? null;

  const [calls, contactCounts] = selectedId
    ? await Promise.all([
        db.call.findMany({
          where: { workspaceId: ctx.workspaceId, campaignId: selectedId },
          select: {
            createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
            fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
            costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
          },
        }),
        db.campaignContact.groupBy({
          by: ["status"],
          where: { campaignId: selectedId },
          _count: { _all: true },
        }),
      ])
    : [[], []] as const;

  const totalContacts = (contactCounts as Array<{ status: string; _count: { _all: number } }>)
    .reduce((a, r) => a + r._count._all, 0);
  const completedContacts = (contactCounts as Array<{ status: string; _count: { _all: number } }>)
    .filter((r) => r.status === "COMPLETED")
    .reduce((a, r) => a + r._count._all, 0);

  const funnel = computeFunnel(calls as never);
  const numbers = perNumberStats(calls as never);
  const heat = buildHeatmap(calls as never);
  const heatMax = Math.max(0, ...heat.flat());

  // Enrich with PhoneNumber records — join on (workspaceId, number = Call.fromNumber/
  // toNumber E.164 string), the v1 convention documented above.
  const phoneNumberRows = await db.phoneNumber.findMany({
    where: { workspaceId: ctx.workspaceId, number: { in: numbers.map((n) => n.number) } },
    select: { number: true, label: true },
  });
  const labelFor = new Map<string, string | null>(phoneNumberRows.map((r) => [r.number, r.label]));

  // Reach rate: contacts dialed (any attempt) / total contacts.
  const dialedContacts = (contactCounts as Array<{ status: string; _count: { _all: number } }>)
    .filter((r) => r.status !== "PENDING")
    .reduce((a, r) => a + r._count._all, 0);
  const reachRate = ratePercent(dialedContacts, totalContacts);
  // Connect rate: answered calls / dialed calls.
  const connectRate = ratePercent(funnel.answered, funnel.dialed);

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/analytics" className="text-sm text-muted-foreground hover:text-primary">← Analytics</Link>
        <h1 className="text-2xl font-bold">Campaign reports</h1>
      </div>

      <form className="flex gap-2">
        <select name="campaign" defaultValue={selectedId ?? ""}
          data-testid="campaign-report-select"
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
          ))}
        </select>
        <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Show</button>
      </form>

      {!selectedId ? (
        <p className="text-sm text-muted-foreground">No campaigns yet — create one in guide 07&apos;s campaign page.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Card data-testid="tile-reach-rate"><CardHeader><CardTitle className="text-sm">Reach rate</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold">{reachRate}%
                <span className="block text-xs font-normal text-muted-foreground">{dialedContacts}/{totalContacts} contacts dialed</span>
              </CardContent></Card>
            <Card data-testid="tile-connect-rate"><CardHeader><CardTitle className="text-sm">Connect rate</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold text-primary">{connectRate}%
                <span className="block text-xs font-normal text-muted-foreground">{funnel.answered}/{funnel.dialed} calls answered</span>
              </CardContent></Card>
            <Card data-testid="tile-booked"><CardHeader><CardTitle className="text-sm">Booked</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold text-green-400">{funnel.booked}</CardContent></Card>
            <Card data-testid="tile-contacts-done"><CardHeader><CardTitle className="text-sm">Contacts completed</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold">{completedContacts}</CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Conversion funnel</CardTitle></CardHeader>
              <CardContent className="h-64" data-testid="campaign-funnel-chart">
                <FunnelChart funnel={funnel} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Best time to call (answered calls, hour × day)</CardTitle></CardHeader>
              <CardContent data-testid="time-to-call-heatmap">
                {heatMax === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">No answered calls yet.</p>
                ) : (
                  <Heatmap heat={heat} max={heatMax} days={DAYS} />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Per-number performance</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm" data-testid="per-number-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3">Number</th><th className="p-3">Calls</th><th className="p-3">Answered</th>
                    <th className="p-3">ASR</th><th className="p-3">Talk time</th><th className="p-3">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => (
                    <tr key={n.number} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">
                        {n.number}
                        {labelFor.get(n.number) ? (
                          <span className="ml-2 font-sans text-muted-foreground">· {labelFor.get(n.number)}</span>
                        ) : null}
                      </td>
                      <td className="p-3">{n.calls}</td>
                      <td className="p-3">{n.answered}</td>
                      <td className="p-3">{n.asr}%</td>
                      <td className="p-3">{Math.round(n.totalDurationSec / 60)}m</td>
                      <td className="p-3">{formatINR(n.billedPaise)}</td>
                    </tr>
                  ))}
                  {numbers.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No calls for this campaign yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
