import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { burnPaisePerMinute, computeAht, computeAsr } from "@/lib/analytics";

/** Internal JSON for the dashboard live tiles (cookie-authed, tenant-scoped). */
export async function GET() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hourAgo = new Date(Date.now() - 3600 * 1000);

  const [liveCalls, todayCalls, hourCalls] = await Promise.all([
    db.liveCallState.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { callId: true, status: true, mode: true, updatedAt: true },
    }),
    db.call.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: todayStart } },
      select: {
        createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
        fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
        costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
      },
    }),
    db.call.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: hourAgo } },
      select: {
        createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
        fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
        costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      liveCalls: liveCalls.length,
      concurrency: liveCalls.length, // one LiveCallState row per in-progress call
      asrToday: computeAsr(todayCalls),
      ahtToday: computeAht(todayCalls),
      callsToday: todayCalls.length,
      burnPaisePerMin: burnPaisePerMinute(hourCalls),
      at: new Date().toISOString(),
    },
  });
}
