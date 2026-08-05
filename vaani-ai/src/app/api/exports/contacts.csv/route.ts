import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { csvEscape } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Streaming CSV of workspace contacts (spec §8 exports). Tenant-scoped, contacts:read-gated. */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("contacts:read");
  } catch (e) {
    const forbidden = e instanceof Error && e.message === "FORBIDDEN";
    return new Response(forbidden ? "forbidden" : "unauthorized", { status: forbidden ? 403 : 401 });
  }
  const workspaceId = ctx.workspaceId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode("id,phone,name,list,timezone,dnc,consentAt,createdAt\r\n"));
      let cursor: string | undefined;
      for (;;) {
        const batch = await db.contact.findMany({
          where: { workspaceId },
          include: { list: { select: { name: true } } },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;
        for (const c of batch) {
          controller.enqueue(enc.encode([
            c.id, c.phone, c.name ?? "", c.list?.name ?? "", c.timezone ?? "", c.dnc,
            c.consentAt?.toISOString() ?? "", c.createdAt.toISOString(),
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
      "Content-Disposition": `attachment; filename="vaani-contacts.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
