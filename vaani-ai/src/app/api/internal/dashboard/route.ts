import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { getDateRange, previousRange } from "@/lib/analytics";
import {
  getAlerts,
  getCallsByAgent,
  getCallsByCampaign,
  getCallsBySource,
  getCallsTimeSeries,
  getCsat,
  getKpiWithTrend,
} from "@/lib/dashboard/queries";

/** Internal JSON for the executive dashboard (cookie-authed, tenant-scoped). */
export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const range = getDateRange(new URL(req.url).searchParams.get("range") ?? "7d");
  const previous = previousRange(range);

  const [kpis, csat, timeSeries, byAgent, byCampaign, bySource, alerts] = await Promise.all([
    getKpiWithTrend(ctx.workspaceId, range, previous),
    getCsat(ctx.workspaceId, range),
    getCallsTimeSeries(ctx.workspaceId, range, "day"),
    getCallsByAgent(ctx.workspaceId, range),
    getCallsByCampaign(ctx.workspaceId, range),
    getCallsBySource(ctx.workspaceId, range),
    getAlerts(ctx.workspaceId),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      kpis: {
        ...kpis,
        csat: { value: csat.value, scored: csat.scored },
        marginPct: kpis.marginPct,
      },
      timeSeries,
      byAgent,
      byCampaign,
      bySource,
      alerts,
    },
  });
}
