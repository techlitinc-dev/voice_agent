"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dropzone } from "@/components/ui/dropzone";
import { SUPPORTED_LANGUAGES } from "@/lib/voices";
import { VOICE_SAMPLE_MAX_BYTES } from "@/lib/voice-cloning";

type Result = { ok: boolean; error?: string };

type Voice = {
  id: string;
  name: string;
  provider: string;
  language: string;
  status: string;
  error: string | null;
  sampleKey: string | null;
  agents: { id: string; name: string }[];
};

type Actions = {
  create: (formData: FormData) => Promise<Result>;
  remove: (voiceId: string) => Promise<Result>;
  setStatus: (voiceId: string, status: "READY" | "FAILED") => Promise<Result>;
  assign: (input: { agentId: string; customVoiceId: string | null }) => Promise<Result>;
};

const STATUS_STYLE: Record<string, string> = {
  READY: "bg-green-500/10 text-green-400",
  TRAINING: "bg-blue-500/10 text-blue-400",
  PENDING: "bg-amber-500/10 text-amber-400",
  FAILED: "bg-red-500/10 text-red-400",
};

export function VoiceManager(props: {
  voices: Voice[];
  agents: { id: string; name: string }[];
  premiumVoicesAllowed: boolean;
  actions: Actions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  async function run(label: string, fn: () => Promise<Result>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    setSelectedFile(null);
    setNotice(`${label} — done.`);
    router.refresh();
  }

  return (
    <>
      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400" data-testid="voices-error">{error}</p>}
      {notice && <p className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400" data-testid="voices-notice">{notice}</p>}

      <Card>
        <CardHeader><CardTitle>Clone a voice</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            data-testid="voice-create-form"
            action={(formData) => {
              if (!selectedFile) {
                setError("Choose a sample audio file first.");
                return;
              }
              formData.set("sample", selectedFile);
              run("Voice created", () => props.actions.create(formData));
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Voice name</span>
                <Input name="name" placeholder="Brand Voice — Hindi Female" required maxLength={60} data-testid="voice-name-input" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Provider</span>
                <Select name="provider" defaultValue="elevenlabs" data-testid="voice-provider-select">
                  <option value="elevenlabs">ElevenLabs (recommended)</option>
                  <option value="playht">PlayHT</option>
                  <option value="sarvam">Sarvam</option>
                </Select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Primary language</span>
              <Select name="language" defaultValue="hi" data-testid="voice-language-select">
                {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </Select>
            </label>
            <Dropzone
              accept={{ "audio/mpeg": [".mp3"], "audio/wav": [".wav"] }}
              maxSize={VOICE_SAMPLE_MAX_BYTES}
              onUpload={setSelectedFile}
              hint={selectedFile ? `Selected: ${selectedFile.name}` : "mp3/wav · 30s+ clean clip · up to 25 MB"}
            />
            <Button type="submit" disabled={busy !== null || !props.premiumVoicesAllowed} data-testid="voice-create-btn">
              {busy === "Voice created" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy === "Voice created" ? "Cloning…" : "Clone voice"}
            </Button>
            {!props.premiumVoicesAllowed && (
              <p className="text-xs text-amber-400">Unavailable on your plan — upgrade in Billing.</p>
            )}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {props.voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custom voices yet.</p>
        ) : (
          props.voices.map((v) => (
            <Card key={v.id} data-testid={`voice-card-${v.id}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{v.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[v.status] ?? "bg-muted text-muted-foreground"}`}>
                      {v.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {v.provider} · {v.language}
                    {v.agents.length > 0 && ` · used by ${v.agents.map((a) => a.name).join(", ")}`}
                  </p>
                  {v.status === "FAILED" && v.error && (
                    <p className="mt-1 text-xs text-red-400">{v.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {v.sampleKey && (
                    <audio controls preload="none" className="h-8 w-40" data-testid={`voice-preview-${v.id}`}>
                      <source src={`/api/voices/${v.id}/sample`} />
                    </audio>
                  )}
                  {v.status === "FAILED" && (
                    <Button size="sm" variant="outline" disabled={busy !== null}
                      onClick={() => run("Voice retried", () => props.actions.setStatus(v.id, "READY"))}>
                      Retry
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy !== null}
                    onClick={() => run("Voice deleted", () => props.actions.remove(v.id))}
                    data-testid={`voice-delete-${v.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {props.agents.length > 0 && props.voices.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Assign to agent</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {props.agents.map((a) => {
              const assigned = props.voices.find((v) => v.agents.some((x) => x.id === a.id));
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0">
                  <span>{a.name}</span>
                  <Select
                    className="max-w-xs"
                    value={assigned?.id ?? ""}
                    data-testid={`voice-assign-${a.id}`}
                    onChange={async (e) => {
                      const customVoiceId = e.target.value || null;
                      setBusy(`assign-${a.id}`);
                      const res = await props.actions.assign({ agentId: a.id, customVoiceId });
                      setBusy(null);
                      if (!res.ok) return setError(res.error ?? "Assignment failed.");
                      setNotice("Voice assigned.");
                      router.refresh();
                    }}
                  >
                    <option value="">Stock voice (Sarvam)</option>
                    {props.voices.filter((v) => v.status === "READY").map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}
