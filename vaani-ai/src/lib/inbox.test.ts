import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAiReply } from "./inbox";

describe("mockAiReply (INBOX_AI_DRY_RUN deterministic reply)", () => {
  it("greets on hello", () => {
    expect(mockAiReply("Hello!")).toMatch(/help you/i);
  });

  it("asks for details on price questions", () => {
    const r = mockAiReply("What is the price?");
    expect(r).toMatch(/quote|details/i);
  });

  it("offers human handoff on explicit request", () => {
    expect(mockAiReply("I want to talk to a human")).toMatch(/team member|human/i);
  });

  it("acknowledges thanks", () => {
    expect(mockAiReply("Thank you so much")).toMatch(/welcome/i);
  });

  it("has a generic fallback for anything else", () => {
    expect(mockAiReply("zzz qqq")).toMatch(/team will get back|details/i);
  });
});

describe("dry-run env helpers for channel sends", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sendChannelMessage returns simulated under VAANI_DRY_RUN", async () => {
    vi.stubEnv("VAANI_DRY_RUN", "true");
    const { sendChannelMessage } = await import("./inbox");
    const r = await sendChannelMessage({ channel: "SMS", to: "+919812345678", body: "hi" });
    expect(r.ok).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.providerMessageId).toBeNull();
  });

  it("sendChannelMessage no-ops for WEBCHAT (SSE push is the delivery)", async () => {
    vi.stubEnv("VAANI_DRY_RUN", "false");
    const { sendChannelMessage } = await import("./inbox");
    const r = await sendChannelMessage({ channel: "WEBCHAT", to: "session-1", body: "hi" });
    expect(r.ok).toBe(true);
    expect(r.simulated).toBeUndefined();
  });
});
