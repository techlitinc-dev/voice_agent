/** Sarvam Bulbul v3 voice catalogue + supported languages + curated OpenRouter LLMs.
 *  Everything voice/LLM-related in the UI is data-driven from this file. */

export const SUPPORTED_LANGUAGES = [
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "mr", label: "Marathi" },
  { code: "od", label: "Odia" },
  { code: "pa", label: "Punjabi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "gu", label: "Gujarati" },
  { code: "en-IN", label: "English (India)" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => [l.code, l.label]),
);

/** Saarika auto-detect sentinel: languageCode "unknown" (readme §4.2). */
export const AUTO_DETECT_LANGUAGE_CODE = "unknown";

export type SarvamVoice = {
  id: string; // Bulbul v3 speaker id (lowercase)
  gender: "female" | "male";
  /** Every Bulbul v3 voice speaks all 11 languages; bestFor is the UI's
   *  recommendation tag for the per-language default mapping. */
  bestFor: LanguageCode[];
};

function v(id: string, gender: "female" | "male", bestFor: LanguageCode[] = []): SarvamVoice {
  return { id, gender, bestFor };
}

/** The 39 Bulbul v3 speakers. */
export const SARVAM_VOICES: SarvamVoice[] = [
  v("anushka", "female", ["hi", "en-IN"]),
  v("abhilash", "male", ["hi"]),
  v("manisha", "female", ["hi", "en-IN"]),
  v("vidya", "female", ["hi", "en-IN"]),
  v("arya", "female", ["hi"]),
  v("karun", "male", ["hi"]),
  v("hitesh", "male", ["hi"]),
  v("arvind", "male", ["hi", "en-IN"]),
  v("shubh", "male", ["hi"]),
  v("aditya", "male", ["hi"]),
  v("ritu", "female", ["hi"]),
  v("priya", "female", ["hi"]),
  v("neha", "female", ["hi", "mr"]),
  v("rahul", "male", ["hi", "en-IN"]),
  v("pooja", "female", ["hi"]),
  v("rohan", "male", ["hi"]),
  v("simran", "female", ["pa"]),
  v("kavya", "female", ["ta", "kn"]),
  v("amit", "male", ["hi"]),
  v("dev", "male", ["gu", "hi"]),
  v("ishita", "female", ["bn", "hi"]),
  v("shreya", "female", ["bn"]),
  v("ratan", "male", ["od", "bn"]),
  v("varun", "male", ["kn", "te"]),
  v("manan", "male", ["gu"]),
  v("sumitra", "female", ["ml"]),
  v("roopa", "female", ["kn"]),
  v("kian", "male", ["en-IN"]),
  v("nisha", "female", ["ta"]),
  v("anand", "male", ["ml", "ta"]),
  v("tara", "female", ["te"]),
  v("kabir", "male", ["mr", "hi"]),
  v("meera", "female", ["mr", "gu"]),
  v("arjun", "male", ["te", "en-IN"]),
  v("diya", "female", ["en-IN"]),
  v("vikram", "male", ["ta", "hi"]),
  v("aarti", "female", ["pa", "hi"]),
  v("kiran", "male", ["od"]),
  v("lakshmi", "female", ["te", "ta"]),
];

export function getVoice(id: string): SarvamVoice | undefined {
  return SARVAM_VOICES.find((x) => x.id === id);
}

/** Default voice for a language: first voice whose bestFor includes it, else fallback. */
export function defaultVoiceForLanguage(lang: string, fallback = "anushka"): string {
  const hit = SARVAM_VOICES.find((x) => (x.bestFor as string[]).includes(lang));
  return hit?.id ?? fallback;
}

/**
 * Resolve the voice to use for a detected language.
 * voiceMap is the per-language mapping from the agent's conversationConfig.
 * Unknown/unsupported languages fall back to the agent's primary voice.
 */
export function resolveVoiceForLanguage(
  voiceMap: Record<string, string> | null | undefined,
  detectedLang: string | null | undefined,
  fallbackVoiceId: string,
): string {
  if (detectedLang && voiceMap && voiceMap[detectedLang]) {
    const id = voiceMap[detectedLang];
    if (getVoice(id)) return id;
  }
  return fallbackVoiceId;
}

// ---------- Language modes ----------

export const LANGUAGE_MODES = [
  {
    id: "auto",
    label: "Auto-detect (recommended) — Saarika languageCode: unknown",
  },
  { id: "fixed", label: "Fixed language" },
  { id: "caller-select", label: 'Caller chooses ("Hindi ke liye 1 dabaiye")' },
] as const;

export type LanguageMode = (typeof LANGUAGE_MODES)[number]["id"];

// ---------- Curated OpenRouter LLM list ----------

export type LlmTier = "floor" | "balanced" | "nitro" | "premium";

export type LlmOption = {
  id: string; // exact OpenRouter model id (may carry :floor / :nitro suffix)
  label: string;
  tier: LlmTier;
  useFor: string;
};

export const LLM_MODELS: LlmOption[] = [
  {
    id: "deepseek/deepseek-chat:floor",
    label: "DeepSeek Chat (:floor)",
    tier: "floor",
    useFor: "Cheapest — simple FAQ / reminder / confirmation agents",
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct:floor",
    label: "Llama 3.1 8B (:floor)",
    tier: "floor",
    useFor: "Cheap — short scripted calls, surveys",
  },
  {
    id: "meta-llama/llama-3.1-70b-instruct",
    label: "Llama 3.1 70B (default)",
    tier: "balanced",
    useFor: "Balanced cost/quality — receptionists, qualifiers",
  },
  {
    id: "google/gemini-flash-1.5",
    label: "Gemini Flash 1.5",
    tier: "balanced",
    useFor: "Fast, strong Hinglish/code-mixing",
  },
  {
    id: "google/gemini-flash-1.5:nitro",
    label: "Gemini Flash 1.5 (:nitro)",
    tier: "nitro",
    useFor: "Latency-sensitive calls (<800ms budget)",
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    label: "Claude 3.5 Sonnet",
    tier: "premium",
    useFor: "Premium — complex sales / negotiation conversations",
  },
  {
    id: "openai/gpt-4o:nitro",
    label: "GPT-4o (:nitro)",
    tier: "nitro",
    useFor: "Premium + low latency",
  },
];

export function getLlm(id: string): LlmOption | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

/** Failover chain for a chosen model (readme §4.2: automatic failover if a provider
 *  rate-limits). Guide 04 configured OpenRouter inside Dograh; this chain is passed
 *  per-node by the workflow builder (guide 04 owns the mechanism — we consume it). */
export function llmFallbackChain(primaryId: string): string[] {
  const chain: string[] = [primaryId];
  if (primaryId !== "meta-llama/llama-3.1-70b-instruct") {
    chain.push("meta-llama/llama-3.1-70b-instruct");
  }
  if (primaryId !== "google/gemini-flash-1.5") chain.push("google/gemini-flash-1.5");
  if (primaryId !== "deepseek/deepseek-chat:floor") chain.push("deepseek/deepseek-chat:floor");
  return chain;
}
