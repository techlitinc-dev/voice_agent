"use client";

import { NEGATIVE_LABELS } from "@/lib/sentiment";

export type SentimentEntry = {
  id: string;
  speaker: "AGENT" | "CALLER" | "SYSTEM";
  text: string;
  timestampMs: number;
  sentiment: string | null;
  sentimentScore: number | null;
};

/** Bubble styling per sentiment label (docs/new-features/02 §3.2). */
const sentimentColors: Record<string, string> = {
  positive: "bg-green-50 border-green-200 text-green-900",
  neutral: "bg-muted border-border",
  negative: "bg-red-50 border-red-200 text-red-900",
  angry: "bg-red-100 border-red-300 text-red-900",
  frustrated: "bg-amber-50 border-amber-200 text-amber-900",
  joyful: "bg-emerald-50 border-emerald-200 text-emerald-900",
};

/** Color-coded transcript bubbles (docs/new-features/02 §3.2). */
export function SentimentTranscript({ entries }: { entries: SentimentEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No transcript captured.</p>;
  }
  return (
    <div className="space-y-2" data-testid="sentiment-transcript">
      {entries.map((t) => {
        const bubble = t.sentiment ? sentimentColors[t.sentiment] : "bg-muted border-border";
        const negative = t.sentiment ? NEGATIVE_LABELS.has(t.sentiment) : false;
        return (
          <div key={t.id} className={t.speaker === "CALLER" ? "text-left" : "text-right"}>
            <div className={`inline-block max-w-[85%] rounded-lg border p-3 text-sm ${bubble}`}>
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-70">
                {t.speaker === "AGENT" ? "AI Agent" : t.speaker === "CALLER" ? "Caller" : "System"}
                {negative ? " · ⚠" : ""}
              </span>
              {t.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
