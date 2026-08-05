"use client";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TEAL = "#2dd4bf";
const COLORS = ["#2dd4bf", "#60a5fa", "#f59e0b", "#f87171", "#a78bfa", "#34d399"];

type Daily = { date: string; calls: number; minutes: number; billed: number };
type Named = { name: string; value: number };

export function AnalyticsCharts({ daily, outcomes, costs }: {
  daily: Daily[]; outcomes: Named[]; costs: Named[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Calls per day</CardTitle></CardHeader>
        <CardContent className="h-64" data-testid="chart-calls-per-day">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily}>
              <XAxis dataKey="date" stroke="#6b7a90" fontSize={12} />
              <YAxis stroke="#6b7a90" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              <Area type="monotone" dataKey="calls" stroke={TEAL} fill={TEAL} fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Revenue billed per day (₹)</CardTitle></CardHeader>
        <CardContent className="h-64" data-testid="chart-revenue-per-day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily}>
              <XAxis dataKey="date" stroke="#6b7a90" fontSize={12} />
              <YAxis stroke="#6b7a90" fontSize={12} />
              <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              <Bar dataKey="billed" fill={TEAL} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Outcomes</CardTitle></CardHeader>
        <CardContent className="h-64" data-testid="chart-outcomes">
          {outcomes.length === 0 ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">No outcomes yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomes} dataKey="value" nameKey="name" outerRadius={80} label>
                  {outcomes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
                <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Wholesale cost breakdown (₹, 30 days)</CardTitle></CardHeader>
        <CardContent className="h-56" data-testid="chart-cost-breakdown">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costs} layout="vertical">
              <XAxis type="number" stroke="#6b7a90" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="#6b7a90" fontSize={12} width={90} />
              <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              <Bar dataKey="value" fill="#60a5fa" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
