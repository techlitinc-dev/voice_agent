"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ear, Mic, Radio, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { setLiveModeAction, releaseLiveAction } from "@/server/actions/live";

type TranscriptEntry = {
  id: string;
  callId: string;
  speaker: "AGENT" | "CALLER" | "SYSTEM";
  text: string;
  timestampMs: number;
  createdAt: string;
};

type LiveState = {
  status: string;
  mode: string;
  whisperContext: string | null;
};

const MODE_LABEL: Record<string, string> = {
  NONE: "Idle",
  LISTEN: "Listening",
  WHISPER: "Whispering",
  BARGE: "Barging in",
  TAKEOVER: "Takeover",
  ENDED: "Ended",
};

export default function LiveCallPage({ params }: { params: { callId: string } }) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [state, setState] = useState<LiveState>({ status: "IN_PROGRESS", mode: "NONE", whisperContext: null });
  const [whisper, setWhisper] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [alert, setAlert] = useState<{ title: string; body: string; label: string; score: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamOpen = useRef(true);

  const appendEntry = useCallback((entry: TranscriptEntry) => {
    setEntries((prev) => {
      if (prev.some((e) => e.id === entry.id)) return prev;
      return [...prev, entry];
    });
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/calls/${params.callId}/live-stream`);

    es.addEventListener("transcript", (e) => {
      try {
        appendEntry(JSON.parse((e as MessageEvent).data));
      } catch {
        /* malformed entry — ignore */
      }
    });
    es.addEventListener("state", (e) => {
      try {
        setState(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("ended", () => {
      setEnded(true);
      streamOpen.current = false;
      es.close();
    });
    es.addEventListener("alert", (e) => {
      try {
        setAlert(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      // EventSource auto-reconnects; stop trying once the call has ended.
      if (streamOpen.current === false) es.close();
    };

    return () => {
      streamOpen.current = false;
      es.close();
    };
  }, [params.callId, appendEntry]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [entries]);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    const r = await fn();
    if (!r.ok) setError(r.error ?? "action failed");
    else setError(null);
  }

  async function sendWhisper() {
    if (!whisper.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${params.callId}/whisper`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: whisper }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "failed to send whisper");
      else setWhisper("");
    } catch {
      setError("network error");
    } finally {
      setSending(false);
    }
  }

  const inProgress = !ended && state.status !== "COMPLETED" && state.status !== "FAILED";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 md:h-[calc(100vh-6rem)]" data-testid="live-call-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link href="/live">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-bold leading-tight">Live Call</h1>
            <p className="font-mono text-xs text-muted-foreground">{params.callId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {inProgress && (
            <span className="flex items-center gap-1.5 text-xs text-green-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              LIVE
            </span>
          )}
          <Badge variant={inProgress ? "success" : "secondary"} data-testid="live-mode-badge">
            {MODE_LABEL[state.mode] ?? state.mode}
          </Badge>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500" data-testid="live-error">{error}</p>
      )}

      {alert && (
        <div data-testid="live-frustration-alert"
          className="flex items-start justify-between gap-3 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          <div>
            <p className="font-semibold">{alert.title}</p>
            <p className="text-xs">{alert.body} · {alert.label} ({alert.score.toFixed(2)})</p>
          </div>
          <button className="text-xs underline" onClick={() => setAlert(null)}>Dismiss</button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1 rounded-md border" ref={scrollRef}>
        <div className="space-y-2 p-4">
          {entries.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              Waiting for transcript…
            </p>
          )}
          {entries.map((t) => (
            <div key={t.id} className={t.speaker === "CALLER" ? "text-left" : "text-right"}>
              <div
                className={
                  "inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm " +
                  (t.speaker === "CALLER"
                    ? "bg-muted text-foreground"
                    : t.speaker === "AGENT"
                      ? "bg-primary text-primary-foreground"
                      : "bg-amber-100 text-amber-800")
                }
              >
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {t.speaker === "AGENT" ? "AI Agent" : t.speaker === "CALLER" ? "Caller" : "System"}
                </span>
                {t.text}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Card>
        <CardContent className="space-y-3 p-4">
          {state.whisperContext && (
            <p className="text-xs text-amber-600" data-testid="live-whisper-active">
              Active whisper: {state.whisperContext}
            </p>
          )}
          <Textarea
            placeholder="Whisper a suggestion (inaudible to the caller)…"
            value={whisper}
            onChange={(e) => setWhisper(e.target.value)}
            rows={2}
            data-testid="live-whisper-input"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={state.mode === "LISTEN" ? "default" : "outline"} data-testid="live-listen-btn"
                onClick={() => act(() => setLiveModeAction(params.callId, "LISTEN"))}>
                <Ear className="h-4 w-4" /> Listen
              </Button>
              <Button size="sm" variant={state.mode === "WHISPER" ? "default" : "outline"} data-testid="live-barge-btn"
                onClick={sendWhisper} disabled={!whisper.trim() || sending}>
                <Mic className="h-4 w-4" /> {sending ? "Sending…" : "Send Whisper"}
              </Button>
              <Button size="sm" variant={state.mode === "BARGE" ? "default" : "outline"} data-testid="live-takeover-btn"
                onClick={() => act(() => setLiveModeAction(params.callId, "BARGE"))}>
                <Radio className="h-4 w-4" /> Barge
              </Button>
              <Button size="sm" variant="destructive" data-testid="live-takeover-2-btn"
                onClick={() => act(() => setLiveModeAction(params.callId, "TAKEOVER"))}>
                <Square className="h-4 w-4" /> Take over
              </Button>
            </div>
            <Button size="sm" variant="ghost" data-testid="live-release-btn"
              onClick={() => act(() => releaseLiveAction(params.callId))}>
              Release
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
