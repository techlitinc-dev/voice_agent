"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createDealAction, updateDealAction } from "@/server/actions/crm";

export type DealFormData = {
  title: string;
  valuePaise: number;
  pipelineId: string;
  stageId: string;
  contactId?: string;
  priority: "low" | "medium" | "high" | "urgent";
  expectedClose?: string;
  ownerUserId?: string;
};

export function DealForm({
  mode,
  dealId,
  initial,
  pipelines,
  contacts,
  users,
  createPipeline,
}: {
  mode: "create" | "edit";
  dealId?: string;
  initial?: DealFormData;
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  contacts: { id: string; name: string | null; phone: string }[];
  users: { id: string; fullName: string }[];
  createPipeline?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<DealFormData>({
    title: initial?.title ?? "",
    valuePaise: initial?.valuePaise ?? 0,
    pipelineId: initial?.pipelineId ?? pipelines[0]?.id ?? "",
    stageId: initial?.stageId ?? pipelines[0]?.stages[0]?.id ?? "",
    contactId: initial?.contactId,
    priority: initial?.priority ?? "medium",
    expectedClose: initial?.expectedClose,
    ownerUserId: initial?.ownerUserId,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activePipeline = pipelines.find((p) => p.id === form.pipelineId);
  const activeStages = activePipeline?.stages ?? [];

  function set<K extends keyof DealFormData>(key: K, value: DealFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.pipelineId || !form.stageId) { setError("Choose a pipeline and stage."); return; }
    setBusy(true);
    setError(null);
    const payload = { ...form, title: form.title.trim(), valuePaise: Math.max(0, Math.round(Number(form.valuePaise) || 0)) };
    const res =
      mode === "create"
        ? await createDealAction(payload)
        : dealId
          ? await updateDealAction(dealId, payload)
          : { ok: false as const, error: "missing deal" };
    setBusy(false);
    if (res.ok && res.dealId) {
      router.push(`/crm/deals/${res.dealId}`);
      router.refresh();
    } else {
      setError(res.error ?? "Something went wrong.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6" data-testid="deal-form">
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-1">
        <label className="text-sm font-medium">Title</label>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Home loan — Ramesh (₹25L)" data-testid="deal-title" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Value (₹)</label>
          <Input
            type="number"
            min={0}
            value={form.valuePaise / 100}
            onChange={(e) => set("valuePaise", Math.round((Number(e.target.value) || 0) * 100))}
            data-testid="deal-value"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Priority</label>
          <Select value={form.priority} onChange={(e) => set("priority", e.target.value as DealFormData["priority"])}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Pipeline</label>
          <Select
            value={form.pipelineId}
            onChange={(e) => {
              const pid = e.target.value;
              const p = pipelines.find((x) => x.id === pid);
              setForm((f) => ({ ...f, pipelineId: pid, stageId: p?.stages[0]?.id ?? "" }));
            }}
          >
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Stage</label>
          <Select value={form.stageId} onChange={(e) => set("stageId", e.target.value)}>
            {activeStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Contact</label>
          <Select value={form.contactId ?? ""} onChange={(e) => set("contactId", e.target.value || undefined)}>
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Owner</label>
          <Select value={form.ownerUserId ?? ""} onChange={(e) => set("ownerUserId", e.target.value || undefined)}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Expected close</label>
        <Input
          type="date"
          value={form.expectedClose?.slice(0, 10) ?? ""}
          onChange={(e) => set("expectedClose", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={busy} data-testid="deal-submit">
          {busy ? "Saving…" : mode === "create" ? "Create deal" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
      {createPipeline && (
        <p className="text-xs text-muted-foreground">
          Tip: no pipelines exist yet — create one first.
        </p>
      )}
    </form>
  );
}
