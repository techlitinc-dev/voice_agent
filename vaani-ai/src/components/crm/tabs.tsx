"use client";
import { useState, type ReactNode } from "react";

/**
 * Tab switcher. Children are plain ReactNode panels keyed by tab.key — NOT a
 * render function, so server components can pass them directly (functions
 * can't cross the server→client boundary in the app router).
 */
export function Tabs({
  tabs,
  children,
  defaultTab,
}: {
  tabs: { key: string; label: string }[];
  children: ReactNode[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key ?? "");
  return (
    <div>
      <div className="flex gap-1 border-b pb-2" data-testid="contact-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`rounded-md px-3 py-1 text-sm ${active === t.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="pt-4">
        {tabs.map((t, i) => (
          <div key={t.key} hidden={active !== t.key} data-testid={`tab-panel-${t.key}`}>
            {children[i]}
          </div>
        ))}
      </div>
    </div>
  );
}
