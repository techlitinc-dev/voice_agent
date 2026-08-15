/** Version snapshot logic. Pure — no DB, no Dograh. Unit-tested in tests/versions.test.ts. */

export type AgentSnapshot = {
  systemPrompt: string;
  greeting: string;
  config: {
    voiceId: string;
    customVoiceId: string | null;
    llmModel: string;
    temperature: number;
    maxTokens: number;
    languageMode: string;
    fixedLanguage: string | null;
    maxCallSeconds: number;
    conversationConfig: unknown;
    tools: { tool: string; config: unknown }[];
  };
};

/** What we freeze into an AgentVersion row on publish. */
export function snapshotAgent(agent: {
  systemPrompt: string;
  greeting: string;
  voiceId: string;
  customVoiceId: string | null;
  llmModel: string;
  temperature: number;
  maxTokens: number;
  languageMode: string;
  fixedLanguage: string | null;
  maxCallSeconds: number;
  conversationConfig: unknown;
  toolConfigs: { tool: string; config: unknown }[];
}): AgentSnapshot {
  return {
    systemPrompt: agent.systemPrompt,
    greeting: agent.greeting,
    config: {
      voiceId: agent.voiceId,
      customVoiceId: agent.customVoiceId,
      llmModel: agent.llmModel,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      languageMode: agent.languageMode,
      fixedLanguage: agent.fixedLanguage,
      maxCallSeconds: agent.maxCallSeconds,
      conversationConfig: agent.conversationConfig ?? null,
      tools: agent.toolConfigs.map((t) => ({ tool: t.tool, config: t.config })),
    },
  };
}

/** Next version number from existing rows. */
export function nextVersionNumber(existing: { version: number }[]): number {
  return existing.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

/**
 * Validate an A/B split. Rules (v1): at most ONE A/B variant per agent; the variant
 * gets abTrafficPercent in 1..99; the main published version gets the remainder.
 */
export function validateAbSplit(params: {
  existingAbVariants: { id: string }[];
  trafficPercent: number;
}): { ok: true } | { ok: false; error: string } {
  if (params.existingAbVariants.length >= 1) {
    return { ok: false, error: "This agent already has an A/B variant. Remove it first (v1 supports one)." };
  }
  if (!Number.isInteger(params.trafficPercent) || params.trafficPercent < 1 || params.trafficPercent > 99) {
    return { ok: false, error: "A/B traffic must be a whole number between 1 and 99 (the main version gets the rest)." };
  }
  return { ok: true };
}
