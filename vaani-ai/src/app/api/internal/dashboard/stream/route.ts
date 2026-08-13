import { requireWorkspace } from "@/lib/auth";
import { getActiveCalls } from "@/lib/dashboard/queries";

/** SSE stream of active calls for the live tiles (guide 01 §5.1). */
export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        try {
          const data = await getActiveCalls(ctx.workspaceId);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (e) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "query failed" })}\n\n`));
          console.error("[dashboard/stream] query error", e);
        }
      };
      await send();
      const interval = setInterval(send, 3000);
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
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
