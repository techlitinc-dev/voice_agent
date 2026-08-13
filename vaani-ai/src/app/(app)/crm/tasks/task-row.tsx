"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { taskTypeIcon } from "@/components/crm/task-type-icon";
import { updateTaskStatusAction } from "@/server/actions/crm";
import type { TaskWithRelations } from "@/lib/crm";

function formatDateTime(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ", " +
    d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

/** One task row with optimistic complete checkbox (guide crm/03 §2.2). */
export function TaskRow({ task }: { task: TaskWithRelations }) {
  const router = useRouter();
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = optimisticDone || task.status === "DONE";
  const isOverdue = !done && task.status === "PENDING" && new Date(task.dueAt) < new Date();

  async function onToggle(checked: boolean) {
    if (busy) return;
    setBusy(true);
    setOptimisticDone(checked);
    const res = await updateTaskStatusAction(task.id, checked ? "DONE" : "PENDING");
    setBusy(false);
    if (!res.ok) {
      setOptimisticDone(!checked);
    }
    router.refresh();
  }

  const Icon = taskTypeIcon(task.type);

  return (
    <div className={`flex items-start gap-3 border-b p-3 last:border-0 hover:bg-muted/30 ${isOverdue ? "bg-red-50" : ""}`} data-testid="task-row">
      <Checkbox
        checked={done}
        disabled={busy}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5"
        data-testid="task-checkbox"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <p className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{task.title}</p>
        </div>
        {task.description && <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {task.deal && (
            <span>
              Deal: <Link href={`/crm/deals/${task.deal.id}`} className="text-primary hover:underline">{task.deal.title}</Link>
            </span>
          )}
          {task.contact && <span>{task.contact.name ?? task.contact.phone}</span>}
          <span className={isOverdue ? "font-medium text-red-600" : ""}>
            {isOverdue ? `OVERDUE ${Math.max(1, Math.floor((Date.now() - new Date(task.dueAt).getTime()) / 86400000))}d · ` : "Due: "}
            {formatDateTime(task.dueAt)}
          </span>
          {task.assignee && <span>• {task.assignee.fullName}</span>}
        </div>
      </div>
      {task.status === "PENDING" && isOverdue && (
        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">OVERDUE</span>
      )}
    </div>
  );
}
