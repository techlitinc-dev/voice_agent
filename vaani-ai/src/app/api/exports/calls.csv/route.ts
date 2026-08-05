import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { csvEscape } from "@/lib/csv";

export const dynamic = "force-dynamic";

const HEADERS = [
  "id", "createdAt", "direction", "status", "fromNumber", "toNumber", "agent", "campaign",
  "durationSec", "outcome", "sentiment", "deadAirSeconds", "scriptAdherenceScore",
  "costTelephonyPaise", "costSttPaise", "costLlmPaise", "costTtsPaise", "billedPaise", "summary",
];

/** Streaming CSV of the workspace's CDRs (spec §8 exports). Tenant-scoped, calls:read-gated. */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("calls:read");
  } catch (e) {
    const forbidden = e instanceof Error && e.message === "FORBIDDEN";
    return new Response(forbidden ? "forbidden" : "unauthorized", { status: forbidden ? 403 : 401 });
  }
  const workspaceId = ctx.workspaceId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(HEADERS.map(csvEscape).join(",") + "\r\n"));
      let cursor: string | undefined;
      for (;;) {
        const batch = await db.call.findMany({
          where: { workspaceId },
          include: { agent: { select: { name: true } }, campaign: { select: { name: true } } },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;
        for (const c of batch) {
          controller.enqueue(enc.encode([
            c.id, c.createdAt.toISOString(), c.direction, c.status, c.fromNumber, c.toNumber,
            c.agent?.name ?? "", c.campaign?.name ?? "", c.durationSec, c.outcome ?? "",
            c.sentiment ?? "", c.deadAirSeconds, c.scriptAdherenceScore ?? "",
            c.costTelephonyPaise, c.costSttPaise, c.costLlmPaise, c.costTtsPaise, c.billedPaise,
            c.summary ?? "",
          ].map(csvEscape).join(",") + "\r\n"));
        }
        cursor = batch[batch.length - 1].id;
        if (batch.length < 500) break;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaani-calls.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
