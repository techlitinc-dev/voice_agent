import type { ReactNode } from "react";

/**
 * Minimal tooltip (readme §13 in-app guidance). Wrap any element; the label shows
 * on hover/focus. `testid` gives Playwright a stable handle on the trigger wrapper.
 */
export function Tooltip({
  label,
  children,
  testid,
}: {
  label: string;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <span className="group relative inline-flex" data-testid={testid}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-2 left-1/2 z-50 w-56 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
