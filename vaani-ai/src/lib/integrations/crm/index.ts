import type { CrmProvider as CrmProviderEnum } from "@prisma/client";
import type { CrmProvider } from "./types";
import { hubspotProvider } from "./hubspot";
import { zohoProvider } from "./zoho";
import { salesforceProvider, leadsquaredProvider, freshsalesProvider, pipedriveProvider } from "./stubs";

const REGISTRY: Record<CrmProviderEnum, CrmProvider> = {
  HUBSPOT: hubspotProvider,
  ZOHO: zohoProvider,
  SALESFORCE: salesforceProvider,
  LEADSQUARED: leadsquaredProvider,
  FRESHSALES: freshsalesProvider,
  PIPEDRIVE: pipedriveProvider,
};

export function getCrmProvider(provider: CrmProviderEnum): CrmProvider {
  return REGISTRY[provider];
}

export const CRM_PROVIDERS: { provider: CrmProviderEnum; label: string; implemented: boolean }[] = [
  { provider: "HUBSPOT", label: "HubSpot", implemented: true },
  { provider: "ZOHO", label: "Zoho CRM", implemented: true },
  { provider: "SALESFORCE", label: "Salesforce", implemented: false },
  { provider: "LEADSQUARED", label: "LeadSquared", implemented: false },
  { provider: "FRESHSALES", label: "Freshsales", implemented: false },
  { provider: "PIPEDRIVE", label: "Pipedrive", implemented: false },
];

export type { CrmProvider, CrmLead, CrmPushResult, CrmUpdate, CrmTokens } from "./types";
export { applyFieldMapping, validateFieldMapping, FIELD_MAPPING_PRESETS, splitName } from "./field-mapping";
export { hubspotProvider, hubspotContactPayload } from "./hubspot";
export { zohoProvider, zohoLeadPayload } from "./zoho";
