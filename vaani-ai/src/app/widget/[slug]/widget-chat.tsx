"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ChatMsg = { id: string; body: string; senderType: string; createdAt: string };

function sessionId(): string {
  if (typeof window === "undefined") return "";
  let s = window.sessionStorage.getItem("vaani-widget-session");
  if (!s) {
    s = crypto.randomUUID();
    window.sessionStorage.setItem("vaani-widget-session", s);
  }
  return s;
}

export function WidgetChat({ workspaceSlug, workspaceName }: { workspaceSlug: string; workspaceName: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const sid = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sid.current = sessionId();
    const es = new EventSource(`/api/widget/stream?workspace=${workspaceSlug}&sessionId=${sid.current}`);
    es.addEventListener("history", (e) => {
      try {
        const msgs = JSON.parse((e as MessageEvent).data) as ChatMsg[];
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...msgs.filter((m) => !seen.has(m.id))];
        });
      } catch { /* ignore malformed */ }
    });
    es.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data) as ChatMsg;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      } catch { /* ignore */ }
    });
    es.onerror = () => es.close(); // reconnect handled by the browser
    return () => es.close();
  }, [workspaceSlug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setInput("");
    // Optimistically append the user's own message.
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, body, senderType: "contact", createdAt: new Date().toISOString() }]);
    try {
      await fetch("/api/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: workspaceSlug, sessionId: sid.current, body }),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex h-[560px] w-full max-w-sm flex-col" data-testid="webchat-widget">
      <CardHeader className="border-b">
        <CardTitle className="text-base">{workspaceName} — Chat with us</CardTitle>
        <p className="text-xs text-muted-foreground">We typically reply in a few minutes.</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderType === "contact" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg border p-2 text-sm ${
                m.senderType === "contact" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {m.body}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </CardContent>
      <div className="flex gap-2 border-t p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message..."
          data-testid="webchat-input"
        />
        <Button size="icon" onClick={send} disabled={sending || !input.trim()} data-testid="webchat-send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
