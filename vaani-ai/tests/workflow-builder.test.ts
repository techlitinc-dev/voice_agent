import { describe, expect, it } from "vitest";
import {
  buildAgentWorkflow,
  validateWorkflowDefinition,
  buildCallerSelectPreflow,
  buildToolPromptSection,
  buildControlsPromptSection,
  KB_GUARDRAIL_PROMPT,
  DEFAULT_CONTROLS,
  type WorkflowSpec,
} from "../src/lib/workflow-builder";
import { AGENT_TEMPLATES } from "../src/lib/templates";

function spec(overrides: Partial<WorkflowSpec> = {}): WorkflowSpec {
  return {
    name: "Test Agent",
    greeting: "Namaste!",
    systemPrompt: "You are a helpful test agent with enough prompt text.",
    languageMode: "auto",
    fixedLanguage: null,
    voiceId: "anushka",
    llmModel: "meta-llama/llama-3.1-70b-instruct",
    llmFallbacks: ["google/gemini-flash-1.5"],
    maxCallSeconds: 600,
    controls: { ...DEFAULT_CONTROLS },
    kbGuardrail: false,
    tools: [],
    ...overrides,
  };
}

describe("buildAgentWorkflow — structure", () => {
  it("produces a valid definition: 1 startCall, agentNode(s), webhook, endCall", () => {
    const def = buildAgentWorkflow(spec());
    const r = validateWorkflowDefinition(def);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(def.nodes.map((n) => n.type)).toContain("webhook");
  });

  it("EVERY industry template generates a valid workflow", () => {
    for (const t of AGENT_TEMPLATES) {
      const def = buildAgentWorkflow(
        spec({
          name: t.name,
          greeting: t.greeting,
          systemPrompt: t.systemPrompt,
          voiceId: t.suggestedVoice,
          llmModel: t.suggestedLlm,
          tools: t.suggestedTools.map((tool) => ({ tool, config: {} })),
        }),
      );
      const r = validateWorkflowDefinition(def);
      expect(r.errors, `template ${t.code}`).toEqual([]);
      expect(r.valid, `template ${t.code}`).toBe(true);
    }
  });

  it("caller-select mode inserts the DTMF language pre-flow before the agent", () => {
    const def = buildAgentWorkflow(spec({ languageMode: "caller-select" }));
    const lang = def.nodes.find((n) => n.id === "lang-1");
    expect(lang).toBeDefined();
    expect(String(lang!.data.prompt)).toContain("dabaiye");
    expect(def.edges.some((e) => e.source === "start-1" && e.target === "lang-1")).toBe(true);
    expect(def.edges.some((e) => e.source === "lang-1" && e.target === "agent-1")).toBe(true);
    // and NO direct start→agent edge in caller-select mode
    expect(def.edges.some((e) => e.source === "start-1" && e.target === "agent-1")).toBe(false);
  });

  it("fixed mode pins the language in the prompt and STT hint", () => {
    const def = buildAgentWorkflow(spec({ languageMode: "fixed", fixedLanguage: "ta" }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect(String(agent.data.prompt)).toContain('"ta"');
    expect((agent.data.stt as { language_code: string }).language_code).toBe("ta");
  });

  it("auto mode uses Saarika language_code 'unknown'", () => {
    const def = buildAgentWorkflow(spec({ languageMode: "auto" }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect((agent.data.stt as { language_code: string }).language_code).toBe("unknown");
  });

  it("KB guardrail injects the guardrail module into the prompt", () => {
    const def = buildAgentWorkflow(spec({ kbGuardrail: true }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect(String(agent.data.prompt)).toContain("let me confirm and call you back");
    expect(String(agent.data.prompt)).toContain(KB_GUARDRAIL_PROMPT.slice(0, 40));
  });

  it("booking + transfer tools create specialist handoff nodes (multi-agent flow)", () => {
    const def = buildAgentWorkflow(
      spec({ tools: [{ tool: "CALENDAR_BOOKING", config: {} }, { tool: "HUMAN_TRANSFER", config: { queue: "sales" } }] }),
    );
    expect(def.nodes.some((n) => n.id === "booking-1")).toBe(true);
    expect(def.nodes.some((n) => n.id === "transfer-1")).toBe(true);
    expect(def.edges.some((e) => e.source === "agent-1" && e.target === "booking-1")).toBe(true);
    expect(def.edges.some((e) => e.source === "agent-1" && e.target === "transfer-1")).toBe(true);
    const r = validateWorkflowDefinition(def);
    expect(r.valid).toBe(true);
  });

  it("per-agent voice/LLM hints land on the agent node", () => {
    const def = buildAgentWorkflow(spec({ voiceId: "kavya", llmModel: "deepseek/deepseek-chat:floor" }));
    const agent = def.nodes.find((n) => n.id === "agent-1")!;
    expect((agent.data.tts as { voice_id: string }).voice_id).toBe("kavya");
    expect((agent.data.llm as { model: string }).model).toBe("deepseek/deepseek-chat:floor");
    expect((agent.data.llm as { fallbacks: string[] }).fallbacks).toContain("google/gemini-flash-1.5");
  });

  it("barge-in control maps to allow_interrupt", () => {
    const off = buildAgentWorkflow(spec({ controls: { ...DEFAULT_CONTROLS, allowBargeIn: false } }));
    expect(off.nodes.find((n) => n.id === "agent-1")!.data.allow_interrupt).toBe(false);
  });
});

describe("prompt modules", () => {
  it("buildCallerSelectPreflow enumerates languages with DTMF digits", () => {
    const { node } = buildCallerSelectPreflow([
      { code: "hi", label: "Hindi" },
      { code: "ta", label: "Tamil" },
    ]);
    expect(String(node.data.prompt)).toContain("Hindi ke liye 1 dabaiye");
    expect(String(node.data.prompt)).toContain("Tamil ke liye 2 dabaiye");
  });

  it("buildToolPromptSection lists only enabled tools", () => {
    const s = buildToolPromptSection([{ tool: "PAYMENT_LINK", config: {} }]);
    expect(s).toContain("PAYMENT COLLECTION");
    expect(s).not.toContain("TRANSFER TO HUMAN");
    expect(buildToolPromptSection([])).toBe("");
  });

  it("buildControlsPromptSection reflects pace + fillers + silence", () => {
    const s = buildControlsPromptSection({ ...DEFAULT_CONTROLS, speakingPace: "slow", silenceTimeoutSec: 30 });
    expect(s).toContain("slowly");
    expect(s).toContain("30 seconds");
  });
});
