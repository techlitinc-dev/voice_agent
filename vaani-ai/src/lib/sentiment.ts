/**
 * Sentiment & emotion analytics (docs/new-features/02).
 *
 * Pure helpers + LLM classification. The classification call follows the QA
 * scorer pattern (OpenRouter, temperature 0, dry-run mock in dev) and the
 * timeline/trend math is deterministic so Vitest can pin it exactly.
 */

export const SENTIMENT_LABELS = [
  "positive",
  "neutral",
  "negative",
  "angry",
  "frustrated",
  "joyful",
] as const;

export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

export function isSentimentLabel(v: unknown): v is SentimentLabel {
  return typeof v === "string" && (SENTIMENT_LABELS as readonly string[]).includes(v);
}

export type SentimentPoint = { ts: number; score: number; label: string };

// Sentiment labels that score below the neutral 0 baseline. Used for UI colors
// and for the real-time escalation check.
export const NEGATIVE_LABELS = new Set<string>(["negative", "angry", "frustrated"]);

/** Deterministic mock for SENTIMENT_DRY_RUN — scores the caller's turn by keyword heuristics. */
export function mockClassify(text: string): { label: SentimentLabel; score: number } {
  const t = text.toLowerCase();
  if (/\b(angry|furious|terrible|worst|useless|appalling)\b/.test(t)) return { label: "angry", score: -0.85 };
  if (/\b(frustrated|annoying|annoyed|fed up|sick of|waste of time|not happy|dissatisfied)\b/.test(t))
    return { label: "frustrated", score: -0.6 };
  if (/\b(no|not interested|don't want|do not want|cancel|refund|complaint|problem)\b/.test(t))
    return { label: "negative", score: -0.4 };
  if (/\b(great|love|amazing|excellent|thank|happy|wonderful|perfect)\b/.test(t))
    return { label: "joyful", score: 0.8 };
  if (/\b(good|nice|ok|fine|yes|sure|helpful)\b/.test(t)) return { label: "positive", score: 0.35 };
  return { label: "neutral", score: 0 };
}

/**
 * Classify the emotion of one spoken turn. Returns { label, score } with score
 * in [-1, 1]. Uses OpenRouter's cheap model by default; SENTIMENT_DRY_RUN=true
 * (the default, matching QA_DRY_RUN) returns the deterministic keyword mock.
 * Never throws — the caller falls back to neutral on failure.
 */
export async function classifyEmotion(
  text: string
): Promise<{ label: SentimentLabel; score: number }> {
  if (process.env.SENTIMENT_DRY_RUN !== "false") return mockClassify(text);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return mockClassify(text);
  const model = process.env.SENTIMENT_MODEL ?? "meta-llama/llama-3.1-8b-instruct";

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Classify the emotion of the caller\'s spoken turn. Reply with ONLY JSON: ' +
              '{"label":"positive|neutral|negative|angry|frustrated|joyful","score":-1.0 to 1.0}. ' +
              "Score is the valence: strongly negative (-1) to strongly positive (+1).",
          },
          { role: "user", content: text.slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) return mockClassify(text);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { label?: unknown; score?: unknown };
    if (!isSentimentLabel(parsed.label)) return mockClassify(text);
    const score = Number(parsed.score);
    return {
      label: parsed.label,
      score: Number.isFinite(score) ? Math.max(-1, Math.min(1, score)) : 0,
    };
  } catch {
    return mockClassify(text);
  }
}

/** Average score of a timeline (0 when empty). */
export function avgScore(points: Pick<SentimentPoint, "score">[]): number {
  if (points.length === 0) return 0;
  return points.reduce((a, p) => a + p.score, 0) / points.length;
}

/** Map an average score to the coarse overall label the Call model already uses. */
export function overallLabel(avg: number): "positive" | "neutral" | "negative" {
  if (avg > 0.2) return "positive";
  if (avg < -0.2) return "negative";
  return "neutral";
}

/**
 * Linear-regression slope over the caller-turn scores. A positive slope means
 * the conversation is improving; negative means declining; near-flat = stable.
 * Thresholds are intentionally small — any real emotional arc moves them.
 */
export function computeTrend(
  points: Pick<SentimentPoint, "score">[],
  threshold = 0.01
): "improving" | "stable" | "declining" {
  const n = points.length;
  if (n < 2) return "stable";
  const xs = points.map((_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = avgScore(points);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (points[i].score - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return "stable";
  const slope = num / den;
  if (slope > threshold) return "improving";
  if (slope < -threshold) return "declining";
  return "stable";
}

/** Build the per-call sentiment summary from a set of (already-classified) caller turns. */
export function summarizeSentiment(
  points: SentimentPoint[]
): { overall: "positive" | "neutral" | "negative"; trend: "improving" | "stable" | "declining" } {
  const avg = avgScore(points);
  return { overall: overallLabel(avg), trend: computeTrend(points) };
}
