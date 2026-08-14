"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/money";
import type { ReportConfig, ReportResult, MetricKey, FilterCondition } from "@/lib/reports/types";
import type { ReportTemplate } from "@/lib/reports/templates";
import { saveReport, scheduleReport } from "@/server/actions/reports";

const SOURCES = ["calls", "campaigns", "deals", "cost", "contacts", "tasks", "activities"] as const;
const METRICS: { key: MetricKey; label: string }[] = [
  { key: "count", label: "Call count" },
  { key: "avgDuration", label: "Avg duration" },
  { key: "sumDuration", label: "Total duration" },
  { key: "sumBilled", label: "Total billed" },
  { key: "avgBilled", label: "Avg billed" },
  { key: "connectRate", label: "Connect rate" },
  { key: "hotCount", label: "HOT count" },
  { key: "warmCount", label: "Warm count" },
  { key: "coldCount", label: "Cold count" },
  { key: "sumCost", label: "Total cost" },
  { key: "margin", label: "Margin" },
  { key: "marginPercent", label: "Margin %" },
];
const GROUP_OPTIONS = ["day", "week", "month", "hour", "agentId", "campaignId", "direction", "status", "interestScore"];
const CHART_TYPES = ["table", "bar", "line", "pie", "area"] as const;
const RANGE_PRESETS = ["today", "yesterday", "7d", "30d", "90d", "month", "lastmonth", "quarter"];

function emptyConfig(): ReportConfig {
  return {
    source: "calls",
    dateRange: { preset: "30d" },
    filters: [],
    groupBy: ["day"],
    metrics: ["count", "sumBilled"],
    chart: { type: "table" },
    limit: 1000,
  };
}

