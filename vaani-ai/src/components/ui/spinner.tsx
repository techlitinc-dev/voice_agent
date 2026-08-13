import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const spinnerSizes = {
  sm: "h-4 w-4",
  default: "h-6 w-6",
  lg: "h-8 w-8",
  xl: "h-12 w-12",
} as const;

export function Spinner({
  size = "default",
  className,
  label = "Loading…",
}: {
  size?: keyof typeof spinnerSizes;
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2", className)}>
      <Loader2 className={cn("animate-spin", spinnerSizes[size])} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
