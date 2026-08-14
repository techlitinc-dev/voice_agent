"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CheckSquare, KanbanSquare, ListFilter, Stamp, UsersRound, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  CheckSquare,
  KanbanSquare,
  ListFilter,
  Stamp,
  UsersRound,
};

export function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = ICONS[icon] ?? KanbanSquare;
  return (
    <Link
      href={href}
      data-testid={`nav-${label.toLowerCase()}`}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
