/**
 * Minimal OpenRouter chat-completions client for post-call intelligence
 * (interest scoring, callback extraction). Direct fetch — no SDK.
 * Key: OPENROUTER_API_KEY (guide 04). Model: OPENROUTER_SCORING_MODEL
 * (default meta-llama/llama-3.1-8b-instruct — cheap classification).
 */

import { createHash } from "node:crypto";
import { cache } from "./cache";

export class OpenRouterError extends Error {
  constructor(public status: number, message: string) {
    super(`OpenRouter ${status}: ${message}`);
  }
}

/**
 * Cache the static part of a prompt (system + knowledge context) keyed by a
 * stable content hash (scalability doc §7 — prompt caching). Only the
 * conversation turns re-process. TTL 1h; cache failures fall back to a live
 * build. The caller must pass a stable `cacheKey` (e.g. agentId) and the full
 * `build` closure.
 */
export async function cachedSystemPrompt<T>(
  cacheKey: string,
  content: string,
  build: () => Promise<T>
): Promise<T> {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return cache(`prompt:${cacheKey}:${hash}`, 3600, build);
}

export async function callOpenRouterJson(input: {
  system: string;
  user: string;
  model?: string;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) throw new OpenRouterError(0, "OPENROUTER_API_KEY not set");
  const model = input.model ?? process.env.OPENROUTER_SCORING_MODEL ?? "meta-llama/llama-3.1-8b-instruct";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
      "X-Title": "Vaani AI post-call intelligence",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 300,
    }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new OpenRouterError(res.status, text.slice(0, 500));
  const parsed = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new OpenRouterError(0, "empty completion");
  return content;
}
