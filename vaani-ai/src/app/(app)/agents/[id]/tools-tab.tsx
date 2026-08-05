"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentToolConfig, AgentToolType } from "@prisma/client";
import { upsertToolConfigAction, testToolAction } from "@/server/actions/tools";
import { TOOL_META } from "@/lib/tool-configs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** One config field schema per tool (drives simple inputs; CUSTOM_WEBHOOK uses JSON). */
const FIELDS: Record<AgentToolType, { name: string; label: string; kind: "text" | "number" | "checkbox" | "json" }[]> = {
  CALENDAR_BOOKING: [
    { name: "provider", label: "provider (google | microsoft | calendly | calcom)", kind: "text" },
    { name: "calendarId", label: "calendar id (google: 'primary')", kind: "text" },
    { name: "slotMinutes", label: "slot length (minutes)", kind: "number" },
    { name: "eventTitle", label: "event title", kind: "text" },
  ],
  HUMAN_TRANSFER: [
    { name: "queue", label: "queue (e.g. support, sales)", kind: "text" },
    { name: "skill", label: "skill (e.g. hindi, loans)", kind: "text" },
    { name: "fallbackNumber", label: "fallback transfer number (E.164, optional)", kind: "text" },
    { name: "whisperSummary", label: "whisper call summary to the human", kind: "checkbox" },
  ],
  SMS: [{ name: "messageTemplate", label: "message template ({{name}} {{details}} {{business_name}})", kind: "text" }],
  WHATSAPP: [
    { name: "templateName", label: "approved WhatsApp template name", kind: "text" },
    { name: "paramsHint", label: "parameter hint (what to fill)", kind: "text" },
  ],
  CRM_WRITE: [
    { name: "provider", label: "CRM (HUBSPOT | ZOHO …, empty = any connected)", kind: "text" },
    { name: "objectType", label: "object type (contact | lead)", kind: "text" },
    { name: "logCallOutcome", label: "log call outcome to CRM", kind: "checkbox" },
  ],
  PAYMENT_LINK: [
    { name: "amountPaise", label: "fixed amount in paise (optional; else asked on call)", kind: "number" },
    { name: "description", label: "payment description", kind: "text" },
    { name: "sendVia", label: "send link via (whatsapp | sms | readout)", kind: "text" },
  ],
  CUSTOM_WEBHOOK: [
    { name: "url", label: "endpoint URL", kind: "text" },
    { name: "method", label: "method (POST | GET)", kind: "text" },
    { name: "authHeader", label: "Authorization header value (optional)", kind: "text" },
    { name: "responseMapping", label: 'response mapping JSON, e.g. {"status":"data.order.status"}', kind: "json" },
  ],
  VOICEMAIL: [
    { name: "transcribe", label: "transcribe messages", kind: "checkbox" },
    { name: "notifyEmail", label: "notify email (optional)", kind: "text" },
  ],
};

export function ToolsTab({ agentId, toolConfigs }: { agentId: string; toolConfigs: AgentToolConfig[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; output?: string }>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(res.output ? `${label} OK:\n${res.output}` : `${label} done.`);
    router.refresh();
  }

  function readForm(form: HTMLFormElement, tool: AgentToolType) {
    const f = new FormData(form);
    const existing = toolConfigs.find((t) => t.tool === tool);
    const config: Record<string, unknown> = { ...((existing?.config ?? {}) as Record<string, unknown>) };
    for (const field of FIELDS[tool]) {
      if (field.kind === "checkbox") {
        config[field.name] = f.get(field.name) === "on";
      } else if (field.kind === "number") {
        const raw = String(f.get(field.name) ?? "");
        config[field.name] = raw === "" ? undefined : Number(raw);
      } else if (field.kind === "json") {
        const raw = String(f.get(field.name) ?? "").trim();
        if (raw) {
          try {
            config[field.name] = JSON.parse(raw);
          } catch {
            throw new Error(`Invalid JSON in "${field.label}".`);
          }
        }
      } else {
        const raw = String(f.get(field.name) ?? "");
        if (raw !== "") config[field.name] = raw;
      }
    }
    return { enabled: f.get("enabled") === "on", config };
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tools the agent can trigger mid-call. Saved tools are wired into the workflow
        on the next Publish. &quot;Test tool&quot; dry-runs the same executor used in live calls
        (VAANI_DRY_RUN=true — nothing is actually sent or charged).
      </p>
      {error && <p className="whitespace-pre-wrap text-sm text-red-400">{error}</p>}
      {notice && <p className="whitespace-pre-wrap text-sm text-green-400">{notice}</p>}
      {TOOL_META.map((meta) => {
        const row = toolConfigs.find((t) => t.tool === meta.tool);
        const cfg = (row?.config ?? {}) as Record<string, unknown>;
        return (
          <Card key={meta.tool} data-testid={`tool-section-${meta.tool}`}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{meta.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{meta.tool}</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const data = readForm(e.currentTarget, meta.tool);
                    await run(`Save ${meta.tool}`, () => upsertToolConfigAction(agentId, { tool: meta.tool, ...data }));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Check the form.");
                  }
                }}
                className="space-y-3"
              >
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? false}
                    className="h-4 w-4" data-testid={`tool-enable-${meta.tool}`} />
                  Enabled
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS[meta.tool].map((field) =>
                    field.kind === "checkbox" ? (
                      <label key={field.name} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name={field.name} defaultChecked={cfg[field.name] === true} className="h-4 w-4" />
                        {field.label}
                      </label>
                    ) : (
                      <label key={field.name} className="block space-y-1">
                        <span className="text-xs text-muted-foreground">{field.label}</span>
                        {field.kind === "json" ? (
                          <textarea name={field.name} rows={2}
                            defaultValue={cfg[field.name] ? JSON.stringify(cfg[field.name]) : ""}
                            className="w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs" />
                        ) : (
                          <Input name={field.name} type={field.kind === "number" ? "number" : "text"}
                            defaultValue={cfg[field.name] !== undefined ? String(cfg[field.name]) : ""} />
                        )}
                      </label>
                    ),
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" type="submit" disabled={busy !== null} data-testid={`tool-save-${meta.tool}`}>
                    Save {meta.label}
                  </Button>
                  {meta.testable && (
                    <Button size="sm" variant="outline" type="button" disabled={busy !== null}
                      data-testid={`tool-test-${meta.tool}`}
                      onClick={() => run(`Test ${meta.tool}`, () => testToolAction(agentId, meta.tool))}>
                      Test tool (dry run)
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Transfer queue UI is guide 06; campaign usage of agents is guide 07; payment
        links are Razorpay test-mode (VAANI_DRY_RUN). CRM_WRITE needs a connected CRM
        (Settings → Integrations).
      </p>
    </div>
  );
}
