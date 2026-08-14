"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

export type SentimentTimelinePoint = { ts: number; score: number; label: string };

/** Format ms-from-call-start as m:ss. */
function formatMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Sentiment timeline chart (docs/new-features/02 §3.1) — the emotional arc of a call. */
export function SentimentTimeline({ timeline }: { timeline: SentimentTimelinePoint[] }) {
  const data = timeline.map((t) => ({ time: formatMs(t.ts), score: t.score, label: t.label }));
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No caller-sentiment data yet.</p>;
  }

  return (
    <div className="h-52 w-full" data-testid="sentiment-timeline-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} width={40} tick={{ fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }) =>
              active && payload && payload.length > 0 ? (
                <div className="rounded-md border border-border bg-background p-2 text-xs">
                  <p className="font-medium">{payload[0].payload.label}</p>
                  <p>Score: {Number(payload[0].payload.score).toFixed(2)}</p>
                </div>
              ) : null
            }
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={{ fill: "#8b5cf6", r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
