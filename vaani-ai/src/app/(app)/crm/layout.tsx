import { NavLink } from "../nav-link";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CRM</h1>
      </div>
      <nav className="flex gap-1 border-b pb-2">
        <NavLink href="/crm/pipeline" label="Pipeline" icon="KanbanSquare" />
        <NavLink href="/crm/deals" label="Deals" icon="ListFilter" />
        <NavLink href="/crm/tasks" label="Tasks" icon="CheckSquare" />
        <NavLink href="/crm/approvals" label="Approvals" icon="Stamp" />
        <NavLink href="/crm/segments" label="Segments" icon="UsersRound" />
        <NavLink href="/crm/analytics" label="Analytics" icon="BarChart3" />
      </nav>
      {children}
    </div>
  );
}
