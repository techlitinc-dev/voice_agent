"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRightLeft,
  BarChart3,
  BookOpen,
  Bot,
  FileBarChart,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Radio,
  Settings,
  Sparkles,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type SidebarNavItem = {
  label: string;
  href: string;
  /** Icon name from nav-config — resolved via ICONS below (client-side). */
  icon: string;
};

const ICONS: Record<string, LucideIcon> = {
  ArrowRightLeft,
  BarChart3,
  BookOpen,
  Bot,
  FileBarChart,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Radio,
  Settings,
  Sparkles,
  Store,
  Users,
  Wallet,
};

export function SidebarLink({
  item,
  badgeCount,
  onClick,
}: {
  item: SidebarNavItem;
  badgeCount?: number;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = ICONS[item.icon] ?? Sparkles;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{item.label}</span>
      {badgeCount !== undefined && badgeCount > 0 && (
        <Badge variant={active ? "secondary" : "default"} className="h-5 px-1.5 text-xs">
          {badgeCount}
        </Badge>
      )}
    </Link>
  );
}
