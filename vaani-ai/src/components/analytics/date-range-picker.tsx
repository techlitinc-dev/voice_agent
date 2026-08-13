"use client";

import { useRouter, useSearchParams } from "next/navigation";

export const RANGE_PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
  { label: "This month", value: "month" },
  { label: "Last month", value: "lastmonth" },
  { label: "This quarter", value: "quarter" },
  { label: "Custom range…", value: "custom" },
] as const;

export function DateRangePicker({ current, param = "range" }: { current?: string; param?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = current ?? searchParams.get(param) ?? "7d";

  return (
    <select
      aria-label="Date range"
      data-testid="date-range-picker"
      className="h-9 rounded-md border border-border bg-background px-3 text-sm"
      value={active}
      onChange={(e) => {
        const v = e.target.value;
        const sp = new URLSearchParams(searchParams.toString());
        if (v === "7d") sp.delete(param);
        else sp.set(param, v);
        router.push(`?${sp.toString()}`);
      }}
    >
      {RANGE_PRESETS.map((p) => (
        <option key={p.value} value={p.value}>{p.label}</option>
      ))}
    </select>
  );
}
