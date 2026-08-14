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
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavSection = {
  section: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    section: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Live Calls", href: "/live", icon: Radio },
    ],
  },
  {
    section: "Voice",
    items: [
      { label: "Agents", href: "/agents", icon: Bot },
      { label: "Marketplace", href: "/marketplace", icon: Store },
      { label: "Knowledge", href: "/knowledge", icon: BookOpen },
      { label: "Calls", href: "/calls", icon: PhoneCall },
      { label: "Campaigns", href: "/campaigns", icon: Megaphone },
      { label: "Dialer", href: "/dialer", icon: PhoneForwarded },
      { label: "Numbers", href: "/numbers", icon: Phone },
      { label: "Transfers", href: "/transfers", icon: ArrowRightLeft },
    ],
  },
  {
    section: "CRM",
    items: [
      { label: "Inbox", href: "/inbox", icon: Inbox },
      { label: "Pipeline", href: "/crm/pipeline", icon: KanbanSquare },
      { label: "Deals", href: "/crm/deals", icon: FileText },
      { label: "Contacts", href: "/contacts", icon: Users },
      { label: "Analytics", href: "/crm/analytics", icon: BarChart3 },
    ],
  },
  {
    section: "Reports",
    items: [{ label: "Reports", href: "/reports", icon: FileBarChart }],
  },
  {
    section: "Account",
    items: [
      { label: "Billing", href: "/billing", icon: Wallet },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Flat list used by older spots that want a single list. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
