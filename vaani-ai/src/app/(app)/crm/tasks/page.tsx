import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { fetchTaskBuckets } from "@/lib/crm";
import { TaskRow } from "./task-row";
import { NewTaskForm } from "./new-task-form";

export const metadata = { title: "Tasks — Vaani AI" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { tab?: string; assignee?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [buckets, deals, contacts, users] = await Promise.all([
    fetchTaskBuckets(ctx.workspaceId, { assigneeId: searchParams.assignee, assigneeUserId: ctx.user.id }),
    db.deal.findMany({ where: { workspaceId: ctx.workspaceId, status: "OPEN" }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.contact.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true, phone: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.membership.findMany({ where: { workspaceId: ctx.workspaceId }, select: { user: { select: { id: true, fullName: true } } } }),
  ]);

  const tab = searchParams.tab ?? "today";
  const tabs = [
    { key: "today", label: "Today", count: buckets.today.length },
    { key: "upcoming", label: "Upcoming", count: buckets.upcoming.length },
    { key: "overdue", label: "Overdue", count: buckets.overdue.length },
    { key: "completed", label: "Completed", count: buckets.completed.length },
  ] as const;
  const visible = buckets[tab as keyof typeof buckets] ?? buckets.today;

  return (
    <div className="space-y-6" data-testid="tasks-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <div className="flex items-center gap-3">
          <NewTaskForm
            deals={deals}
            contacts={contacts}
            users={users.map((m) => m.user)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2" data-testid="task-tabs">
        {tabs.map((t) => (
          <a
            key={t.key}
            href={`/crm/tasks?tab=${t.key}${searchParams.assignee ? `&assignee=${searchParams.assignee}` : ""}`}
            className={`rounded-full px-3 py-1 text-sm ${tab === t.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}
            data-testid={`tab-${t.key}`}
          >
            {t.label} ({t.count})
          </a>
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        {visible.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No tasks in this view.</p>
        )}
        {visible.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}