export function ReportBuilder({
  templates,
  agents,
  defaultConfig,
}: {
  templates: ReportTemplate[];
  agents: { id: string; name: string }[];
  defaultConfig?: ReportConfig;
}) {
  const [config, setConfig] = useState<ReportConfig>(defaultConfig ?? emptyConfig());
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"shared" | "private">("shared");
  const [preview, setPreview] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [recipients, setRecipients] = useState("");

  function patch(p: Partial<ReportConfig>) {
    setConfig((c) => ({ ...c, ...p }));
    setPreview(null);
  }
  function patchChart(p: Partial<ReportConfig["chart"]>) {
    setConfig((c) => ({ ...c, chart: { ...c.chart, ...p } }));
  }
  function toggleMetric(key: MetricKey) {
    setConfig((c) => ({
      ...c,
      metrics: c.metrics.includes(key) ? c.metrics.filter((m) => m !== key) : [...c.metrics, key],
    }));
  }
  function toggleGroup(g: string) {
    setConfig((c) => ({
      ...c,
      groupBy: c.groupBy.includes(g) ? c.groupBy.filter((x) => x !== g) : [...c.groupBy, g],
    }));
  }
  function addFilter() {
    setConfig((c) => ({ ...c, filters: [...c.filters, { field: "direction", op: "eq", value: "OUTBOUND" }] }));
  }
  function updateFilter(i: number, patchF: Partial<FilterCondition>) {
    setConfig((c) => {
      const filters = c.filters.map((f, idx) => (idx === i ? { ...f, ...patchF } : f));
      return { ...c, filters };
    });
  }
  function removeFilter(i: number) {
    setConfig((c) => ({ ...c, filters: c.filters.filter((_, idx) => idx !== i) }));
  }

  function applyTemplate(t: ReportTemplate) {
    setConfig(JSON.parse(JSON.stringify(t.config)) as ReportConfig);
    setName(t.name);
    setPreview(null);
    setError(null);
  }

  async function runPreview() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/reports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (json.ok) setPreview(json.data as ReportResult);
      else setError(json.error ?? "Preview failed");
    } catch {
      setError("Network error running preview");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    const r = await saveReport({ name: name || config.title || "Untitled report", visibility, config });
    if (r.ok) {
      setSaveMsg(`Saved (${r.id}).`);
      setTimeout(() => setSaveMsg(null), 3000);
    } else setError(r.error ?? "Save failed");
  }

  async function handleSchedule() {
    const r = await saveReport({ name: name || config.title || "Untitled report", visibility, config });
    if (!r.ok) {
      setError(r.error ?? "Save failed");
      return;
    }
    if (!r.id) {
      setError("Save failed");
      return;
    }
    const s = await scheduleReport({ reportId: r.id, frequency, recipients });
    if (s.ok) setSaveMsg(`Saved and scheduled (${frequency.toLowerCase()}).`);
    else setError(s.error ?? "Schedule failed");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left: builder */}
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Templates</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <Button key={t.id} variant="outline" size="sm" data-testid={`template-${t.id}`} onClick={() => applyTemplate(t)}>
                {t.name}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Report</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">
                Name
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly sales summary" className="mt-1 w-56" data-testid="report-name" />
              </label>
              <label className="text-sm">
                Visibility
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as "shared" | "private")}
                  className="mt-1 h-9 rounded-md border border-border bg-background px-3 text-sm"
                  data-testid="report-visibility"
                >
                  <option value="shared">Shared (workspace)</option>
                  <option value="private">Private (me)</option>
                </select>
              </label>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Source</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {SOURCES.map((s) => (
                  <button
                    key={s}
                    onClick={() => patch({ source: s })}
                    className={`rounded-md border px-3 py-1.5 text-sm capitalize ${config.source === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                    data-testid={`source-${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">
                Date range
                <select
                  value={config.dateRange.preset}
                  onChange={(e) => patch({ dateRange: { preset: e.target.value } })}
                  className="mt-1 h-9 rounded-md border border-border bg-background px-3 text-sm"
                  data-testid="report-range"
                >
                  {RANGE_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Filters</CardTitle>
            <Button size="sm" variant="outline" onClick={addFilter} data-testid="add-filter">+ Add filter</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {config.filters.length === 0 && <p className="text-sm text-muted-foreground">No filters — all calls in range.</p>}
            {config.filters.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={f.field}
                  onChange={(e) => updateFilter(i, { field: e.target.value })}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  {["direction", "status", "agentId", "campaignId", "interestScore", "outcome"].map((fld) => <option key={fld} value={fld}>{fld}</option>)}
                </select>
                <select
                  value={f.op}
                  onChange={(e) => updateFilter(i, { op: e.target.value as FilterCondition["op"] })}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  {["eq", "neq", "in", "isnull"].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {f.op !== "isnull" && (
                  <Input
                    value={typeof f.value === "string" ? f.value : String(f.value ?? "")}
                    onChange={(e) => updateFilter(i, { value: e.target.value })}
                    className="h-9 w-40"
                    placeholder="value"
                  />
                )}
                {f.field === "agentId" && (
                  <select
                    value={String(f.value ?? "")}
                    onChange={(e) => updateFilter(i, { value: e.target.value })}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  >
                    <option value="">—</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
                <Button size="sm" variant="ghost" onClick={() => removeFilter(i)} data-testid="remove-filter">✕</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Group by</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {GROUP_OPTIONS.map((g) => (
              <button
                key={g}
                onClick={() => toggleGroup(g)}
                className={`rounded-md border px-3 py-1.5 text-sm ${config.groupBy.includes(g) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                data-testid={`group-${g}`}
              >
                {g}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Metrics</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {METRICS.map((m) => (
              <label key={m.key} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={config.metrics.includes(m.key)}
                  onChange={() => toggleMetric(m.key)}
                  data-testid={`metric-${m.key}`}
                />
                {m.label}
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Chart</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              {CHART_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => patchChart({ type: t })}
                  className={`rounded-md border px-3 py-1.5 text-sm capitalize ${config.chart.type === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                  data-testid={`chart-${t}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <label className="text-sm">
              Sort by
              <select
                value={config.sortBy?.field ?? ""}
                onChange={(e) => patch({ sortBy: e.target.value ? { field: e.target.value, direction: config.sortBy?.direction ?? "desc" } : undefined })}
                className="ml-1 h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {["count", "sumBilled", "avgDuration", "day", "date"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-500" data-testid="builder-error">{error}</p>}
        {saveMsg && <p className="text-sm text-green-500" data-testid="builder-saved">{saveMsg}</p>}

        <div className="flex flex-wrap gap-2">
          <Button onClick={runPreview} disabled={loading} data-testid="preview-button">
            {loading ? "Running…" : "Preview"}
          </Button>
          <Button variant="outline" onClick={handleSave} data-testid="save-button">Save</Button>
          <Button variant="outline" onClick={() => setScheduleOpen((o) => !o)} data-testid="schedule-button">Save & Schedule</Button>
        </div>

        {scheduleOpen && (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <label className="text-sm">
                Frequency
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className="ml-2 h-9 rounded-md border border-border bg-background px-3 text-sm">
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </label>
              <Input placeholder="owner@clinic.in, manager@clinic.in" value={recipients} onChange={(e) => setRecipients(e.target.value)} data-testid="schedule-recipients" />
              <Button size="sm" onClick={handleSchedule} data-testid="schedule-save">Schedule</Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: preview */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Preview</CardTitle>
          {preview && (
            <div className="flex gap-2">
              <Badge variant="secondary">{preview.columns.length} cols</Badge>
              <Badge variant="secondary">{preview.rows.length} rows</Badge>
            </div>
          )}
        </CardHeader>
        <CardContent data-testid="report-preview">
          {!preview && !loading && <p className="pt-16 text-center text-sm text-muted-foreground">Configure and press Preview.</p>}
          {loading && <p className="pt-16 text-center text-sm text-muted-foreground">Running…</p>}
          {preview && preview.rows.length === 0 && <p className="pt-16 text-center text-sm text-muted-foreground">No rows for this configuration.</p>}
          {preview && preview.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="preview-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {preview.columns.map((c) => <th key={c} className="p-2">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {preview.columns.map((c) => (
                        <td key={c} className="p-2">
                          {typeof row[c] === "number" && (c.includes("billed") || c === "margin" || c === "sumCost") ? formatINR(Number(row[c])) : String(row[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
