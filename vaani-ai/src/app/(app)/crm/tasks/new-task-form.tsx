"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createTaskAction } from "@/server/actions/crm";
import { TASK_TYPE_LABELS } from "@/components/crm/task-type-icon";

const TYPES = Object.keys(TASK_TYPE_LABELS) as (keyof typeof TASK_TYPE_LABELS)[];

export function NewTaskForm({
  deals,
  contacts,
  users,
  defaultDealId,
  defaultContactId,
}: {
  deals: { id: string; title: string }[];
  contacts: { id: string; name: string | null; phone: string }[];
  users: { id: string; fullName: string }[];
  defaultDealId?: string;
  defaultContactId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("CALL");
  const [dealId, setDealId] = useState(defaultDealId ?? "");
  const [contactId, setContactId] = useState(defaultContactId ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState(() => new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    if (!dueAt) { setError("Due date is required."); return; }
    setBusy(true);
    setError(null);
    const res = await createTaskAction({
      title: title.trim(),
      type: type as never,
      dealId: dealId || undefined,
      contactId: contactId || undefined,
      assigneeId: assigneeId || undefined,
      dueAt: new Date(dueAt).toISOString(),
    });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? "Could not create the task.");
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} data-testid="new-task-button">+ New task</Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border bg-card p-4" data-testid="new-task-form">
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-sm font-medium">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Follow up with Ramesh" data-testid="task-title" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Type</label>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Due</label>
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} data-testid="task-due" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Deal</label>
          <Select value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">None</option>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.title.slice(0, 40)}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Contact</label>
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">None</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </Select>
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-sm font-medium">Assignee</label>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy} data-testid="task-submit">{busy ? "Creating…" : "Create task"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
