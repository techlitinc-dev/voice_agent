/**
 * LLM QA scorer (spec §8). Scores one call transcript against a rubric via
 * OpenRouter (direct fetch, cheap model). QA_DRY_RUN=true (default) returns a
 * deterministic mock — used by tests and dev, costs nothing.
 */
import { maxScore, type QaRubric } from "./rubrics";

export type QaResult = {
  scores: Record<string, number>;
  totalScore: number;
  maxScore: number;
  notes: string;
  hallucination: boolean;
  hallucinationNotes: string | null;
};

/** Prompt sent to the scorer model. Asks for STRICT JSON only. */
export function buildQaPrompt(rubric: QaRubric, transcript: string): string {
  const criteria = rubric.criteria
    .map((c) => `- "${c.key}" (0-${c.maxPoints}): ${c.instruction}`)
    .join("\n");
  return `You are a call-quality auditor. Score the call transcript below against each rubric criterion.

Rubric: ${rubric.name} — ${rubric.description}
Criteria:
${criteria}

Also decide "hallucination": true if the agent stated ANY fact not present or not reasonably inferable from the transcript itself (invented prices, timings, policies, names, commitments).

Rules:
- Integer scores only, each within its stated range.
- Be strict: a missing mandatory line is a 0 for that criterion.
- Respond with STRICT JSON, no prose, no markdown fences, exactly this shape:
{"scores": {"${rubric.criteria.map((c) => c.key).join('": 0, "')}": 0}, "notes": "one or two sentences", "hallucination": false, "hallucination_notes": null}

Transcript:
"""
${transcript.slice(0, 6000)}
"""`;
}

/** Extract the first {...} JSON object from an LLM response (tolerates fences/prose). */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse and CLAMP the scorer's JSON against the rubric. Returns null when the
 * response is unusable (caller retries/marks unscored).
 */
export function parseQaResponse(text: string, rubric: QaRubric): QaResult | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const rawScores = (obj.scores ?? {}) as Record<string, unknown>;
  const scores: Record<string, number> = {};
  let total = 0;
  for (const c of rubric.criteria) {
    const v = Number(rawScores[c.key]);
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(c.maxPoints, Math.round(v))) : 0;
    scores[c.key] = clamped;
    total += clamped;
  }
  return {
    scores,
    totalScore: total,
    maxScore: maxScore(rubric),
    notes: typeof obj.notes === "string" ? obj.notes.slice(0, 500) : "",
    hallucination: obj.hallucination === true,
    hallucinationNotes:
      typeof obj.hallucination_notes === "string" ? obj.hallucination_notes.slice(0, 500) : null,
  };
}

/** Deterministic mock for QA_DRY_RUN — full marks minus 1 per criterion, no hallucination. */
export function mockScore(rubric: QaRubric): QaResult {
  const scores: Record<string, number> = {};
  let total = 0;
  for (const c of rubric.criteria) {
    scores[c.key] = Math.max(0, c.maxPoints - 1);
    total += scores[c.key];
  }
  return {
    scores,
    totalScore: total,
    maxScore: maxScore(rubric),
    notes: "DRY-RUN mock score (QA_DRY_RUN=true).",
    hallucination: false,
    hallucinationNotes: null,
  };
}

/** Score a transcript with the real LLM (OpenRouter). Throws on HTTP failure. */
export async function scoreWithLlm(rubric: QaRubric, transcript: string): Promise<QaResult> {
  if (process.env.QA_DRY_RUN !== "false") return mockScore(rubric);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const model = process.env.QA_SCORER_MODEL ?? "meta-llama/llama-3.1-8b-instruct";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "user", content: buildQaPrompt(rubric, transcript) }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseQaResponse(content, rubric);
  if (!parsed) throw new Error("scorer returned unparseable JSON");
  return parsed;
}
