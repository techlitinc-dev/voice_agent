import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money";
import {
  LayoutDashboard, Bot, PhoneOutgoing, Users, PhoneCall, Phone, BarChart3, Wallet, Settings, Store, BookOpen,
  Radio, ArrowRightLeft, PhoneForwarded, HandCoins,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/campaigns", label: "Campaigns", icon: PhoneOutgoing },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/transfers", label: "Transfers", icon: ArrowRightLeft },
  { href: "/dialer", label: "Dialer", icon: PhoneForwarded },
  { href: "/numbers", label: "Numbers", icon: Phone },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/billing", label: "Billing", icon: Wallet },
  { href: "/reseller", label: "Reseller", icon: HandCoins },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const wallet = await db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } });

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="p-5 text-lg font-bold">
          Vaani <span className="text-primary">AI</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-4">
          <p className="text-xs text-muted-foreground">Wallet</p>
          <p className="font-semibold text-primary">{formatINR(wallet?.balancePaise ?? 0)}</p>
          <p className="mt-2 truncate text-xs text-muted-foreground">{ctx.user.email}</p>
          <form action={logoutAction} className="mt-2">
            <Button variant="ghost" size="sm" className="w-full justify-start px-0">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
