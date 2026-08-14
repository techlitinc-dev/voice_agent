"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PhoneCall, Send, Bot, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CHANNELS, channelLabel } from "./channels";
import {
  replyToConversationAction,
  toggleAiAction,
  assignAgentAction,
  setConversationStatusAction,
} from "@/server/actions/inbox";

type ContactLite = { id: string; name: string | null; phone: string; attributes: unknown } | null;
type AgentLite = { id: string; name: string };
type Msg = { id: string; direction: string; senderType: string; body: string; createdAt: string };
type Conv = {
  id: string;
  channel: string;
  status: string;
  aiEnabled: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  contact: ContactLite;
  assignedAgent: AgentLite | null;
  messages: Msg[];
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-green-500/10 text-green-400",
  PENDING_AI: "bg-blue-500/10 text-blue-400",
  PENDING_HUMAN: "bg-red-500/10 text-red-400",
  RESOLVED: "bg-muted text-muted-foreground",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function InboxView(props: {
  conversations: Conv[];
  selected: Conv | null;
  agents: AgentLite[];
  channelFilter: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selected = props.selected;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected?.id, selected?.messages.length]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    router.refresh();
  }

  const filterLinks = [
    { key: "all", label: "All" },
    { key: "WHATSAPP", label: "WhatsApp" },
    { key: "SMS", label: "SMS" },
    { key: "WEBCHAT", label: "Web Chat" },
  ];

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_260px]" data-testid="inbox-page">
      {/* ---- Conversations list ---- */}
      <div className="flex flex-col rounded-lg border border-border">
        <div className="flex flex-wrap gap-1 border-b border-border p-2">
          {filterLinks.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/inbox" : `/inbox?channel=${f.key}`}
              className={cn(
                "rounded-md px-2 py-1 text-xs",
                props.channelFilter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
              data-testid={`inbox-filter-${f.key}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {props.conversations.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No conversations yet.</p>
          )}
          {props.conversations.map((c) => {
            const last = c.messages[0];
            const isActive = selected?.id === c.id;
            return (
              <Link
                key={c.id}
                href={`/inbox?id=${c.id}${props.channelFilter !== "all" ? `&channel=${props.channelFilter}` : ""}`}
                className={cn(
                  "block rounded-md border p-2 hover:border-primary/50",
                  isActive ? "border-primary bg-primary/5" : "border-transparent"
                )}
                data-testid={`conv-${c.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", CHANNELS[c.channel]?.dot ?? "bg-gray-400")} />
                    <span className="truncate text-sm font-medium">{c.contact?.name ?? c.contact?.phone ?? "Web visitor"}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.unreadCount > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{c.unreadCount}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{last?.body ?? "No messages"}</span>
                  <span className="shrink-0">{channelLabel(c.channel)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ---- Chat panel ---- */}
      <div className="flex flex-col rounded-lg border border-border">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation to start replying.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <div>
                <p className="font-medium">{selected.contact?.name ?? selected.contact?.phone ?? "Web visitor"}</p>
                <p className="text-xs text-muted-foreground">
                  {channelLabel(selected.channel)} ·{" "}
                  <span className={STATUS_STYLE[selected.status] ?? ""}>{selected.status}</span>
                  {selected.assignedAgent ? ` · AI: ${selected.assignedAgent.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Select
                  className="h-8 w-auto max-w-[150px] text-xs"
                  value={selected.assignedAgent?.id ?? ""}
                  data-testid="inbox-agent-select"
                  onChange={async (e) => {
                    const agentId = e.target.value || null;
                    await run("assign", () => assignAgentAction({ conversationId: selected.id, agentId }));
                  }}
                >
                  <option value="">No AI agent</option>
                  {props.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
                <Button
                  size="sm" variant="outline"
                  disabled={busy}
                  onClick={() => run("toggle", () => toggleAiAction(selected.id))}
                  title={selected.aiEnabled ? "AI auto-reply is ON — click to pause" : "AI auto-reply is OFF — click to resume"}
                  data-testid="inbox-ai-toggle"
                >
                  <Bot className={cn("mr-1 h-3.5 w-3.5", selected.aiEnabled ? "text-green-500" : "text-muted-foreground")} />
                  AI {selected.aiEnabled ? "ON" : "OFF"}
                </Button>
              </div>
            </div>

            {error && <p className="border-b border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {selected.messages.map((m) => (
                <div key={m.id} className={cn("flex", m.direction === "inbound" ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg border p-2 text-sm",
                      m.direction === "inbound"
                        ? "bg-muted"
                        : m.senderType === "ai"
                          ? "bg-primary/10 border-primary/30"
                          : "bg-primary text-primary-foreground"
                    )}
                    data-testid={`msg-${m.id}`}
                  >
                    <p className="text-[10px] text-muted-foreground">
                      {m.senderType === "ai" ? "🤖 AI" : m.senderType === "agent" ? "👤 Agent" : m.senderType === "system" ? "⚙️ System" : "Contact"}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="flex items-center gap-2 border-t border-border p-3">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy && draft.trim()) {
                    run("reply", () => replyToConversationAction({ conversationId: selected.id, body: draft.trim() }));
                    setDraft("");
                  }
                }}
                placeholder={`Reply as human on ${channelLabel(selected.channel)}...`}
                data-testid="inbox-reply-input"
              />
              <Button
                size="icon" disabled={busy || !draft.trim()}
                onClick={() => {
                  run("reply", () => replyToConversationAction({ conversationId: selected.id, body: draft.trim() }));
                  setDraft("");
                }}
                data-testid="inbox-reply-send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ---- Contact panel ---- */}
      <div className="hidden flex-col rounded-lg border border-border p-3 lg:flex">
        {!selected ? (
          <p className="text-sm text-muted-foreground">Contact details will appear here.</p>
        ) : (
          <>
            <p className="text-sm font-medium">{selected.contact?.name ?? "Web visitor"}</p>
            {selected.contact?.phone && (
              <div className="mt-2 space-y-2 text-sm">
                <p className="font-mono text-xs text-muted-foreground">{selected.contact.phone}</p>
                <a href={`tel:${selected.contact.phone}`}>
                  <Button size="sm" variant="outline" className="w-full"><PhoneCall className="mr-1 h-3.5 w-3.5" /> Call</Button>
                </a>
              </div>
            )}
            {selected.contact && (
              <Link
                href={`/contacts/${encodeURIComponent(selected.contact.phone)}`}
                className="mt-3 text-xs text-primary hover:underline"
              >
                Full contact profile →
              </Link>
            )}
            {selected.contact?.attributes && (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {Object.entries(selected.contact.attributes as Record<string, unknown>).map(([k, v]) => (
                  <p key={k}><span className="text-foreground">{k}:</span> {String(v)}</p>
                ))}
              </div>
            )}
            <div className="mt-auto space-y-2 border-t pt-3">
              <Button
                size="sm" variant="outline" className="w-full" disabled={busy}
                onClick={() => run("resolve", () => setConversationStatusAction({ conversationId: selected.id, status: "RESOLVED" }))}
                data-testid="inbox-resolve"
              >
                Mark resolved
              </Button>
              <Button
                size="sm" variant="ghost" className="w-full" disabled={busy}
                onClick={() => run("archive", () => setConversationStatusAction({ conversationId: selected.id, status: "ARCHIVED" }))}
                data-testid="inbox-archive"
              >
                Archive
              </Button>
              {selected.status === "RESOLVED" && (
                <Button
                  size="sm" variant="ghost" className="w-full" disabled={busy}
                  onClick={() => run("reopen", () => setConversationStatusAction({ conversationId: selected.id, status: "OPEN" }))}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reopen
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
