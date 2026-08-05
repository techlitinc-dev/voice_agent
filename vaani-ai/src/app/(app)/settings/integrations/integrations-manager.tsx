"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  disconnectCrmAction,
  updateCrmFieldMappingAction,
  toggleCrmTwoWaySyncAction,
  testCrmConnectionAction,
  disconnectCalendarAction,
} from "@/server/actions/integrations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CrmConnRow = {
  provider: string;
  active: boolean;
  twoWaySyncEnabled: boolean;
  lastSyncAt: string | null;
  fieldMapping: Record<string, string>;
};

const CALENDAR_PROVIDERS = [
  { provider: "GOOGLE", label: "Google Calendar", implemented: true },
  { provider: "MICROSOFT", label: "Microsoft 365", implemented: false },
  { provider: "CALENDLY", label: "Calendly", implemented: false },
  { provider: "CALCOM", label: "Cal.com", implemented: false },
];

export function IntegrationsManager({
  crmProviders,
  crmConnections,
  calendarConnections,
}: {
  crmProviders: { provider: string; label: string; implemented: boolean }[];
  crmConnections: CrmConnRow[];
  calendarConnections: { provider: string; active: boolean; accountEmail: string | null; primaryCalendarId: string | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; output?: string }>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(res.output ?? `${label} done.`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="whitespace-pre-wrap text-sm text-green-400">{notice}</p>}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">CRM</h2>
        {crmProviders.map((p) => {
          const conn = crmConnections.find((c) => c.provider === p.provider);
          const connected = conn?.active === true;
          return (
            <Card key={p.provider} data-testid={`crm-card-${p.provider}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{p.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${connected ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {connected ? "CONNECTED" : p.implemented ? "NOT CONNECTED" : "V2 — OPERATOR GATE"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {!connected ? (
                    <Button size="sm" asChild={p.implemented} disabled={!p.implemented}
                      data-testid={`crm-connect-${p.provider}`}>
                      {p.implemented ? (
                        <a href={`/api/integrations/crm/${p.provider.toLowerCase()}/connect`}>Connect {p.label}</a>
                      ) : (
                        <span>Connect (guide 05 Step 13 gate)</span>
                      )}
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" disabled={busy !== null}
                        data-testid={`crm-test-${p.provider}`}
                        onClick={() => run(`Test ${p.label}`, () => testCrmConnectionAction(p.provider))}>
                        Test connection
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy !== null}
                        data-testid={`crm-disconnect-${p.provider}`}
                        onClick={() => run(`Disconnect ${p.label}`, () => disconnectCrmAction(p.provider))}>
                        Disconnect
                      </Button>
                    </>
                  )}
                </div>
                {connected && conn && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" defaultChecked={conn.twoWaySyncEnabled}
                        data-testid={`crm-twoway-${p.provider}`}
                        onChange={(e) => run("Toggle sync", () => toggleCrmTwoWaySyncAction(p.provider, e.target.checked))}
                        className="h-4 w-4" />
                      Two-way sync (pull CRM changes into Contacts every 15 min)
                      {conn.lastSyncAt && (
                        <span className="text-xs text-muted-foreground">
                          last sync {new Date(conn.lastSyncAt).toLocaleString("en-IN")}
                        </span>
                      )}
                    </label>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        run("Save mapping", () => updateCrmFieldMappingAction(p.provider, String(f.get("mapping"))));
                      }}
                      className="space-y-2"
                    >
                      <span className="text-xs text-muted-foreground">
                        Field mapping (our key → {p.label} property). Keys: contact.name,
                        contact.phone, contact.email, contact.note, call.outcome
                      </span>
                      <textarea name="mapping" rows={5} defaultValue={JSON.stringify(conn.fieldMapping, null, 2)}
                        data-testid={`crm-mapping-${p.provider}`}
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs" />
                      <Button size="sm" variant="outline" disabled={busy !== null}>Save mapping</Button>
                    </form>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Calendar</h2>
        {CALENDAR_PROVIDERS.map((p) => {
          const conn = calendarConnections.find((c) => c.provider === p.provider);
          const connected = conn?.active === true;
          return (
            <Card key={p.provider} data-testid={`calendar-card-${p.provider}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{p.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${connected ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {connected ? `CONNECTED${conn?.primaryCalendarId ? ` · ${conn.primaryCalendarId}` : ""}` : p.implemented ? "NOT CONNECTED" : "V2 — OPERATOR GATE"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!connected ? (
                  <Button size="sm" asChild={p.implemented} disabled={!p.implemented}
                    data-testid={`calendar-connect-${p.provider}`}>
                    {p.implemented ? (
                      <a href="/api/integrations/calendar/google/connect">Connect {p.label}</a>
                    ) : (
                      <span>Connect (guide 05 Step 9 gate — src/lib/calendar.ts)</span>
                    )}
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" disabled={busy !== null}
                    data-testid={`calendar-disconnect-${p.provider}`}
                    onClick={() => run(`Disconnect ${p.label}`, () => disconnectCalendarAction(p.provider))}>
                    Disconnect
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
