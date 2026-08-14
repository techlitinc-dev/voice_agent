import { describe, expect, it } from "vitest";
import {
  validateVoiceSample,
  voiceStorageKey,
  voiceContentType,
  cloneVoiceElevenLabs,
  cloneVoicePlayHT,
  synthesizeWithClone,
  VOICE_SAMPLE_MAX_BYTES,
} from "./voice-cloning";

describe("validateVoiceSample", () => {
  it("accepts mp3/wav within size range", () => {
    expect(validateVoiceSample("sample.mp3", 1_000_000)).toEqual({ ok: true });
    expect(validateVoiceSample("voice.wav", 500_000)).toEqual({ ok: true });
  });

  it("rejects wrong extensions", () => {
    const r = validateVoiceSample("sample.ogg", 1_000_000);
    expect(r.ok).toBe(false);
  });

  it("rejects oversize and empty samples", () => {
    expect(validateVoiceSample("a.mp3", VOICE_SAMPLE_MAX_BYTES + 1).ok).toBe(false);
    expect(validateVoiceSample("a.mp3", 0).ok).toBe(false);
    expect(validateVoiceSample("a.mp3", 10_000).ok).toBe(false); // too short for 30s+
  });
});

describe("voiceStorageKey / voiceContentType", () => {
  it("builds a namespaced key and mime type", () => {
    const key = voiceStorageKey("ws-1", "voice-1", "sample", "My Sample.mp3");
    expect(key).toContain("ws-1/voices/voice-1/sample-");
    expect(key.endsWith(".mp3")).toBe(true);
    expect(voiceContentType("x.wav")).toBe("audio/wav");
    expect(voiceContentType("x.mp3")).toBe("audio/mpeg");
  });
});

describe("cloneVoiceElevenLabs (dry-run default)", () => {
  it("returns a deterministic fake id without an API key", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    process.env.VOICE_CLONE_DRY_RUN = "true";
    const id = await cloneVoiceElevenLabs(Buffer.from("fake-audio"), "Brand Voice");
    expect(id).toMatch(/^dry-elevenlabs-brand-voice$/);
  });
});

describe("cloneVoicePlayHT (dry-run default)", () => {
  it("returns a fake id without credentials", async () => {
    delete process.env.PLAYHT_USER_ID;
    delete process.env.PLAYHT_API_KEY;
    process.env.VOICE_CLONE_DRY_RUN = "true";
    const id = await cloneVoicePlayHT("https://example.com/sample.mp3", "CEO Voice");
    expect(id).toMatch(/^dry-playht-ceo-voice$/);
  });
});

describe("synthesizeWithClone", () => {
  it("returns provider routing when the voice is ready", async () => {
    const r = await synthesizeWithClone({ provider: "elevenlabs", clonedVoiceId: "el-1", language: "hi" });
    expect(r).toEqual({ provider: "elevenlabs", voiceId: "el-1", language: "hi" });
  });

  it("throws when the voice has no provider id", async () => {
    await expect(synthesizeWithClone({ provider: "elevenlabs", clonedVoiceId: null, language: "hi" })).rejects.toThrow();
  });
});
