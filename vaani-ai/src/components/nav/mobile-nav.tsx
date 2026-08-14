"use client";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarLink, type SidebarNavItem } from "@/components/nav/sidebar-link";

export function MobileNav({
  sections,
}: {
  sections: { section: string; items: SidebarNavItem[] }[];
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" data-testid="mobile-nav-trigger">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <nav className="space-y-4 overflow-y-auto py-4">
          {sections.map((s) => (
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
      </SheetContent>
    </Sheet>
  );
}
