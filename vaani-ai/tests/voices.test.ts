import { describe, expect, it } from "vitest";
import {
  SARVAM_VOICES,
  SUPPORTED_LANGUAGES,
  resolveVoiceForLanguage,
  defaultVoiceForLanguage,
  llmFallbackChain,
  LLM_MODELS,
  getVoice,
} from "../src/lib/voices";
import { AGENT_TEMPLATES } from "../src/lib/templates";

describe("voice catalogue", () => {
  it("has 39 unique voices", () => {
    expect(SARVAM_VOICES.length).toBe(39);
    expect(new Set(SARVAM_VOICES.map((v) => v.id)).size).toBe(39);
  });

  it("every template references a real voice and a real LLM", () => {
    for (const t of AGENT_TEMPLATES) {
      expect(getVoice(t.suggestedVoice), t.code).toBeDefined();
      expect(LLM_MODELS.some((m) => m.id === t.suggestedLlm), t.code).toBeDefined();
    }
  });

  it("11 supported languages", () => {
    expect(SUPPORTED_LANGUAGES.length).toBe(11);
  });
});

describe("resolveVoiceForLanguage", () => {
  it("uses the map for known languages, falls back otherwise", () => {
    const map = { ta: "kavya", hi: "ritu" };
    expect(resolveVoiceForLanguage(map, "ta", "anushka")).toBe("kavya");
    expect(resolveVoiceForLanguage(map, "bn", "anushka")).toBe("anushka");
    expect(resolveVoiceForLanguage(null, "ta", "anushka")).toBe("anushka");
    expect(resolveVoiceForLanguage(map, null, "anushka")).toBe("anushka");
    // garbage ids in the map are ignored
    expect(resolveVoiceForLanguage({ ta: "not-a-voice" }, "ta", "anushka")).toBe("anushka");
  });

  it("defaultVoiceForLanguage always returns a catalogue voice", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      expect(getVoice(defaultVoiceForLanguage(l.code))).toBeDefined();
    }
  });
});

describe("llmFallbackChain", () => {
  it("always includes the floor model and never duplicates", () => {
    for (const m of LLM_MODELS) {
      const chain = llmFallbackChain(m.id);
      expect(chain[0]).toBe(m.id);
      expect(chain).toContain("deepseek/deepseek-chat:floor");
      expect(chain).toContain("meta-llama/llama-3.1-70b-instruct");
      expect(new Set(chain).size).toBe(chain.length);
    }
  });
});
