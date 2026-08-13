"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateTaskStatusAction } from "@/server/actions/crm";

export function TaskToggle({
  taskId,
  status,
  canWrite,
}: {
  taskId: string;
  status: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onToggle() {
    if (!canWrite) return;
    setBusy(true);
    const next = status === "DONE" ? "PENDING" : "DONE";
    const res = await updateTaskStatusAction(taskId, next);
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!canWrite || busy}
      className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
      data-testid="task-toggle"
    >
      {status === "DONE" ? "Reopen" : "Mark done"}
    </button>
  );
}
