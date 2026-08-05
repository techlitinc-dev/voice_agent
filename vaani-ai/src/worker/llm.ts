/**
 * Dry-run-aware post-call intelligence. CAMPAIGN_DRY_RUN=true → deterministic
 * keyword mocks (no OpenRouter, no cost); false → real OpenRouter classification
 * via src/lib/openrouter.ts + src/lib/campaign/scoring.ts.
 */
import { callOpenRouterJson } from "../lib/openrouter";
import {
  buildCallbackPrompt,
  buildInterestPrompt,
  parseCallbackRequest,
  parseInterestScore,
  type CallbackExtraction,
  type InterestScoreValue,
} from "../lib/campaign/scoring";

const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false";
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export async function classifyInterest(input: {
  transcript: string;
  campaignType: string;
}): Promise<{ score: InterestScoreValue; reason: string } | null> {
  if (DRY_RUN) {
    const t = input.transcript.toLowerCase();
    const out = /book|yes|interested|demo|sign ?up|payment done/.test(t)
      ? { score: "HOT" as const, reason: "dry-run mock: positive intent keywords" }
      : /not interested|no thanks|wrong number/.test(t)
        ? { score: "COLD" as const, reason: "dry-run mock: refusal keywords" }
        : { score: "WARM" as const, reason: "dry-run mock: neutral conversation" };
    log(`[postcall] dry-run interest=${out.score}`);
    return out;
  }
  try {
    const text = await callOpenRouterJson(buildInterestPrompt(input));
    return parseInterestScore(text);
  } catch (e) {
    console.error("[postcall] interest LLM failed", e);
    return null;
  }
}

export async function extractCallback(input: {
  transcript: string;
  timezone: string;
  now: Date;
}): Promise<CallbackExtraction> {
  if (DRY_RUN) {
    if (/call me|callback|call back|tomorrow/.test(input.transcript.toLowerCase())) {
      const dueAt = new Date(input.now.getTime() + 24 * 60 * 60_000);
      log(`[postcall] dry-run callback extracted → ${dueAt.toISOString()}`);
      return { requested: true, dueAt, note: "dry-run mock: callback keyword" };
    }
    return { requested: false };
  }
  try {
    const text = await callOpenRouterJson(
      buildCallbackPrompt({ transcript: input.transcript, nowIso: input.now.toISOString(), timezone: input.timezone })
    );
    return parseCallbackRequest(text, input.now);
  } catch (e) {
    console.error("[postcall] callback LLM failed", e);
    return { requested: false };
  }
}
