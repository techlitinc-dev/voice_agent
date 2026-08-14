import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SentimentTrendRow } from "@/lib/dashboard/queries";

function labelColor(label: string): string {
  if (label === "positive") return "text-green-600";
  if (label === "negative") return "text-red-600";
  return "text-muted-foreground";
}

/** Workspace sentiment trend (docs/new-features/02 §3.3) — ASCII bar per day. */
export function SentimentTrend({ data }: { data: SentimentTrendRow[] }) {
  const bars = data.slice(-14); // last 14 days
  const maxAbs = Math.max(0.5, ...bars.map((b) => Math.abs(b.avgScore)));

  return (
    <Card data-testid="sentiment-trend-widget">
      <CardHeader><CardTitle className="text-sm">Sentiment trend</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {bars.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sentiment data yet — it appears once calls are scored.
          </p>
        ) : (
          bars.map((b) => {
            // Bar width scaled so avgScore/maxAbs maps to 0..8 blocks, zero-centered.
            const blocks = Math.round((Math.abs(b.avgScore) / maxAbs) * 8);
            const bar = "█".repeat(blocks) + "░".repeat(Math.max(0, 8 - blocks));
            return (
              <div key={b.date} className="flex items-center gap-2 text-xs" data-testid="sentiment-trend-row">
                <span className="w-16 shrink-0 font-mono text-muted-foreground">{b.date.slice(5)}</span>
                <span className="font-mono">{bar}</span>
                <span className={labelColor(b.label)}>
                  {b.avgScore > 0 ? "+" : ""}{b.avgScore.toFixed(1)} ({b.label})
                </span>
                {b.label === "negative" && <span className="text-red-500">⚠</span>}
                <span className="ml-auto text-muted-foreground">{b.scoredCalls} calls</span>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
