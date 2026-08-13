import * as React from "react";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  title: string;
  description?: string | null;
  time?: string;
  icon?: React.ReactNode;
  color?: string;
}

export function Timeline({
  items,
  className,
}: {
  items: TimelineItem[];
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <div className="absolute bottom-0 left-4 top-0 w-px bg-border" />
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="relative flex gap-3 py-3">
            <div
              className={cn(
                "relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
                item.color ?? "bg-muted"
              )}
            >
              {item.icon}
            </div>
            <div className="min-w-0 flex-1 border-b pb-3 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{item.title}</p>
                {item.time && <span className="text-xs text-muted-foreground">{item.time}</span>}
              </div>
              {item.description && (
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
