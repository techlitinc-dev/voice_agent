"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { updateDealStageAction } from "@/server/actions/crm";
import type { Stage, Deal } from "@prisma/client";

export function StageChangeForm({
  deal,
  stages,
  canWrite,
}: {
  deal: Pick<Deal, "id" | "stageId">;
  stages: Stage[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!canWrite || e.target.value === deal.stageId) return;
    setBusy(true);
    const res = await updateDealStageAction(deal.id, e.target.value);
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <Select
      value={deal.stageId}
      onChange={onChange}
      disabled={!canWrite || busy}
      data-testid="stage-select"
      className="w-40"
    >
      {stages.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </Select>
  );
}
