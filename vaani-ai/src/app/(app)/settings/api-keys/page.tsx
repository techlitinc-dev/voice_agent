import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeyCreateForm, ApiKeyRevokeButton } from "./client";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  let ctx;
  try {
    ctx = await requirePermission("apikeys:read");
  } catch {
    return (
      <p data-testid="apikeys-forbidden" className="text-sm text-red-400">
        You do not have permission to view API keys.
      </p>
    );
  }

  const keys = await db.apiKey.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  const canWrite = ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN";

  return (
    <div className="space-y-8">
      {canWrite && (
        <Card>
          <CardHeader><CardTitle>Create API key</CardTitle></CardHeader>
          <CardContent><ApiKeyCreateForm /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>API keys</CardTitle></CardHeader>
        <CardContent>
          <table data-testid="apikey-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Prefix</th>
                <th className="py-2 pr-4">Scopes</th>
                <th className="py-2 pr-4">IP allowlist</th>
                <th className="py-2 pr-4">Last used</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} data-testid="apikey-row" className="border-b align-top">
                  <td className="py-2 pr-4">{k.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{k.keyPrefix}…</td>
                  <td className="py-2 pr-4 font-mono text-xs">{k.scopes.join(", ")}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {k.ipAllowlist.length ? k.ipAllowlist.join(", ") : "any"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground" data-testid="apikey-last-used">
                    {k.lastUsedAt ? k.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "never"}
                  </td>
                  <td className="py-2 pr-4">{k.revokedAt ? "revoked" : "active"}</td>
                  <td className="py-2 text-right">
                    {canWrite && !k.revokedAt && <ApiKeyRevokeButton apiKeyId={k.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
