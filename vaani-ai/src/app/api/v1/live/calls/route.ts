import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

/** GET /api/v1/live/calls — active calls + live state + transcript tail for /live.
 *  Gated on the live:listen permission (guide 03). */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("live:listen");
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const calls = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, status: { in: ["RINGING", "IN_PROGRESS"] } },
    include: {
      liveState: true,
      agent: { select: { name: true } },
      transcriptEntries: { orderBy: { timestampMs: "asc" }, take: 50 },
    },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    ok: true,
    calls: calls.map((c) => ({
      id: c.id,
      fromNumber: c.fromNumber,
      toNumber: c.toNumber,
      status: c.status,
      direction: c.direction,
      agentName: c.agent?.name ?? "—",
      startedAt: c.startedAt.toISOString(),
      mode: c.liveState?.mode ?? "NONE",
      whisperContext: c.liveState?.whisperContext ?? null,
      transcript: c.transcriptEntries.map((t) => ({ speaker: t.speaker, text: t.text })),
    })),
  });
}
