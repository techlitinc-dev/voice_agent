"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STAGE_COLORS = ["#60a5fa", "#2dd4bf", "#a78bfa", "#34d399"];

export function FunnelChart({
  funnel,
}: {
  funnel: { dialed: number; answered: number; qualified: number; booked: number };
}) {
  const data = [
    { stage: "Dialed", count: funnel.dialed },
    { stage: "Answered", count: funnel.answered },
    { stage: "Qualified", count: funnel.qualified },
    { stage: "Booked", count: funnel.booked },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical">
        <XAxis type="number" stroke="#6b7a90" fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="stage" stroke="#6b7a90" fontSize={12} width={80} />
        <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={STAGE_COLORS[i]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Pure-CSS heatmap grid: 7 rows (days) × 24 columns (hours), intensity = count/max. */
export function Heatmap({ heat, max, days }: { heat: number[][]; max: number; days: string[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        <div className="mb-1 flex">
          <div className="w-10" />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="w-6 text-center text-[10px] text-muted-foreground">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {heat.map((row, d) => (
          <div key={d} className="flex items-center">
            <div className="w-10 text-xs text-muted-foreground">{days[d]}</div>
            {row.map((count, h) => (
              <div
                key={h}
                title={`${days[d]} ${h}:00 — ${count} answered`}
                data-testid={`heatmap-cell-${d}-${h}`}
                className="m-px h-5 w-5 rounded-sm"
                style={{
                  backgroundColor:
                    count === 0 ? "#131c2e" : `rgba(45, 212, 191, ${0.25 + (0.75 * count) / max})`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
