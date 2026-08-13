import { NavLink } from "../nav-link";
import { KanbanSquare, ListFilter, CheckSquare, UsersRound, BarChart3 } from "lucide-react";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CRM</h1>
      </div>
      <nav className="flex gap-1 border-b pb-2">
        <NavLink href="/crm/pipeline" label="Pipeline" icon={<KanbanSquare className="h-4 w-4" />} />
        <NavLink href="/crm/deals" label="Deals" icon={<ListFilter className="h-4 w-4" />} />
        <NavLink href="/crm/tasks" label="Tasks" icon={<CheckSquare className="h-4 w-4" />} />
        <NavLink href="/crm/segments" label="Segments" icon={<UsersRound className="h-4 w-4" />} />
        <NavLink href="/crm/analytics" label="Analytics" icon={<BarChart3 className="h-4 w-4" />} />
      </nav>
      {children}
    </div>
  );
}
