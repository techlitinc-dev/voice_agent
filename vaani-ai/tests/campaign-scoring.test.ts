import { describe, expect, it } from "vitest";
import {
  buildCallbackPrompt,
  buildInterestPrompt,
  detectOptOut,
  needsHumanEscalation,
  parseCallbackRequest,
  parseInterestScore,
} from "../src/lib/campaign/scoring";

const NOW = new Date("2025-07-07T10:00:00Z"); // Monday 15:30 IST

describe("interest scoring", () => {
  it("prompt carries the campaign type and transcript", () => {
    const p = buildInterestPrompt({ transcript: "caller: yes book it", campaignType: "LEAD_QUALIFICATION" });
    expect(p.system).toContain("HOT");
    expect(p.user).toContain("LEAD_QUALIFICATION");
    expect(p.user).toContain("yes book it");
  });
  it("parses valid LLM JSON (mock)", () => {
    expect(parseInterestScore('{"score":"HOT","reason":"agreed to a demo on Friday"}'))
      .toEqual({ score: "HOT", reason: "agreed to a demo on Friday" });
    expect(parseInterestScore('{"score":"COLD","reason":"said not interested"}')?.score).toBe("COLD");
  });
  it("rejects malformed LLM output safely", () => {
    expect(parseInterestScore("not json")).toBeNull();
    expect(parseInterestScore('{"score":"LUKEWARM","reason":"x"}')).toBeNull();
    expect(parseInterestScore('{"score":"HOT"}')).toBeNull();
    expect(parseInterestScore("{}")).toBeNull();
  });
});

describe("callback extraction (mock LLM)", () => {
  it("prompt pins current time + timezone for absolute resolution", () => {
    const p = buildCallbackPrompt({ transcript: "call me tomorrow at 5", nowIso: NOW.toISOString(), timezone: "Asia/Kolkata" });
    expect(p.user).toContain("2025-07-07T10:00:00.000Z");
    expect(p.user).toContain("Asia/Kolkata");
    expect(p.system).toContain("ISO 8601");
  });
  it("accepts a valid future dueAt ('tomorrow at 5pm IST' resolved by the LLM)", () => {
    const r = parseCallbackRequest(
      '{"callbackRequested":true,"dueAt":"2025-07-08T17:00:00+05:30","note":"call me tomorrow at 5"}',
      NOW
    );
    expect(r.requested).toBe(true);
    expect(r.dueAt?.toISOString()).toBe("2025-07-08T11:30:00.000Z");
    expect(r.note).toBe("call me tomorrow at 5");
  });
  it("no callback → requested:false", () => {
    expect(parseCallbackRequest('{"callbackRequested":false,"dueAt":null,"note":null}', NOW))
      .toEqual({ requested: false });
  });
  it("rejects past dates, far-future dates, and garbage (safe default)", () => {
    expect(parseCallbackRequest('{"callbackRequested":true,"dueAt":"2025-07-06T17:00:00Z"}', NOW).requested).toBe(false);
    expect(parseCallbackRequest('{"callbackRequested":true,"dueAt":"2026-01-01T00:00:00Z"}', NOW).requested).toBe(false);
    expect(parseCallbackRequest('{"callbackRequested":true,"dueAt":"next tuesday lol"}', NOW).requested).toBe(false);
    expect(parseCallbackRequest("garbage", NOW).requested).toBe(false);
    expect(parseCallbackRequest('{"callbackRequested":true}', NOW).requested).toBe(false);
  });
});

describe("opt-out detection (§11 instant opt-out)", () => {
  it("structured outcome wins", () => {
    expect(detectOptOut({ outcome: "opt-out", transcript: null })).toBe(true);
  });
  it("catches English + Hindi phrases", () => {
    expect(detectOptOut({ transcript: "please stop calling me" })).toBe(true);
    expect(detectOptOut({ transcript: "Don't call this number again" })).toBe(true);
    expect(detectOptOut({ transcript: "मुझे कॉल मत करो" })).toBe(true);
    expect(detectOptOut({ transcript: "I want to unsubscribe from these calls" })).toBe(true);
  });
  it("does not false-positive on normal speech", () => {
    expect(detectOptOut({ transcript: "yes, tell me more about the plan" })).toBe(false);
    expect(detectOptOut({ transcript: "call me tomorrow at 5" })).toBe(false);
    expect(detectOptOut({ transcript: null, outcome: "booked" })).toBe(false);
  });
});

describe("sentiment escalation", () => {
  it("flags negative sentiment, explicit escalation, and abuse", () => {
    expect(needsHumanEscalation({ sentiment: "negative" })).toBe(true);
    expect(needsHumanEscalation({ outcome: "escalate-to-human" })).toBe(true);
    expect(needsHumanEscalation({ transcript: "this is a scam, you people are frauds" })).toBe(true);
    expect(needsHumanEscalation({ sentiment: "positive", transcript: "great, thanks" })).toBe(false);
  });
});
