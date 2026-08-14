import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { hexToHslTriplet } from "@/lib/branding";
import { CHECKLIST_KEYS, parseChecklist, progressPercent } from "@/lib/onboarding";
import { OnboardingResume } from "@/components/onboarding-resume";
import { OnboardingChecklistWidget } from "@/components/onboarding-checklist";
import { AppShell } from "./app-shell";
import { MobileNav } from "@/components/nav/mobile-nav";
import { SidebarLink } from "@/components/nav/sidebar-link";
import { UserMenu } from "@/components/nav/user-menu";
import { Kbd } from "@/components/ui/kbd";
import { NAV_SECTIONS } from "@/components/nav/nav-config";
import { Sparkles, Search } from "lucide-react";

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
    <AppShell>
      <div className="flex min-h-screen" data-testid="app-sidebar">
        {brandTriplet && (
          <div data-testid="brand-style">
            <style dangerouslySetInnerHTML={{ __html: `:root{--primary:${brandTriplet};}` }} />
            {`--primary:${brandTriplet}`}
          </div>
        )}
        <OnboardingResume incomplete={forceWizard} />

        {/* Desktop sidebar */}
        <aside className="hidden w-60 flex-col border-r bg-card md:flex">
          <div className="flex items-center gap-2 p-5 text-lg font-bold">
            {workspace.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/branding/logo" alt={workspace.name} className="h-8 w-8 rounded object-contain" data-testid="app-logo" />
            ) : null}
            {brandName ?? (
              <span>Vaani <span className="text-primary">AI</span></span>
            )}
          </div>
          <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
            <button
              type="button"
              data-testid="desktop-command-trigger"
              onClick={() => document.dispatchEvent(new Event("vaani:open-command"))}
              className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Search className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">Search…</span>
              <Kbd>⌘K</Kbd>
            </button>
            <SidebarLink item={{ label: "Setup", href: "/onboarding", icon: Sparkles }} />
            {NAV_SECTIONS.map((s) => (
              <div key={s.section}>
                <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.section}
                </p>
                <div className="space-y-1">
                  {s.items.map((item) => (
                    <SidebarLink key={item.href} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t p-4">
            <p className="text-xs text-muted-foreground">Wallet</p>
            <p className="font-semibold text-primary">{formatINR(wallet?.balancePaise ?? 0)}</p>
            <UserMenu
              name={ctx.user.fullName ?? ctx.user.email}
              email={ctx.user.email}
              onOpenCommandPalette={() => document.dispatchEvent(new Event("vaani:open-command"))}
            />
          </div>
        </aside>

        {/* Mobile header */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b bg-card px-4 py-3 md:hidden">
            <MobileNav sections={NAV_SECTIONS} />
            <span className="text-base font-bold">
              {brandName ?? (
                <span>Vaani <span className="text-primary">AI</span></span>
              )}
            </span>
            <button
              type="button"
              aria-label="Open command menu"
              data-testid="mobile-command-trigger"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              onClick={() => document.dispatchEvent(new Event("vaani:open-command"))}
            >
              <Search className="h-4 w-4" />
            </button>
          </header>
          <main className="flex-1 p-4 md:p-8">
            <OnboardingChecklistWidget
              checklist={checklist}
              progress={progressPercent(checklist)}
              completed={completed}
              sampleDataEnabled={onboarding?.sampleDataEnabled ?? false}
            />
            {children}
          </main>
        </div>
      </div>
    </AppShell>
  );
}
