import { describe, expect, it } from "vitest";
import { canTransitionLiveMode, validateWhisperText, WHISPER_MAX_LEN } from "../src/lib/liveState";

describe("canTransitionLiveMode", () => {
  it("NONE can go anywhere", () => {
    for (const to of ["LISTEN", "WHISPER", "BARGE", "TAKEOVER"] as const) {
      expect(canTransitionLiveMode("NONE", to)).toBe(true);
    }
  });
  it("WHISPER can escalate to BARGE/TAKEOVER or release", () => {
    expect(canTransitionLiveMode("WHISPER", "BARGE")).toBe(true);
    expect(canTransitionLiveMode("WHISPER", "TAKEOVER")).toBe(true);
    expect(canTransitionLiveMode("WHISPER", "NONE")).toBe(true);
  });
  it("WHISPER cannot go back to LISTEN", () => {
    expect(canTransitionLiveMode("WHISPER", "LISTEN")).toBe(false);
  });
  it("BARGE can only escalate to TAKEOVER or release", () => {
    expect(canTransitionLiveMode("BARGE", "TAKEOVER")).toBe(true);
    expect(canTransitionLiveMode("BARGE", "NONE")).toBe(true);
    expect(canTransitionLiveMode("BARGE", "WHISPER")).toBe(false);
    expect(canTransitionLiveMode("BARGE", "LISTEN")).toBe(false);
  });
  it("TAKEOVER can only release", () => {
    expect(canTransitionLiveMode("TAKEOVER", "NONE")).toBe(true);
    expect(canTransitionLiveMode("TAKEOVER", "LISTEN")).toBe(false);
  });
  it("same→same is idempotent", () => {
    expect(canTransitionLiveMode("LISTEN", "LISTEN")).toBe(true);
  });
});

describe("validateWhisperText", () => {
  it("accepts normal coaching text", () => {
    const r = validateWhisperText("Offer the 10% festival discount.");
    expect(r).toEqual({ ok: true, text: "Offer the 10% festival discount." });
  });
  it("trims whitespace", () => {
    const r = validateWhisperText("  hello  ");
    expect(r.ok && r.text).toBe("hello");
  });
  it("rejects empty/blank", () => {
    expect(validateWhisperText("   ").ok).toBe(false);
    expect(validateWhisperText("").ok).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(validateWhisperText(undefined).ok).toBe(false);
    expect(validateWhisperText(42).ok).toBe(false);
  });
  it(`rejects text over ${WHISPER_MAX_LEN} chars`, () => {
    expect(validateWhisperText("x".repeat(WHISPER_MAX_LEN + 1)).ok).toBe(false);
    expect(validateWhisperText("x".repeat(WHISPER_MAX_LEN)).ok).toBe(true);
  });
});
