"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createSegmentAction } from "@/server/actions/crm";
import { SEGMENT_FIELDS, SEGMENT_OPERATORS, type Operator, type SegmentField } from "@/lib/crm";

type RuleRow = { field: string; op: string; value: string };

type PreviewMember = { id: string; name: string | null; phone: string; city: string; score: number | null; grade: string | null };

const FIELD_GROUPS = [...new Set(SEGMENT_FIELDS.map((f) => f.group))];

export function SegmentBuilderForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [rules, setRules] = useState<RuleRow[]>([{ field: "call.lastInterestScore", op: "eq", value: "HOT" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live preview state.
  const [preview, setPreview] = useState<{ count: number; members: PreviewMember[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  function setRule(i: number, patch: Partial<RuleRow>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function runPreview() {
    const clean = rules.filter((r) => r.field && r.value.trim() !== "");
    if (clean.length === 0) { setPreview({ count: 0, members: [] }); return; }
    setPreviewing(true);
    try {
      const res = await fetch("/api/crm/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: clean, matchMode }),
      });
      const data = await res.json();
      if (data.ok) setPreview({ count: data.count, members: data.members });
      else setPreview({ count: 0, members: [] });
    } catch {
      setPreview({ count: 0, members: [] });
    } finally {
      setPreviewing(false);
    }
  }

  async function onSubmit(saveAndCampaign = false) {
    if (!name.trim()) { setError("Segment name is required."); return; }
    const clean = rules.filter((r) => r.field && r.value.trim() !== "");
    if (clean.length === 0) { setError("Add at least one condition with a value."); return; }
    setBusy(true);
    setError(null);
    const res = await createSegmentAction({
      name: name.trim(),
      description: description.trim() || undefined,
      matchMode,
      rules: clean.map((r) => ({ field: r.field as SegmentField, op: r.op as Operator, value: r.value.trim() })),
    });
    setBusy(false);
    if (res.ok && res.dealId) {
      router.push(saveAndCampaign ? `/crm/segments/${res.dealId}?createCampaign=1` : `/crm/segments/${res.dealId}`);
      router.refresh();
    } else {
      setError(res.error ?? "Could not create the segment.");
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(false); }}
      className="space-y-4 rounded-lg border bg-card p-6"
      data-testid="segment-builder"
    >
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-1">
        <label className="text-sm font-medium">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot leads — Pune" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Description</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Match</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="matchMode" checked={matchMode === "all"} onChange={() => setMatchMode("all")} className="accent-primary" />
            All conditions (AND)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="matchMode" checked={matchMode === "any"} onChange={() => setMatchMode("any")} className="accent-primary" />
            Any condition (OR)
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Conditions</p>
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select value={r.field} onChange={(e) => setRule(i, { field: e.target.value })} className="flex-1" data-testid="rule-field">
              {FIELD_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {SEGMENT_FIELDS.filter((f) => f.group === g).map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Select value={r.op} onChange={(e) => setRule(i, { op: e.target.value })} className="w-24" data-testid="rule-op">
              {SEGMENT_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Input
              value={r.value}
              onChange={(e) => setRule(i, { value: e.target.value })}
              placeholder="value"
              className="flex-1"
              data-testid="rule-value"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setRules((rs) => rs.filter((_, idx) => idx !== i))}>✕</Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRules((rs) => [...rs, { field: "contact.city", op: "eq", value: "" }])}
        >
          + Add condition
        </Button>
      </div>

      {/* Live preview (guide crm/04 §1.2) */}
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Preview</p>
          <Button type="button" variant="outline" size="sm" onClick={runPreview} disabled={previewing} data-testid="preview-button">
            {previewing ? "Checking…" : preview ? "Refresh preview" : "Show preview"}
          </Button>
        </div>
        {preview && (
          <div className="mt-2">
            <p className="text-sm">{preview.count} contact{preview.count === 1 ? "" : "s"} match (showing first {Math.min(5, preview.members.length)})</p>
            <ul className="mt-2 space-y-1 text-sm">
              {preview.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">{m.name ?? "—"}</span>
                  <span className="font-mono text-xs">{m.phone}</span>
                  {m.city && <span>· {m.city}</span>}
                  {m.score !== null && <span>· {m.grade} {m.score}</span>}
                </li>
              ))}
            </ul>
            {preview.members.length === 0 && preview.count > 0 && <p className="mt-1 text-xs text-muted-foreground">(only first 5 shown)</p>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={busy} data-testid="segment-submit">{busy ? "Saving…" : "Save segment"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => onSubmit(true)} data-testid="segment-campaign-button">
          Save &amp; Create Campaign
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/crm/segments")}>Cancel</Button>
      </div>
    </form>
  );
}
