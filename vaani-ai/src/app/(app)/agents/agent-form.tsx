"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Agent } from "@prisma/client";
import { createAgentAction, updateAgentAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SARVAM_VOICES,
  SUPPORTED_LANGUAGES,
  LLM_MODELS,
  LANGUAGE_MODES,
  defaultVoiceForLanguage,
} from "@/lib/voices";
import { DEFAULT_CONTROLS, type ConversationControls } from "@/lib/workflow-builder";

type ControlsWithGuardrail = ConversationControls & { kbGuardrail?: boolean };

function controlsFrom(agent?: Agent): ControlsWithGuardrail {
  const raw = (agent?.conversationConfig ?? {}) as Partial<ControlsWithGuardrail>;
  return { ...DEFAULT_CONTROLS, ...raw, voiceMap: raw.voiceMap ?? {} };
}

export function AgentForm({
  mode,
  agent,
  section = "general",
  customVoices = [],
  premiumVoicesAllowed = true,
}: {
  mode: "create" | "edit";
  agent?: Agent;
  section?: "general" | "voice" | "llm";
  customVoices?: { id: string; name: string; status: string }[];
  premiumVoicesAllowed?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = controlsFrom(agent);
  const [voiceMode, setVoiceMode] = useState<"stock" | "custom">(
    agent?.customVoiceId ? "custom" : "stock",
  );
  const readyVoices = customVoices.filter((v) => v.status === "READY");

  function formData(e: React.FormEvent<HTMLFormElement>) {
    const f = new FormData(e.currentTarget);
    const voiceMap: Record<string, string> = {};
    for (const l of SUPPORTED_LANGUAGES) {
      const v = String(f.get(`vm-${l.code}`) ?? "");
      if (v) voiceMap[l.code] = v;
    }
    return {
      name: f.get("name"),
      greeting: f.get("greeting"),
      systemPrompt: f.get("systemPrompt"),
      languageMode: f.get("languageMode"),
      fixedLanguage: f.get("fixedLanguage") || undefined,
      voiceId: f.get("voiceId"),
      customVoiceId: voiceMode === "custom" ? f.get("customVoiceId") || null : null,
      llmModel: f.get("llmModel"),
      temperature: f.get("temperature") ?? 0.7,
      maxTokens: f.get("maxTokens") ?? 300,
      maxCallSeconds: f.get("maxCallSeconds"),
      kbGuardrail: f.get("kbGuardrail") === "on",
      template: agent?.template ?? undefined,
      conversationConfig: {
        allowBargeIn: f.get("allowBargeIn") === "on",
        vadSensitivity: f.get("vadSensitivity") ?? "medium",
        silenceTimeoutSec: f.get("silenceTimeoutSec") ?? 20,
        fillerPhrases: String(f.get("fillerPhrases") ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean),
        speakingPace: f.get("speakingPace") ?? "normal",
        voiceMap,
      },
    };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const res =
      mode === "create"
        ? await createAgentAction(formData(e))
        : await updateAgentAction(agent!.id, formData(e));
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice("Saved.");
    router.refresh();
    if (mode === "create" && res.id) router.push(`/agents/${res.id}`);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {/* ----- general tab ----- */}
          <div className={section === "general" ? "space-y-4" : "hidden"} aria-hidden={section !== "general"}>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Agent name</span>
              <Input name="name" defaultValue={agent?.name} required={section === "general"} placeholder="Front Desk — Priya" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Greeting (first thing callers hear)</span>
              <textarea name="greeting" defaultValue={agent?.greeting} required={section === "general"} rows={2}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">System prompt (personality, rules, knowledge)</span>
              <textarea name="systemPrompt" defaultValue={agent?.systemPrompt} required={section === "general"} rows={12}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Max call length (seconds)</span>
                <Input name="maxCallSeconds" type="number" defaultValue={agent?.maxCallSeconds ?? 600} min={60} max={3600} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Silence timeout (seconds)</span>
                <Input name="silenceTimeoutSec" type="number" defaultValue={c.silenceTimeoutSec} min={5} max={120} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">VAD sensitivity</span>
                <select name="vadSensitivity" defaultValue={c.vadSensitivity}
                  className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="low">low (noisy lines)</option>
                  <option value="medium">medium (default)</option>
                  <option value="high">high (quiet callers)</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Speaking pace</span>
                <select name="speakingPace" defaultValue={c.speakingPace}
                  className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="slow">slow</option>
                  <option value="normal">normal</option>
                  <option value="fast">fast</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Filler phrases (comma-separated, spoken while thinking)</span>
              <Input name="fillerPhrases" defaultValue={(c.fillerPhrases ?? []).join(", ")} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allowBargeIn" defaultChecked={c.allowBargeIn} className="h-4 w-4" />
              Allow callers to interrupt (barge-in)
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="kbGuardrail" defaultChecked={c.kbGuardrail === true} className="mt-1 h-4 w-4"
                data-testid="agent-kb-guardrail" />
              <span>
                Knowledge-only guardrail — answer only from the knowledge base; otherwise say
                <em> &quot;let me confirm and call you back&quot;</em>
              </span>
            </label>
          </div>

          {/* ----- voice tab ----- */}
          <div className={section === "voice" ? "space-y-4" : "hidden"} aria-hidden={section !== "voice"}>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Language mode</span>
              <select name="languageMode" defaultValue={agent?.languageMode ?? "auto"}
                data-testid="agent-language-mode"
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                {LANGUAGE_MODES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Fixed language (only for fixed mode)</span>
              <select name="fixedLanguage" defaultValue={agent?.fixedLanguage ?? ""}
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                <option value="">—</option>
                {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Primary voice (Sarvam Bulbul v3)</span>
              <div className="flex gap-2">
                <select name="voiceId" defaultValue={agent?.voiceId ?? "anushka"}
                  data-testid="agent-voice-select"
                  className="h-9 flex-1 rounded-md border border-border bg-card px-3 text-sm">
                  {SARVAM_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>{v.id} ({v.gender})</option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" data-testid="agent-voice-preview"
                  onClick={() => {
                    const sel = document.querySelector<HTMLSelectElement>("[data-testid='agent-voice-select']");
                    window.open(`/api/voices/stock/${sel?.value ?? "anushka"}/sample`, "_blank", "noopener");
                  }}>
                  Preview voice
                </Button>
              </div>
            </label>
            <div className="space-y-2 rounded-md border border-border p-3" data-testid="agent-custom-voice-block">
              <p className="text-sm font-medium">Voice type</p>
              {!premiumVoicesAllowed && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-400" data-testid="agent-voice-clone-gate">
                  Custom voice cloning requires the Enterprise plan or the premium-voices add-on (₹5,000/mo per voice).
                  <Link href="/settings/voices" className="ml-1 text-primary hover:underline">See Settings →</Link>
                </p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="voiceMode" value="stock" checked={voiceMode === "stock"}
                  onChange={() => setVoiceMode("stock")} className="h-4 w-4" data-testid="agent-voice-mode-stock" />
                Stock voice (Sarvam)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="voiceMode" value="custom" checked={voiceMode === "custom"}
                  onChange={() => setVoiceMode("custom")} className="h-4 w-4" data-testid="agent-voice-mode-custom"
                  disabled={readyVoices.length === 0 || !premiumVoicesAllowed} />
                Custom cloned voice
              </label>
              {voiceMode === "custom" && (
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">Cloned voice</span>
                  <select name="customVoiceId" defaultValue={agent?.customVoiceId ?? ""}
                    data-testid="agent-custom-voice-select"
                    className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                    <option value="">— choose a cloned voice —</option>
                    {readyVoices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>
              )}
              {readyVoices.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No ready cloned voices.{" "}
                  <Link href="/settings/voices" className="text-primary hover:underline">Clone one in Settings →</Link>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Per-language voice mapping — when auto-detect hears a language, switch to this voice
                (empty = use the language&apos;s recommended voice).
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SUPPORTED_LANGUAGES.map((l) => (
                  <label key={l.code} className="flex items-center justify-between gap-2 text-sm">
                    <span className="w-32">{l.label}</span>
                    <select name={`vm-${l.code}`}
                      defaultValue={c.voiceMap?.[l.code] ?? ""}
                      className="h-9 flex-1 rounded-md border border-border bg-card px-3 text-sm">
                      <option value="">auto ({defaultVoiceForLanguage(l.code)})</option>
                      {SARVAM_VOICES.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Caller-selectable mode generates a DTMF pre-flow (&quot;Hindi ke liye 1
              dabaiye…&quot;) in the published workflow automatically.
            </p>
          </div>

          {/* ----- llm tab ----- */}
          <div className={section === "llm" ? "space-y-4" : "hidden"} aria-hidden={section !== "llm"}>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">LLM (OpenRouter) — with automatic failover chain</span>
              <select name="llmModel" defaultValue={agent?.llmModel ?? LLM_MODELS[2].id}
                data-testid="agent-llm-select"
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                {LLM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} — {m.useFor}</option>
                ))}
              </select>
            </label>
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">How to choose:</p>
              <p>· <code>:floor</code> models for simple FAQ/reminder agents (cheapest).</p>
              <p>· <code>:nitro</code> models when latency matters (&lt;800ms budget).</p>
              <p>· Premium models for complex sales conversations.</p>
              <p className="mt-1">Failover: if a provider rate-limits, the call falls back to Llama 3.1 70B → Gemini Flash → DeepSeek floor (configured in guide 04; the chain is passed per-agent on publish).</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Temperature (0–1, higher = more creative)</span>
                <Input name="temperature" type="number" step="0.1" min={0} max={1}
                  defaultValue={agent?.temperature ?? 0.7} data-testid="agent-temperature-input" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Max output tokens</span>
                <Input name="maxTokens" type="number" min={1} max={4096}
                  defaultValue={agent?.maxTokens ?? 300} data-testid="agent-max-tokens-input" />
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-green-400">{notice}</p>}

          <Button type="submit" disabled={busy} data-testid="agent-save-btn">
            {busy ? "Saving…" : mode === "create" ? "Create agent" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
