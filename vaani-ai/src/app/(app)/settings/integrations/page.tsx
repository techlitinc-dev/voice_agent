import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CRM_PROVIDERS, FIELD_MAPPING_PRESETS } from "@/lib/integrations/crm";
import { IntegrationsManager } from "./integrations-manager";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const [crmConns, calConns] = await Promise.all([
    db.crmConnection.findMany({ where: { workspaceId: ctx.workspaceId } }),
    db.calendarConnection.findMany({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          CRM (two-way lead sync) and calendar (appointment booking) connections for
          this workspace.
        </p>
      </div>
      {searchParams.connected && (
        <p className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-400">
          Connected: {searchParams.connected}
        </p>
      )}
      {searchParams.error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{searchParams.error}</p>
      )}
      <IntegrationsManager
        crmProviders={CRM_PROVIDERS}
        crmConnections={crmConns.map((c) => ({
          provider: c.provider,
          active: c.active,
          twoWaySyncEnabled: c.twoWaySyncEnabled,
          lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
          fieldMapping: (c.fieldMapping as Record<string, string> | null) ?? FIELD_MAPPING_PRESETS[c.provider] ?? {},
        }))}
        calendarConnections={calConns.map((c) => ({
          provider: c.provider,
          active: c.active,
          accountEmail: c.accountEmail,
          primaryCalendarId: c.primaryCalendarId,
        }))}
      />
    </div>
  );
}
