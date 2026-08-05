import type { CrmConnection } from "@prisma/client";
import type { CrmLead, CrmProvider, CrmPushResult, CrmTokens, CrmUpdate } from "./types";
import { applyFieldMapping, splitName, FIELD_MAPPING_PRESETS } from "./field-mapping";

const API = "https://api.hubapi.com";
const CLIENT_ID = () => process.env.HUBSPOT_CLIENT_ID ?? "";
const CLIENT_SECRET = () => process.env.HUBSPOT_CLIENT_SECRET ?? "";
const REDIRECT = () =>
  `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/crm/hubspot/callback`;

async function hs<T>(path: string, init: RequestInit, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Exact payload shape HubSpot expects (unit-tested with a mocked fetch). */
export function hubspotContactPayload(mapping: Record<string, string> | null, lead: CrmLead): {
  properties: Record<string, string>;
} {
  const props = applyFieldMapping(mapping ?? FIELD_MAPPING_PRESETS.HUBSPOT, lead);
  const { first, last } = splitName(lead.name);
  if (!props.firstname) props.firstname = first;
  if (!props.lastname && last) props.lastname = last;
  if (!props.phone) props.phone = lead.phone;
  return { properties: props };
}

export const hubspotProvider: CrmProvider = {
  provider: "HUBSPOT",

  getAuthUrl(state: string): string {
    const scope = encodeURIComponent("crm.objects.contacts.read crm.objects.contacts.write");
    return `https://app.hubspot.com/oauth/authorize?client_id=${encodeURIComponent(CLIENT_ID())}&redirect_uri=${encodeURIComponent(REDIRECT())}&scope=${scope}&state=${encodeURIComponent(state)}`;
  },

  async exchangeCode(code: string): Promise<CrmTokens> {
    const res = await fetch(`${API}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        redirect_uri: REDIRECT(),
        code,
      }),
    });
    if (!res.ok) throw new Error(`HubSpot OAuth failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  },

  async refreshTokens(conn: CrmConnection): Promise<CrmTokens> {
    if (!conn.refreshToken) throw new Error("HubSpot connection has no refresh token — reconnect.");
    const res = await fetch(`${API}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        refresh_token: conn.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`HubSpot refresh failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? conn.refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  },

  async pushLead(conn: CrmConnection, lead: CrmLead): Promise<CrmPushResult> {
    const mapping = (conn.fieldMapping ?? null) as Record<string, string> | null;
    const payload = hubspotContactPayload(mapping, lead);
    // Upsert by phone: search first, PATCH if found, POST otherwise.
    const found = await hs<{ results?: { id: string }[] }>(
      "/crm/v3/objects/contacts/search",
      { method: "POST", body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: lead.phone }] }], properties: ["phone"], limit: 1 }) },
      conn.accessToken,
    );
    const existing = found.results?.[0]?.id;
    if (existing) {
      await hs(`/crm/v3/objects/contacts/${existing}`, { method: "PATCH", body: JSON.stringify(payload) }, conn.accessToken);
      return { externalId: existing, created: false };
    }
    const created = await hs<{ id: string }>(
      "/crm/v3/objects/contacts",
      { method: "POST", body: JSON.stringify(payload) },
      conn.accessToken,
    );
    return { externalId: created.id, created: true };
  },

  async pullUpdates(conn: CrmConnection, since: Date): Promise<CrmUpdate[]> {
    const res = await hs<{ results?: { id: string; properties: Record<string, string | null> }[] }>(
      "/crm/v3/objects/contacts/search",
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GTE", value: String(since.getTime()) }] }],
          properties: ["firstname", "lastname", "phone", "email"],
          limit: 100,
        }),
      },
      conn.accessToken,
    );
    return (res.results ?? []).map((r) => ({
      externalId: r.id,
      name: [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") || undefined,
      phone: r.properties.phone ?? undefined,
      email: r.properties.email ?? undefined,
      raw: r.properties,
    }));
  },

  async listFields(_conn: CrmConnection): Promise<string[]> {
    // Static curated list keeps this deterministic (HubSpot's /properties API varies
    // by portal). The editor is a JSON editor anyway — these are suggestions.
    return ["firstname", "lastname", "phone", "email", "hs_lead_status", "hs_lead_notes", "company", "website", "lifecyclestage"];
  },
};
