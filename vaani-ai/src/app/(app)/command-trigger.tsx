"use client";

import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

export function DesktopCommandTrigger() {
  return (
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
  );
}

export function MobileCommandTrigger() {
  return (
    <button
      type="button"
      aria-label="Open command menu"
      data-testid="mobile-command-trigger"
      className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      onClick={() => document.dispatchEvent(new Event("vaani:open-command"))}
    >
      <Search className="h-4 w-4" />
    </button>
  );
}
