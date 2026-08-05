import { db } from "./db";
import type { ExtractedEntities } from "./leadExtraction";

/**
 * Push a captured lead to the workspace's connected CRM (spec §5 "Lead capture →
 * CRM", spec §9 CRM list). Dry-run by default (CRM_PUSH_DRY_RUN=true).
 * OPERATOR GATE: the real per-provider API mapping (HubSpot/Zoho/... field names)
 * is delivered with guide 05's CRM integration UI; this wrapper is the single call
 * site so only the provider-adapter internals change later.
 */
export async function pushLeadToCrm(input: {
  workspaceId: string;
  phone: string;
  entities: ExtractedEntities;
  callId: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  try {
    const conn = await db.crmConnection.findFirst({
      where: { workspaceId: input.workspaceId, active: true },
    });
    if (!conn) return { ok: true, skipped: true };
    if (process.env.CRM_PUSH_DRY_RUN !== "false") {
      console.log(
        `[crm] DRY RUN push to ${conn.provider} for ${input.phone}`,
        JSON.stringify(input.entities).slice(0, 200)
      );
      return { ok: true, skipped: true };
    }
    // Real push: provider adapter plugs in here (guide 05). Until then, fail safe.
    console.error(`[crm] real push requested but no provider adapter for ${conn.provider} yet`);
    return { ok: false, error: `CRM provider adapter for ${conn.provider} not installed (see guide 05)` };
  } catch (e) {
    console.error("pushLeadToCrm failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}
