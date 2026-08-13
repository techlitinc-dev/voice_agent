import * as React from "react";
import { cn } from "@/lib/utils";

/** Avatar from a person's full name (initials) — no image upload in v1. */
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const sizeClasses = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-10 w-10 text-base",
} as const;

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name?: string | null;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  return (
    <span
      data-testid="avatar"
      title={name ?? undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary",
        sizeClasses[size],
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
