import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { hexToHslTriplet } from "@/lib/branding";
import { CHECKLIST_KEYS, parseChecklist, progressPercent } from "@/lib/onboarding";
import { NavLink } from "./nav-link";
import { OnboardingResume } from "@/components/onboarding-resume";
import { OnboardingChecklistWidget } from "@/components/onboarding-checklist";
import {
  LayoutDashboard, Bot, PhoneOutgoing, Users, PhoneCall, Radio, ArrowRightLeft, PhoneForwarded,
  Phone, BarChart3, Wallet, Settings, Store, BookOpen, Sparkles,
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
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [wallet, workspace, onboarding] = await Promise.all([
    db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true, logoUrl: true, primaryColor: true, whiteLabelEnabled: true },
    }),
    db.onboardingState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  // White-label (readme §3.1): brand color overrides the shadcn --primary HSL var
  // for this workspace only, injected inline (no client round-trip, no FOUC).
  const brandTriplet = workspace.primaryColor ? hexToHslTriplet(workspace.primaryColor) : null;
  const brandName = workspace.whiteLabelEnabled ? workspace.name : null;

  const checklist = parseChecklist(onboarding?.checklist);
  const completed = onboarding?.completedAt != null;
  // Force the wizard only while NOTHING is done (brand-new workspaces). A workspace
  // that has started (e.g. the seeded demo: industry+template+knowledge done) gets
  // the dashboard checklist widget instead of a hard redirect — otherwise every
  // existing-guide flow (guide 11 E2E golden path) would be hijacked to /onboarding.
  const nothingDone = !CHECKLIST_KEYS.some((k) => checklist[k]);
  const forceWizard = !completed && nothingDone;

  return (
    <div className="flex min-h-screen">
      {brandTriplet && (
        <style
          data-testid="brand-style"
          dangerouslySetInnerHTML={{ __html: `:root{--primary:${brandTriplet};}` }}
        />
      )}
      <OnboardingResume incomplete={forceWizard} />
      <aside className="flex w-60 flex-col border-r bg-card" data-testid="app-sidebar">
        <div className="flex items-center gap-2 p-5 text-lg font-bold">
          {workspace.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/branding/logo" alt={workspace.name} className="h-8 w-8 rounded object-contain" data-testid="app-logo" />
          ) : null}
          {brandName ?? (
            <span>Vaani <span className="text-primary">AI</span></span>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <NavLink href="/onboarding" label="Setup" icon={Sparkles} />
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} />
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
      <main className="flex-1 p-8">
        <OnboardingChecklistWidget
          checklist={checklist}
          progress={progressPercent(checklist)}
          completed={completed}
          sampleDataEnabled={onboarding?.sampleDataEnabled ?? false}
        />
        {children}
      </main>
    </div>
  );
}
