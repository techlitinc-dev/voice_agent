import type { CrmConnection, CrmProvider as CrmProviderEnum } from "@prisma/client";
import type { CrmProvider, CrmTokens, CrmLead, CrmPushResult, CrmUpdate } from "./types";

/**
 * OPERATOR GATE — SALESFORCE / LEADSQUARED / FRESHSALES / PIPEDRIVE.
 * These adapters follow the exact CrmProvider interface (see hubspot.ts/zoho.ts).
 * The DB rows, OAuth routes, settings UI and field-mapping editor already work for
 * them; only the provider-specific HTTP calls need real app credentials + endpoint
 * verification. To enable a provider:
 *   1. Operator creates an OAuth app with the CRM vendor; add CLIENT_ID/SECRET to .env.
 *   2. Implement the four methods below in a new file (copy zoho.ts as the template).
 *   3. Register it in src/lib/integrations/crm/index.ts and delete the stub here.
 * Until then every method fails loudly and explains this.
 */
function gate(provider: CrmProviderEnum): never {
  throw new Error(
    `${provider} adapter is not enabled in v1. OPERATOR GATE (guide 05 Step 13, stubs.ts): the CrmProvider interface, OAuth routes, UI and sync worker are ready — implement the provider's HTTP calls with real vendor app credentials.`,
  );
}

class StubProvider implements CrmProvider {
  constructor(public readonly provider: CrmProviderEnum) {}
  getAuthUrl(): string { return gate(this.provider); }
  exchangeCode(): Promise<CrmTokens> { return gate(this.provider); }
  refreshTokens(_conn: CrmConnection): Promise<CrmTokens> { return gate(this.provider); }
  pushLead(_conn: CrmConnection, _lead: CrmLead): Promise<CrmPushResult> { return gate(this.provider); }
  pullUpdates(_conn: CrmConnection, _since: Date): Promise<CrmUpdate[]> { return gate(this.provider); }
  listFields(_conn: CrmConnection): Promise<string[]> { return gate(this.provider); }
}

export const salesforceProvider = new StubProvider("SALESFORCE");
export const leadsquaredProvider = new StubProvider("LEADSQUARED");
export const freshsalesProvider = new StubProvider("FRESHSALES");
export const pipedriveProvider = new StubProvider("PIPEDRIVE");
