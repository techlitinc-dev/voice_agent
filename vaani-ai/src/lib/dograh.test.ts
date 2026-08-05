import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const SECRET = "test-secret-123";
const TRIGGER_OK = { status: "queued", workflow_run_id: 42, workflow_run_name: "r-42" };

async function load() {
  vi.resetModules();
  process.env.APP_URL = "https://app.test";
  process.env.DOGRAH_WEBHOOK_SECRET = SECRET;
  process.env.DOGRAH_RETRY_DELAY_MS = "1"; // fast tests
  return await import("./dograh");
}

function fakeResponse(status: number, json: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => (typeof json === "string" ? json : JSON.stringify(json)),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildWorkflowDefinition", () => {
  it("emits startCall → agentNode → endCall with webhook present but disconnected", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "You are A.", maxCallSeconds: 300,
    });
    // Node ids: start-1, agent-1, webhook-1, end-1 all present.
    expect(def.nodes.map((n) => n.id)).toEqual(["start-1", "agent-1", "webhook-1", "end-1"]);
    expect(def.nodes.filter((n) => n.type === "startCall")).toHaveLength(1);
    // Live Dograh 1.44.0 graph constraints: webhook is terminal (0 in / 0 out).
    // Conversation flow: start -> agent -> end.
    expect(def.edges.map((e) => [e.source, e.target])).toEqual([
      ["start-1", "agent-1"],
      ["agent-1", "end-1"],
    ]);
    // No edge touches the webhook node.
    for (const e of def.edges) {
      expect(e.source).not.toBe("webhook-1");
      expect(e.target).not.toBe("webhook-1");
    }
  });

  it("default LLM chain: 3 entries, primary first, :nitro/:floor suffixes applied", async () => {
    const { buildWorkflowDefinition, DEFAULT_LLM_CHAIN } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "You are A.", maxCallSeconds: 300,
    });
    const agent = def.nodes.find((n) => n.id === "agent-1");
    expect(agent?.data.primary_llm_model).toBe(DEFAULT_LLM_CHAIN[0].model);
    expect(agent?.data.llm_chain).toEqual([
      { model: "meta-llama/llama-3.1-70b-instruct" },
      { model: "meta-llama/llama-3.1-8b-instruct:nitro" },
      { model: "deepseek/deepseek-chat:floor" },
    ]);
  });

  it("custom llmChain is preserved in order with variant suffixes", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "You are A.", maxCallSeconds: 300,
      llmChain: [
        { model: "openai/gpt-4o-mini", variant: "nitro" },
        { model: "qwen/qwen-2.5-72b-instruct" },
      ],
    });
    const agent = def.nodes.find((n) => n.id === "agent-1");
    expect(agent?.data.primary_llm_model).toBe("openai/gpt-4o-mini:nitro");
    expect(agent?.data.llm_chain).toEqual([
      { model: "openai/gpt-4o-mini:nitro" },
      { model: "qwen/qwen-2.5-72b-instruct" },
    ]);
  });

  it("withVariant adds a suffix but never double-suffixes", async () => {
    const { withVariant } = await load();
    expect(withVariant("gpt-4o-mini", "nitro")).toBe("gpt-4o-mini:nitro");
    expect(withVariant("gpt-4o-mini:floor", "nitro")).toBe("gpt-4o-mini:floor");
    expect(withVariant("gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("disclosure-first: recording disclosure is spoken before the greeting", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Namaste, Demo Clinic.", systemPrompt: "You are A.", maxCallSeconds: 300,
      recordingDisclosureText: "This call may be recorded for quality purposes.",
    });
    const start = def.nodes[0];
    expect(start.id).toBe("start-1");
    expect(start.data.prompt).toMatch(/^First say exactly this legal disclosure/);
    const prompt = start.data.prompt ?? "";
    const dIdx = prompt.indexOf("This call may be recorded");
    const gIdx = prompt.indexOf("Namaste, Demo Clinic.");
    expect(dIdx).toBeGreaterThanOrEqual(0);
    expect(gIdx).toBeGreaterThan(dIdx); // disclosure strictly before greeting
  });

  it("without disclosure: original greeting-only prompt", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hello.", systemPrompt: "You are A.", maxCallSeconds: 300,
    });
    expect(def.nodes[0].data.prompt).toBe(
      'Greet the caller with exactly this greeting, then listen: "Hello."'
    );
  });

  it("language mapping: auto → unknown, fixed → fixedLanguage, caller-select → unknown", async () => {
    const { sarvamLanguageCode } = await load();
    expect(sarvamLanguageCode({ languageMode: "auto" })).toBe("unknown");
    expect(sarvamLanguageCode({ languageMode: "fixed", fixedLanguage: "hi" })).toBe("hi");
    expect(sarvamLanguageCode({ languageMode: "caller-select" })).toBe("unknown");
    expect(sarvamLanguageCode({})).toBe("unknown");
  });

  it("voice mapping: voiceId passes through; clonedVoiceId overrides and flags", async () => {
    const { buildWorkflowDefinition } = await load();
    const base = { name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60 };
    const a = buildWorkflowDefinition({ ...base, voiceId: "meera" });
    const agentA = a.nodes.find((n) => n.id === "agent-1");
    expect(agentA?.data.voice_id).toBe("meera");
    expect(agentA?.data.voice_is_cloned).toBe(false);
    const b = buildWorkflowDefinition({ ...base, voiceId: "meera", clonedVoiceId: "clone-xyz" });
    const agentB = b.nodes.find((n) => n.id === "agent-1");
    expect(agentB?.data.voice_id).toBe("clone-xyz");
    expect(agentB?.data.voice_is_cloned).toBe(true);
  });

  it("pipeline mode: default stt-llm-tts; speech-to-speech passes through", async () => {
    const { buildWorkflowDefinition } = await load();
    const base = { name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60 };
    expect(
      buildWorkflowDefinition(base).nodes.find((n) => n.id === "agent-1")?.data.pipeline_mode
    ).toBe("stt-llm-tts");
    expect(
      buildWorkflowDefinition({ ...base, pipelineMode: "speech-to-speech" }).nodes.find(
        (n) => n.id === "agent-1"
      )?.data.pipeline_mode
    ).toBe("speech-to-speech");
  });

  it("pre-recorded audio: recordingId lands on the start node as greeting_type/recording_id", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60,
      preRecordedAudio: {
        recordingId: "rec_123",
        greetingUrl: "https://cdn.test/greet.mp3",
        disclosureUrl: "https://cdn.test/disc.mp3",
      },
    });
    expect(def.nodes[0].data).toMatchObject({
      greeting_type: "recording",
      greeting_recording_id: "rec_123",
    });
  });

  it("webhook node posts to APP_URL with the shared-secret header", async () => {
    const { buildWorkflowDefinition } = await load();
    const def = buildWorkflowDefinition({
      name: "A", greeting: "Hi", systemPrompt: "s", maxCallSeconds: 60,
    });
    const hook = def.nodes.find((n) => n.id === "webhook-1");
    expect(hook?.data.endpoint_url).toBe("https://app.test/api/webhooks/dograh");
    expect(hook?.data.custom_headers).toEqual([{ key: "x-webhook-secret", value: SECRET }]);
  });
});

