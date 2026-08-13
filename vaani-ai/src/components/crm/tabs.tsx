"use client";
import { useState } from "react";

export function Tabs({
  tabs,
  children,
  defaultTab,
}: {
  tabs: { key: string; label: string }[];
  children: (active: string) => React.ReactNode;
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
      <div className="pt-4">{children(active)}</div>
    </div>
  );
}
