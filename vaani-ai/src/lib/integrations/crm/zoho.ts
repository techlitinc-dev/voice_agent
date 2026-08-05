import type { CrmConnection } from "@prisma/client";
import type { CrmLead, CrmProvider, CrmPushResult, CrmTokens, CrmUpdate } from "./types";
import { applyFieldMapping, splitName, FIELD_MAPPING_PRESETS } from "./field-mapping";

const ACCOUNTS = "https://accounts.zoho.com";
const API = () => "https://www.zohoapis.com"; // region note: .eu/.in tenants set instanceUrl
const CLIENT_ID = () => process.env.ZOHO_CLIENT_ID ?? "";
const CLIENT_SECRET = () => process.env.ZOHO_CLIENT_SECRET ?? "";
const REDIRECT = () =>
  `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/crm/zoho/callback`;

function apiBase(conn: CrmConnection): string {
  return (conn.instanceUrl ?? API()).replace(/\/$/, "");
}

async function zh<T>(conn: CrmConnection, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase(conn)}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Zoho-oauthtoken ${conn.accessToken}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoho ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Exact Zoho Leads payload (unit-tested). */
export function zohoLeadPayload(mapping: Record<string, string> | null, lead: CrmLead): {
  data: Record<string, string>[];
} {
  const props = applyFieldMapping(mapping ?? FIELD_MAPPING_PRESETS.ZOHO, lead);
  const { first, last } = splitName(lead.name);
  if (!props.Last_Name) props.Last_Name = last;
  if (!props.First_Name && first) props.First_Name = first;
  if (!props.Phone) props.Phone = lead.phone;
  return { data: [props] };
}

async function zohoTokenRequest(params: Record<string, string>): Promise<CrmTokens> {
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${new URLSearchParams(params)}`, { method: "POST" });
  if (!res.ok) throw new Error(`Zoho token request failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; api_domain?: string; error?: string };
  if (!data.access_token) throw new Error(`Zoho OAuth error: ${data.error ?? "no access_token"}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    instanceUrl: data.api_domain ?? null,
  };
}

export const zohoProvider: CrmProvider = {
  provider: "ZOHO",

  getAuthUrl(state: string): string {
    const scope = encodeURIComponent("ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.UPDATE");
    return `${ACCOUNTS}/oauth/v2/auth?scope=${scope}&client_id=${encodeURIComponent(CLIENT_ID())}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT())}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  },

  exchangeCode(code: string): Promise<CrmTokens> {
    return zohoTokenRequest({
      grant_type: "authorization_code",
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      redirect_uri: REDIRECT(),
      code,
    });
  },

  refreshTokens(conn: CrmConnection): Promise<CrmTokens> {
    if (!conn.refreshToken) throw new Error("Zoho connection has no refresh token — reconnect.");
    return zohoTokenRequest({
      grant_type: "refresh_token",
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      refresh_token: conn.refreshToken,
    });
  },

  async pushLead(conn: CrmConnection, lead: CrmLead): Promise<CrmPushResult> {
    const payload = zohoLeadPayload((conn.fieldMapping ?? null) as Record<string, string> | null, lead);
    const res = await zh<{ data?: { details?: { id?: string }; status?: string; code?: string }[] }>(
      conn,
      "/crm/v2/Leads/upsert",
      { method: "POST", body: JSON.stringify(payload) },
    );
    const row = res.data?.[0];
    const id = row?.details?.id;
    if (!id) throw new Error(`Zoho upsert rejected: ${row?.code ?? "unknown"}`);
    return { externalId: id, created: row?.code === "SUCCESS" };
  },

  async pullUpdates(conn: CrmConnection, since: Date): Promise<CrmUpdate[]> {
    const iso = since.toISOString().replace(/\.\d{3}Z$/, "+05:30");
    const res = await zh<{ data?: { id: string; First_Name?: string; Last_Name?: string; Phone?: string; Email?: string }[] }>(
      conn,
      `/crm/v2/Leads?fields=First_Name,Last_Name,Phone,Email&per_page=100`,
      { method: "GET", headers: { "If-Modified-Since": iso } },
    ).catch(() => ({ data: [] }));
    return (res.data ?? []).map((r) => ({
      externalId: r.id,
      name: [r.First_Name, r.Last_Name].filter(Boolean).join(" ") || undefined,
      phone: r.Phone,
      email: r.Email,
      raw: r,
    }));
  },

  async listFields(_conn: CrmConnection): Promise<string[]> {
    return ["First_Name", "Last_Name", "Phone", "Email", "Company", "Description", "Lead_Status", "Lead_Source"];
  },
};
