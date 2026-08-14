import { NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/widget/stream?workspace=<slug>&sessionId=<id> — SSE push for the web
 * chat widget (doc §3.3). Public, no session auth: identifies the conversation
 * by workspace slug + client session id, polls the DB for new outbound
 * messages and streams them to the widget. The widget renders only outbound
 * (AI/agent) messages it didn't send itself.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("workspace")?.trim().toLowerCase() ?? "";
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  if (!slug || !sessionId) {
    return new Response("workspace and sessionId required", { status: 400 });
  }

  const workspace = await db.workspace.findUnique({ where: { slug } });
  if (!workspace) return new Response("workspace not found", { status: 404 });

  const conversation = await db.conversation.findFirst({
    where: { workspaceId: workspace.id, channel: "WEBCHAT", externalId: `webchat:${sessionId}` },
    select: { id: true },
  });

  const encoder = new TextEncoder();
  let cursor = new Date(); // seed: only stream messages created after connect
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const sse = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Greet with existing outbound messages so a late-joining widget catches up.
      if (conversation) {
        const history = await db.message.findMany({
          where: { conversationId: conversation.id, direction: "outbound", createdAt: { lt: cursor } },
          orderBy: { createdAt: "asc" },
          take: 50,
        });
        sse("history", history.map((m) => ({ id: m.id, body: m.body, senderType: m.senderType, createdAt: m.createdAt.toISOString() })));
      }

      poll = setInterval(async () => {
        if (!conversation) return;
        try {
          const fresh = await db.message.findMany({
            where: { conversationId: conversation.id, direction: "outbound", createdAt: { gte: cursor } },
            orderBy: { createdAt: "asc" },
            take: 20,
          });
          for (const m of fresh) {
            sse("message", { id: m.id, body: m.body, senderType: m.senderType, createdAt: m.createdAt.toISOString() });
          }
          if (fresh.length > 0) cursor = new Date(fresh[fresh.length - 1].createdAt.getTime() + 1);
        } catch (e) {
          console.error("[widget-stream] poll error", e);
        }
      }, 2000);

      heartbeat = setInterval(() => {
        sse("ping", { at: Date.now() });
      }, 15000);

      req.signal.addEventListener("abort", () => {
        if (poll) clearInterval(poll);
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
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
