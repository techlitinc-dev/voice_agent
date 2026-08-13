"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPipelineAction } from "@/server/actions/crm";

type StageRow = { name: string; probability: number; color: string };

const DEFAULT_STAGES: StageRow[] = [
  { name: "New", probability: 10, color: "#6b7280" },
  { name: "Contacted", probability: 25, color: "#3b82f6" },
  { name: "Qualified", probability: 50, color: "#8b5cf6" },
  { name: "Won", probability: 100, color: "#10b981" },
  { name: "Lost", probability: 0, color: "#ef4444" },
];

export function CreatePipelineForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [stages, setStages] = useState<StageRow[]>(DEFAULT_STAGES);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setStage(i: number, patch: Partial<StageRow>) {
    setStages((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Pipeline name is required."); return; }
    if (stages.some((s) => !s.name.trim())) { setError("Every stage needs a name."); return; }
    setBusy(true);
    setError(null);
    const res = await createPipelineAction({
      name: name.trim(),
      isDefault: true,
      stages: stages.map((s) => ({ name: s.name.trim(), probability: s.probability, color: s.color })),
    });
    setBusy(false);
    if (res.ok && res.dealId) {
      router.push("/crm/pipeline");
      router.refresh();
    } else {
      setError(res.error ?? "Could not create pipeline.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6" data-testid="create-pipeline-form">
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="space-y-1">
        <label className="text-sm font-medium">Pipeline name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Stages</p>
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={s.name}
              onChange={(e) => setStage(i, { name: e.target.value })}
              placeholder={`Stage ${i + 1}`}
              className="flex-1"
            />
            <Input
              type="number"
              min={0}
              max={100}
              value={s.probability}
              onChange={(e) => setStage(i, { probability: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
              className="w-20"
              title="Win probability %"
            />
            <Input
              type="color"
              value={s.color}
              onChange={(e) => setStage(i, { color: e.target.value })}
              className="h-9 w-12"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setStages((r) => r.filter((_, idx) => idx !== i))}>
              ✕
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setStages((r) => [...r, { name: "", probability: 0, color: "#94a3b8" }])}>
          + Add stage
        </Button>
      </div>
      <Button type="submit" disabled={busy} data-testid="pipeline-submit">{busy ? "Creating…" : "Create pipeline"}</Button>
    </form>
  );
}
