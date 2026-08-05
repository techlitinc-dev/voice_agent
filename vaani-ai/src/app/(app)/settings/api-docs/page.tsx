import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ENDPOINTS: Array<{ method: string; path: string; scope: string; description: string }> = [
  { method: "GET", path: "/api/v1/agents", scope: "agents:read", description: "List agents (max 200)" },
  { method: "POST", path: "/api/v1/agents", scope: "agents:write", description: "Create an agent (name, systemPrompt, greeting, …)" },
  { method: "GET", path: "/api/v1/campaigns", scope: "campaigns:read", description: "List campaigns" },
  { method: "POST", path: "/api/v1/campaigns", scope: "campaigns:write", description: "Create a campaign (agentId + listId required)" },
  { method: "GET", path: "/api/v1/contacts", scope: "contacts:read", description: "List contacts (max 500)" },
  { method: "POST", path: "/api/v1/contacts", scope: "contacts:import", description: "Bulk import/upsert up to 1000 contacts: {contacts:[…]}" },
  { method: "GET", path: "/api/v1/calls", scope: "calls:read", description: "List calls; query: status, direction, limit" },
  { method: "POST", path: "/api/v1/calls", scope: "campaigns:launch", description: "Trigger one outbound call {to, agentId}" },
  { method: "GET", path: "/api/v1/numbers", scope: "numbers:read", description: "List phone numbers" },
  { method: "POST", path: "/api/v1/numbers", scope: "numbers:write", description: "Register an existing Vobiz number + assign agent" },
];

export default async function ApiDocsPage() {
  try { await requireWorkspace(); } catch { redirect("/login"); }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Public REST API v1</h1>
      <Card>
        <CardHeader><CardTitle>Authentication & conventions</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm" data-testid="api-docs-conventions">
          <p>Send your key as <code>Authorization: Bearer &lt;key&gt;</code>. Create keys under Settings → API keys (guide 03).</p>
          <p>Rate limit: <code>PUBLIC_API_RATE_LIMIT</code> requests/minute per key (default 120) → HTTP 429 beyond.</p>
          <p>Success shape: <code>{"{ \"ok\": true, \"data\": … }"}</code>. Error shape: <code>{"{ \"ok\": false, \"error\": { \"code\", \"message\" } }"}</code>.</p>
          <p>Error codes: 401 missing/invalid/revoked/expired key · 403 insufficient scope or IP not allowlisted · 429 rate limited · 400 invalid JSON/validation · 422 referenced resource not in your workspace.</p>
          <p>SDK: copy <code>sdk/vaani.ts</code> from the repo — typed methods for every endpoint below. Publishing it to npm is an operator decision (v2).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Endpoints</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="api-docs-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Method</th><th className="p-3">Path</th><th className="p-3">Scope</th><th className="p-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={`${e.method}-${e.path}`} className="border-b last:border-0">
                  <td className="p-3 font-mono text-xs">{e.method}</td>
                  <td className="p-3 font-mono text-xs">{e.path}</td>
                  <td className="p-3 font-mono text-xs">{e.scope}</td>
                  <td className="p-3">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Webhooks (outbound events)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Subscribe under Settings → Webhooks. We POST JSON with headers
            <code> X-Vaani-Event</code>, <code> X-Vaani-Delivery</code> (id — dedupe on it),
            and <code> X-Vaani-Signature</code> = <code>sha256=&lt;HMAC-SHA256 hex of the raw body&gt;</code>
            using your subscription secret. Respond 2xx within 10s; failures retry 8 times
            with exponential backoff (30s → 1h cap).</p>
          <p>Events: call.started, call.completed, call.missed, lead.qualified,
            campaign.finished, contact.opted-out, voicemail.received, transfer.requested,
            wallet.low_balance.</p>
        </CardContent>
      </Card>
    </div>
  );
}
