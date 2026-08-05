import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { computeAht, computeAsr, sumBilledPaise, sumWholesalePaise } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/** One-row-per-day analytics summary for the last 30 days (spec §8 exports). analytics:read-gated. */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("analytics:read");
  } catch (e) {
    const forbidden = e instanceof Error && e.message === "FORBIDDEN";
    return new Response(forbidden ? "forbidden" : "unauthorized", { status: forbidden ? 403 : 401 });
  }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const calls = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
    select: {
      createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
      fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
      costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
    },
  });

  const byDay = new Map<string, typeof calls>();
  for (const c of calls) {
    const day = c.createdAt.toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }

  const rows = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayCalls]) => [
      date,
      dayCalls.length,
      computeAsr(dayCalls),
      computeAht(dayCalls),
      sumWholesalePaise(dayCalls),
      sumBilledPaise(dayCalls),
      sumBilledPaise(dayCalls) - sumWholesalePaise(dayCalls),
    ]);

  const csv = toCsv(["date", "calls", "asrPercent", "ahtSeconds", "wholesalePaise", "billedPaise", "marginPaise"], rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaani-analytics-summary.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
