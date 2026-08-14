"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateApprovalSettingsAction } from "@/server/actions/crm";

export function ApprovalSettingsForm({
  thresholdPaise,
  approvalRequiredStages,
  stageNames,
}: {
  thresholdPaise: number | null;
  approvalRequiredStages: string[];
  stageNames: string[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(thresholdPaise != null);
  const [threshold, setThreshold] = useState<string>(
    thresholdPaise != null ? String(thresholdPaise / 100) : "500000"
  );
  const [selected, setSelected] = useState<string[]>(approvalRequiredStages);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await updateApprovalSettingsAction({
      thresholdPaise: enabled ? Math.round(Number(threshold) * 100) : null,
      approvalRequiredStages: selected,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Approval settings saved");
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save approval settings");
    }
  }

  function toggleStage(name: string) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  return (
    <div className="space-y-4" data-testid="approval-settings-form">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-testid="approval-enabled"
        />
        Enable approval workflow
      </label>

      {enabled && (
        <>
          <label className="block text-sm">
            Approval threshold (₹) — deals at or above this value need approval
            <input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              data-testid="approval-threshold"
              className="mt-1 block h-9 w-48 rounded-md border border-border bg-transparent px-3 text-sm"
            />
          </label>

          <div className="text-sm">
            <p className="mb-2 text-muted-foreground">Stages that require approval</p>
            {stageNames.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No pipeline stages yet — create a pipeline in CRM first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {stageNames.map((name) => (
                  <label key={name} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(name)}
                      onChange={() => toggleStage(name)}
                      data-testid={`approval-stage-${name}`}
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <button
        onClick={save}
        disabled={busy}
        data-testid="approval-save-button"
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
