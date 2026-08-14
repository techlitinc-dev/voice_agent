import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

const encoder = new TextEncoder();
const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET /api/calls/[id]/live-stream — Server-Sent Events feed for a live call.
 *
 * Streams `state`, `transcript`, and `ended` events to supervisors watching a
 * call in real time. Tenant-scoped (the caller must belong to the workspace
 * that owns the call) and gated on the live:listen permission.
 *
 * Implements the DB-polling variant from docs/new-features/01 (§5 covers
 * swapping to Redis pub/sub when >50 concurrent viewers are expected).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let ctx;
  try {
    ctx = await requirePermission("live:listen");
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const callId = params.id;

  const call = await db.call.findFirst({
    where: { id: callId, workspaceId: ctx.workspaceId },
    include: { liveState: true },
  });
  if (!call) {
    return NextResponse.json({ ok: false, error: "Call not found." }, { status: 404 });
  }

  // Seed the cursor from the call start so a supervisor joining mid-call gets
  // the full transcript on the initial poll, not just new entries.
  let lastTs = call.startedAt;

  const stream = new ReadableStream({
    async start(controller) {
      // Initial state snapshot (mode, whisper context, status).
      const state = await db.liveCallState.findUnique({ where: { callId } });
      controller.enqueue(
        sse("state", {
          status: state?.status ?? call.status,
          mode: state?.mode ?? "NONE",
          whisperContext: state?.whisperContext ?? null,
        })
      );

      const poll = async () => {
        try {
          const entries = await db.transcriptEntry.findMany({
            where: { callId, createdAt: { gt: lastTs } },
            orderBy: { timestampMs: "asc" },
          });
          for (const entry of entries) {
            controller.enqueue(sse("transcript", entry));
          }
          if (entries.length > 0) lastTs = new Date();

          const updated = await db.liveCallState.findUnique({ where: { callId } });
          const liveStatus = updated?.status ?? call.status;
          if (liveStatus !== "IN_PROGRESS" && liveStatus !== "RINGING") {
            controller.enqueue(sse("ended", {}));
            controller.close();
            return;
          }
          // Emit mode changes as state events so the UI badge stays fresh.
          const cur = updated?.mode ?? "NONE";
          controller.enqueue(
            sse("state", {
              status: liveStatus,
              mode: cur,
              whisperContext: updated?.whisperContext ?? null,
            })
          );
        } catch (e) {
          console.error("live-stream poll failed", e);
          try {
            controller.error(e);
          } catch {
            /* already closed */
          }
        }
      };

      const interval = setInterval(poll, POLL_MS);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(sse("heartbeat", { at: Date.now() }));
        } catch {
          /* stream closed */
        }
      }, HEARTBEAT_MS);

      // Consume the initial poll so new subscribers get the full recent tail.
      await poll();

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
