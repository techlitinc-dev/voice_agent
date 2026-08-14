import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { InboxView } from "./inbox-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox — Vaani AI" };

const VALID_CHANNELS = ["all", "WHATSAPP", "SMS", "WEBCHAT"] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { channel?: string; id?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const channel = (VALID_CHANNELS as readonly string[]).includes(searchParams.channel ?? "")
    ? (searchParams.channel as (typeof VALID_CHANNELS)[number])
    : "all";

  const [conversations, agents] = await Promise.all([
    db.conversation.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: { not: "ARCHIVED" },
        ...(channel !== "all" ? { channel: channel as never } : {}),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, attributes: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        assignedAgent: { select: { id: true, name: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    }),
    db.agent.findMany({
      where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
      select: { id: true, name: true },
    }),
  ]);

  // Load the selected conversation (if any) with full message history.
  const selectedId = searchParams.id ?? conversations[0]?.id ?? null;
  const selected = selectedId
    ? await db.conversation.findFirst({
        where: { id: selectedId, workspaceId: ctx.workspaceId },
        include: {
          contact: { select: { id: true, name: true, phone: true, attributes: true } },
          messages: { orderBy: { createdAt: "asc" }, take: 100 },
          assignedAgent: { select: { id: true, name: true } },
        },
      })
    : null;

  return (
    <InboxView
      conversations={conversations.map((c) => ({
        ...c,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        messages: c.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      }))}
      selected={selected ? {
        ...selected,
        lastMessageAt: selected.lastMessageAt?.toISOString() ?? null,
        messages: selected.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      } : null}
      agents={agents}
      channelFilter={channel}
    />
  );
}
