import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { hubspotContactPayload, hubspotProvider, zohoLeadPayload } from "../src/lib/integrations/crm";
import type { CrmConnection } from "@prisma/client";

const conn = {
  id: "c1",
  workspaceId: "w1",
  provider: "HUBSPOT",
  instanceUrl: null,
  accessToken: "tok",
  refreshToken: "ref",
  tokenExpiresAt: null,
  fieldMapping: null,
  twoWaySyncEnabled: false,
  lastSyncAt: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as CrmConnection;

const lead = { name: "Ravi Kumar", phone: "+919900000001", note: "test", outcome: "qualified" };

describe("hubspotContactPayload", () => {
  it("applies the default preset and name split", () => {
    const p = hubspotContactPayload(null, lead);
    expect(p.properties.firstname).toBe("Ravi Kumar");
    expect(p.properties.lastname).toBe("Kumar");
    expect(p.properties.phone).toBe("+919900000001");
    expect(p.properties.hs_lead_status).toBe("qualified");
    expect(p.properties.email).toBeUndefined();
  });
});

describe("hubspotProvider.pushLead (mocked fetch)", () => {
  const calls: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "hs-123" }), { status: 201 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("searches by phone then POSTs a contact with Bearer auth", async () => {
    const r = await hubspotProvider.pushLead(conn, lead);
    expect(r).toEqual({ externalId: "hs-123", created: true });
    expect(calls[0].url).toContain("/crm/v3/objects/contacts/search");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(calls[1].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.properties.phone).toBe("+919900000001");
  });

  it("PATCHes instead when the contact exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/search")) {
        return new Response(JSON.stringify({ results: [{ id: "hs-9" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "hs-9" }), { status: 200 });
    }));
    const r = await hubspotProvider.pushLead(conn, lead);
    expect(r).toEqual({ externalId: "hs-9", created: false });
    expect(calls[1].init.method).toBe("PATCH");
    expect(calls[1].url).toContain("/crm/v3/objects/contacts/hs-9");
  });
});

describe("zohoLeadPayload", () => {
  it("produces the Zoho data[] shape with split names", () => {
    const p = zohoLeadPayload(null, lead);
    expect(p.data.length).toBe(1);
    expect(p.data[0].Last_Name).toBe("Kumar");
    expect(p.data[0].First_Name).toBe("Ravi");
    expect(p.data[0].Phone).toBe("+919900000001");
  });
});
