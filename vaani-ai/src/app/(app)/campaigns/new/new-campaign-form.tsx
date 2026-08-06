"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction } from "@/server/actions/campaigns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Preset = {
  type: string;
  label: string;
  description: string;
  retryPolicy: Record<string, { attempts: number; delayMin: number }>;
  windowStart: string;
  windowEnd: string;
  days: number[];
  openingHook: string;
  objectionPlaybook: string;
};

export function NewCampaignForm(props: {
  agents: { id: string; name: string }[];
  lists: { id: string; name: string; count: number }[];
  pools: { id: string; name: string; count: number }[];
  waTemplates: { id: string; name: string }[];
  presets: Preset[];
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset | null>(null);
  const [retryJson, setRetryJson] = useState("{}");
  const [windowsJson, setWindowsJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPreset(p: Preset) {
    setPreset(p);
    setRetryJson(JSON.stringify(p.retryPolicy, null, 2));
    setWindowsJson(JSON.stringify({ days: p.days }, null, 2));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    let retryPolicy: unknown = null;
    let timezoneWindows: unknown = null;
    try {
      retryPolicy = retryJson.trim() && retryJson.trim() !== "{}" ? JSON.parse(retryJson) : null;
      timezoneWindows = windowsJson.trim() && windowsJson.trim() !== "{}" ? JSON.parse(windowsJson) : null;
    } catch {
      setBusy(false);
      return setError("Retry policy / windows must be valid JSON.");
    }
    const res = await createCampaignAction({
      name: f.get("name"),
      type: preset?.type ?? "LEAD_QUALIFICATION",
      agentId: f.get("agentId"),
      listId: f.get("listId"),
      poolId: f.get("poolId") || null,
      callsPerMinute: f.get("callsPerMinute"),
      concurrency: f.get("concurrency"),
      maxAttempts: f.get("maxAttempts"),
      retryDelayMin: f.get("retryDelayMin"),
      callingWindowStart: f.get("callingWindowStart") || preset?.windowStart || "09:00",
      callingWindowEnd: f.get("callingWindowEnd") || preset?.windowEnd || "19:00",
      retryPolicy,
      timezoneWindows,
      openingHook: f.get("openingHook") || preset?.openingHook || null,
      objectionPlaybook: f.get("objectionPlaybook") || preset?.objectionPlaybook || null,
      amdPolicy: f.get("amdPolicy"),
      predictiveDialing: f.get("predictiveDialing") === "on",
      whatsappFallbackTemplateId: f.get("waFallback") || null,
      applyPreset: false, // preset values already merged client-side
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not create campaign.");
    router.push(`/campaigns/${res.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="campaign-form">
      <section>
        <h2 className="mb-2 text-lg font-semibold">1 · Campaign type</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {props.presets.map((p) => (
            <button
              type="button"
              key={p.type}
              data-testid={`preset-card-${p.type}`}
              onClick={() => pickPreset(p)}
              className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                preset?.type === p.type ? "border-primary bg-primary/10" : "hover:border-primary/40"
              }`}
            >
              <p className="font-semibold">{p.label}</p>
              <p className="text-muted-foreground">{p.description}</p>
            </button>
          ))}
        </div>
        {!preset && <p className="mt-1 text-xs text-muted-foreground">No preset selected — defaults to Lead qualification with empty policy.</p>}
      </section>

      <Card>
        <CardHeader><CardTitle>2 · Basics</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input name="name" placeholder="Campaign name" required data-testid="campaign-name-input" />
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Agent (PUBLISHED)</span>
            <select name="agentId" required data-testid="agent-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              {props.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Contact list</span>
            <select name="listId" required data-testid="list-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              {props.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Number pool (optional — rotation + caps)</span>
            <select name="poolId" data-testid="pool-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— no pool (single trunk DID) —</option>
              {props.pools.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.count} numbers)</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3 · Pacing & retries</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Calls/minute cap</span>
              <Input name="callsPerMinute" type="number" defaultValue={10} min={1} max={60} data-testid="cpm-input" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Max concurrent calls</span>
              <Input name="concurrency" type="number" defaultValue={2} min={1} max={50} data-testid="concurrency-input" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Max attempts (fallback)</span>
              <Input name="maxAttempts" type="number" defaultValue={2} min={1} max={5} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Retry delay min (fallback)</span>
              <Input name="retryDelayMin" type="number" defaultValue={60} min={5} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              Retry policy JSON — per disposition overrides (busy / no-answer / failed / voicemail)
            </span>
            <textarea
              value={retryJson}
              onChange={(e) => setRetryJson(e.target.value)}
              rows={5}
              data-testid="retry-policy-editor"
              className="w-full rounded-md border border-border bg-card p-2 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="predictiveDialing" data-testid="predictive-toggle" />
            Predictive dial-ahead (§15 — over-book slots 1.5×; AI always picks up, abandonment ≈ 0)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>4 · Schedule & windows</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Window start</span>
              <Input name="callingWindowStart" defaultValue={preset?.windowStart ?? "09:00"} pattern="\d{2}:\d{2}" data-testid="window-start-input" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Window end</span>
              <Input name="callingWindowEnd" defaultValue={preset?.windowEnd ?? "19:00"} pattern="\d{2}:\d{2}" data-testid="window-end-input" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              Timezone windows JSON — {"{"}&quot;timezone&quot;:&quot;Asia/Kolkata&quot;,&quot;days&quot;:[1,2,3,4,5],&quot;windows&quot;:[[&quot;09:00&quot;,&quot;13:00&quot;]]{"}"} (empty = every day, window above)
            </span>
            <textarea
              value={windowsJson}
              onChange={(e) => setWindowsJson(e.target.value)}
              rows={3}
              data-testid="windows-editor"
              className="w-full rounded-md border border-border bg-card p-2 font-mono text-xs"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Guardrails always on: per-contact timezone windows, TRAI 09:00–21:00 for
            SERIES_140 pools, DNC + consent checks at schedule AND dial time.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>5 · Conversation & fallback</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Opening hook (first 15 seconds, incl. identity disclosure)</span>
            <textarea name="openingHook" rows={3} defaultValue={preset?.openingHook ?? ""} data-testid="opening-hook-input" className="w-full rounded-md border border-border bg-card p-2 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Objection playbook</span>
            <textarea name="objectionPlaybook" rows={4} defaultValue={preset?.objectionPlaybook ?? ""} data-testid="objection-playbook-input" className="w-full rounded-md border border-border bg-card p-2 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Voicemail / AMD policy</span>
            <select name="amdPolicy" data-testid="amd-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="HANGUP">Hang up on voicemail</option>
              <option value="LEAVE_MESSAGE">Leave a message</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Call-to-WhatsApp fallback (on final no-answer, optional)</span>
            <select name="waFallback" data-testid="wa-fallback-select" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— none —</option>
              {props.waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-400" data-testid="campaign-form-error">{error}</p>}
      <Button type="submit" disabled={busy} data-testid="create-campaign-submit">
        {busy ? "Creating…" : "Create campaign"}
      </Button>
    </form>
  );
}
