"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LiveStats = {
  liveCalls: number;
  concurrency: number;
  asrToday: number;
  ahtToday: number;
  callsToday: number;
  burnPaisePerMin: number;
  at: string;
};

type StreamPayload = {
  calls: { id: string; fromNumber: string; toNumber: string; status: string; agentName: string; startedAt: string }[];
  queueDepth: number;
  error?: string;
};

function inr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function LiveTiles() {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/internal/live-stats", { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: LiveStats };
        if (!cancelled && json.ok && json.data) setStats(json.data);
      } catch {
        /* keep last good stats; next tick retries */
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Real-time active calls via SSE (guide 01 §5.1), with 5s polling fallback.
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    function apply(payload: StreamPayload) {
      if (cancelled) return;
      if (payload.error) return;
      setQueueDepth(payload.queueDepth);
      setStats((prev) =>
        prev ? { ...prev, liveCalls: payload.calls.length, concurrency: payload.calls.length, at: new Date().toISOString() } : prev
      );
    }

    async function poll() {
      try {
        const res = await fetch("/api/internal/dashboard/stream", { cache: "no-store" });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // We never cancel mid-read in the fallback path; this poll is best-effort.
        // eslint-disable-next-line no-constant-condition
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try { apply(JSON.parse(line.slice(6)) as StreamPayload); } catch { /* skip malformed frame */ }
          }
        }
      } catch {
        /* fallback poll failed; next interval retries */
      }
    }

    try {
      es = new EventSource("/api/internal/dashboard/stream");
      es.onmessage = (e) => {
        try { apply(JSON.parse(e.data) as StreamPayload); } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do here.
      };
    } catch {
      // SSE unavailable (e.g. some proxy setups): fall back to fetch-stream polling.
      poll();
      const t = setInterval(poll, 5000);
      cancelled = true; // stop the initial poll after one read cycle
      return () => clearInterval(t);
    }

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  const tiles: Array<{ id: string; label: string; value: string; accent?: boolean }> = [
    { id: "live-calls", label: "Calls in progress", value: String(stats?.liveCalls ?? "—"), accent: (stats?.liveCalls ?? 0) > 0 },
    { id: "concurrency", label: "Current concurrency", value: String(stats?.concurrency ?? "—") },
    { id: "queue", label: "Calls waiting (queue)", value: String(queueDepth ?? "—"), accent: (queueDepth ?? 0) > 0 },
    { id: "asr", label: "ASR today", value: stats ? `${stats.asrToday}%` : "—" },
    { id: "aht", label: "AHT today", value: stats ? `${stats.ahtToday}s` : "—" },
    { id: "burn", label: "Cost/min (rolling hour)", value: stats ? inr(stats.burnPaisePerMin) : "—" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" data-testid="live-tiles">
      {tiles.map((t) => (
        <Card key={t.id} data-testid={`dash-tile-${t.id}`}>
          <CardHeader><CardTitle className="text-sm">{t.label}</CardTitle></CardHeader>
          <CardContent className={`text-3xl font-bold ${t.accent ? "text-primary" : ""}`}>{t.value}</CardContent>
        </Card>
      ))}
    </div>
  );
}
