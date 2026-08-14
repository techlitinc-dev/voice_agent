"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setLiveModeAction,
  setWhisperAction,
  releaseLiveAction,
} from "@/server/actions/live";

type LiveCall = {
  id: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  direction: string;
  agentName: string;
  startedAt: string;
  mode: string;
  whisperContext: string | null;
  transcript: { speaker: string; text: string }[];
};

const POLL_MS = 5000;

export function LiveDashboard() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [whisperDrafts, setWhisperDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/live/calls", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setCalls(json.calls);
      else setError(json.error ?? "failed to load");
    } catch {
      setError("network error");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  async function act(callId: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    const r = await fn();
    if (!r.ok) setError(r.error ?? "action failed");
    else setError(null);
    await refresh();
  }

  return (
    <div className="space-y-4" data-testid="live-dashboard">
      {error && <p className="text-sm text-red-500" data-testid="live-error">{error}</p>}
      {calls.length === 0 && (
        <p className="text-muted-foreground" data-testid="live-empty">
          No active calls right now.
        </p>
      )}
      {calls.map((c) => (
        <Card key={c.id} data-testid="live-call-row">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/live/${c.id}`}
                className="font-mono font-semibold underline-offset-4 hover:underline"
                data-testid="live-call-link"
              >
                {c.fromNumber}
              </Link>
              <span className="text-sm text-muted-foreground">→ {c.toNumber}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{c.status}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">mode: {c.mode}</span>
              <span className="text-xs text-muted-foreground">{c.agentName}</span>
              <div className="ml-auto flex gap-2">
                <Button asChild size="sm" variant="outline" data-testid="live-open-coach">
                  <Link href={`/live/${c.id}`}>
                    Coach <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button size="sm" variant="outline" data-testid="live-listen-btn"
                  onClick={() => act(c.id, () => setLiveModeAction(c.id, "LISTEN"))}>
                  Listen
                </Button>
                <Button size="sm" variant="outline" data-testid="live-barge-btn"
                  onClick={() => act(c.id, () => setLiveModeAction(c.id, "BARGE"))}>
                  Barge
                </Button>
                <Button size="sm" variant="outline" data-testid="live-takeover-btn"
                  onClick={() => act(c.id, () => setLiveModeAction(c.id, "TAKEOVER"))}>
                  Take over
                </Button>
                <Button size="sm" variant="ghost" data-testid="live-release-btn"
                  onClick={() => act(c.id, () => releaseLiveAction(c.id))}>
                  Release
                </Button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto rounded border border-border bg-card p-3"
              data-testid="live-transcript-viewer">
              {c.transcript.length === 0 && (
                <p className="text-xs text-muted-foreground">Waiting for transcript…</p>
              )}
              {c.transcript.map((t, i) => (
                <p key={i} className="text-sm">
                  <span className="font-semibold">{t.speaker === "AGENT" ? "AI" : t.speaker}:</span> {t.text}
                </p>
              ))}
            </div>

            {c.whisperContext && (
              <p className="text-xs text-amber-500" data-testid="live-whisper-active">
                Whisper active: {c.whisperContext}
              </p>
            )}

            <div className="flex gap-2">
              <Input
                placeholder="Whisper coaching text (shown to human on takeover)"
                value={whisperDrafts[c.id] ?? ""}
                onChange={(e) => setWhisperDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                data-testid="live-whisper-input"
              />
              <Button size="sm" data-testid="live-whisper-send"
                onClick={() =>
                  act(c.id, () => setWhisperAction(c.id, whisperDrafts[c.id] ?? ""))
                }>
                Whisper
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
