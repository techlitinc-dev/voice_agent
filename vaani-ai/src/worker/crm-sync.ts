/**
 * CRM two-way sync worker. Run: npm run worker:crm-sync
 * Every 15 minutes: for each CrmConnection with twoWaySyncEnabled, pull updates
 * since lastSyncAt and upsert matching Contact rows. Tokens are refreshed
 * on-demand and persisted.
 */
import cron from "node-cron";
import { db } from "../lib/db";
import { getCrmProvider } from "../lib/integrations/crm";

const TICK = "*/15 * * * *";

export async function syncAll(): Promise<number> {
  const conns = await db.crmConnection.findMany({
    where: { active: true, twoWaySyncEnabled: true },
  });
  let touched = 0;
  for (const conn of conns) {
    try {
      const crm = getCrmProvider(conn.provider);
      // Refresh if expiring within 5 minutes.
      let working = conn;
      if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
        const tokens = await crm.refreshTokens(conn);
        working = await db.crmConnection.update({
          where: { id: conn.id },
          data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt },
        });
      }
      const since = conn.lastSyncAt ?? new Date(Date.now() - 24 * 3600 * 1000);
      const updates = await crm.pullUpdates(working, since);
      for (const u of updates) {
        const contact = await db.contact.findFirst({
          where: {
            workspaceId: conn.workspaceId,
            OR: [{ crmExternalId: u.externalId }, ...(u.phone ? [{ phone: u.phone }] : [])],
          },
        });
        if (contact) {
          await db.contact.update({
            where: { id: contact.id },
            data: {
              crmExternalId: u.externalId,
              ...(u.name && !contact.name ? { name: u.name } : {}),
            },
          });
          touched++;
        }
      }
      await db.crmConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
    } catch (e) {
      console.error(`[crm-sync] ${conn.provider} (${conn.workspaceId}) failed:`, e instanceof Error ? e.message : e);
    }
  }
  return touched;
}

if (require.main === module) {
  console.log(`[crm-sync] starting, schedule "${TICK}"`);
  cron.schedule(TICK, async () => {
    try {
      const n = await syncAll();
      if (n > 0) console.log(`[crm-sync] updated ${n} contact(s)`);
    } catch (e) {
      console.error("[crm-sync] tick failed:", e);
    }
  });
}
