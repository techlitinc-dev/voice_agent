import * as React from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/sparkline";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  trend?: { value: number; positive: boolean; label?: string };
  accent?: "default" | "success" | "warning" | "destructive";
  sparkline?: number[];
  className?: string;
}

const ACCENT_CLASSES: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "text-foreground",
  success: "text-green-500",
  warning: "text-amber-500",
  destructive: "text-red-500",
};

const TREND_CLASSES = {
  positive: "text-green-500",
  negative: "text-red-500",
} as const;

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  accent = "default",
  sparkline,
  className,
}: StatCardProps) {
  return (
    <Card className={className ?? "p-4 transition-shadow hover:shadow-md"}>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${ACCENT_CLASSES[accent]}`}>{value}</p>
        </div>
        {Icon && (
          <div className="rounded-lg bg-muted p-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {trend && (
        <div
          className={`mt-1 flex items-center gap-1 text-xs ${
            trend.positive ? TREND_CLASSES.positive : TREND_CLASSES.negative
          }`}
        >
          {trend.positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          <span>
            {Math.abs(trend.value)}% {trend.label || "vs previous"}
          </span>
        </div>
      )}
      {sparkline && <Sparkline data={sparkline} className="mt-2" />}
    </Card>
  );
}
