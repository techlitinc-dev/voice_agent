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

function inr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function LiveTiles() {
  const [stats, setStats] = useState<LiveStats | null>(null);

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

  const tiles: Array<{ id: string; label: string; value: string; accent?: boolean }> = [
    { id: "live-calls", label: "Calls in progress", value: String(stats?.liveCalls ?? "—"), accent: (stats?.liveCalls ?? 0) > 0 },
    { id: "concurrency", label: "Current concurrency", value: String(stats?.concurrency ?? "—") },
    { id: "asr", label: "ASR today", value: stats ? `${stats.asrToday}%` : "—" },
    { id: "aht", label: "AHT today", value: stats ? `${stats.ahtToday}s` : "—" },
    { id: "burn", label: "Cost/min (rolling hour)", value: stats ? inr(stats.burnPaisePerMin) : "—" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="live-tiles">
      {tiles.map((t) => (
        <Card key={t.id} data-testid={`dash-tile-${t.id}`}>
          <CardHeader><CardTitle className="text-sm">{t.label}</CardTitle></CardHeader>
          <CardContent className={`text-3xl font-bold ${t.accent ? "text-primary" : ""}`}>{t.value}</CardContent>
        </Card>
      ))}
    </div>
  );
}