describe("request retry wrapper (via dograhTriggerCall)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("500 then 200 → retried once, then succeeds", async () => {
    const { dograhTriggerCall } = await load();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(500, "boom"))
      .mockResolvedValueOnce(fakeResponse(200, TRIGGER_OK));
    vi.stubGlobal("fetch", fetchMock);
    const res = await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    expect(res.workflow_run_id).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("400 → NO retry, throws DograhError with status", async () => {
    const { dograhTriggerCall, DograhError } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(400, "bad request"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" })
    ).rejects.toBeInstanceOf(DograhError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" }).catch((e) =>
      expect(e.status).toBe(400)
    );
  });

  it("network error (fetch rejects) → retried, then succeeds", async () => {
    const { dograhTriggerCall } = await load();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(fakeResponse(200, TRIGGER_OK));
    vi.stubGlobal("fetch", fetchMock);
    const res = await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    expect(res.workflow_run_id).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 is retried; exhausts retries and throws the last error", async () => {
    const { dograhTriggerCall, DograhError } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(429, "rate limited"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" })
    ).rejects.toBeInstanceOf(DograhError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 + MAX_RETRIES(3)
  });

  it("idempotency key: stable for identical calls, different for different bodies", async () => {
    const { dograhTriggerCall } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, TRIGGER_OK));
    vi.stubGlobal("fetch", fetchMock);
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919812345678" });
    await dograhTriggerCall("uuid-1", { phoneNumber: "+919800000000" });
    const keys = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit & { headers: Record<string, string> }).headers["Idempotency-Key"]
    );
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]); // same logical call → same key
    expect(keys[2]).not.toBe(keys[0]); // different phone → different key
  });

  it("idempotencyKeyFor is deterministic", async () => {
    const { idempotencyKeyFor } = await load();
    const a = idempotencyKeyFor("POST", "/p", { x: 1 });
    const b = idempotencyKeyFor("POST", "/p", { x: 1 });
    const c = idempotencyKeyFor("POST", "/p", { x: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
