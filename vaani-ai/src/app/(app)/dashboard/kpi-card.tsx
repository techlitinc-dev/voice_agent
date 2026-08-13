import { Card } from "@/components/ui/card";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  trend?: { value: number; positive: boolean }; // % change vs previous period
  icon?: React.ReactNode;
  sub?: string;
  accent?: boolean;
}

/** Trend direction: % change with sign. A positive number is a good trend. */
export function isPositiveTrend(trend: number): boolean {
  return trend >= 0;
}

export function KpiCard({ label, value, trend, icon, sub, accent }: KpiCardProps) {
  return (
    <Card className="p-4" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p className={`text-2xl font-bold ${accent ? "text-primary" : ""}`}>{value}</p>
      {trend && (
        <div
          className={`flex items-center gap-1 text-xs mt-1 ${
            trend.positive ? "text-green-600" : "text-red-600"
          }`}
          data-testid={`kpi-trend-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {trend.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span>{Math.abs(trend.value)}% vs previous</span>
        </div>
      )}
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}
