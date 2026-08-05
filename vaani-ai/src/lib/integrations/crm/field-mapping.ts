/**
 * Field-mapping applier. CrmConnection.fieldMapping maps OUR canonical keys to
 * CRM-native property names, e.g.:
 *   {"contact.name":"firstname","contact.phone":"phone","call.outcome":"hs_lead_status"}
 * Pure function — unit-tested in tests/crm-mapping.test.ts.
 */
import type { CrmLead } from "./types";

export type FieldMapping = Record<string, string>;

export const CANONICAL_KEYS = [
  "contact.name",
  "contact.phone",
  "contact.email",
  "contact.note",
  "call.outcome",
] as const;

/** Sensible per-provider presets shown in the mapping editor. */
export const FIELD_MAPPING_PRESETS: Record<string, FieldMapping> = {
  HUBSPOT: {
    "contact.name": "firstname",
    "contact.phone": "phone",
    "contact.email": "email",
    "contact.note": "hs_lead_notes",
    "call.outcome": "hs_lead_status",
  },
  ZOHO: {
    // name intentionally unmapped: the payload builder splits into First_Name/Last_Name
    "contact.phone": "Phone",
    "contact.email": "Email",
    "contact.note": "Description",
  },
  SALESFORCE: { "contact.name": "LastName", "contact.phone": "Phone", "contact.email": "Email" },
  LEADSQUARED: { "contact.name": "FirstName", "contact.phone": "Phone", "contact.email": "EmailAddress" },
  FRESHSALES: { "contact.name": "first_name", "contact.phone": "work_number", "contact.email": "email" },
  PIPEDRIVE: { "contact.name": "name", "contact.phone": "phone", "contact.email": "email" },
};

/** Split "Ravi Kumar" → { first: "Ravi", last: "Kumar" } (CRMs want split names). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") || parts[0] || "Unknown" };
}

/**
 * Apply a mapping to a lead → flat { crmProperty: value } payload.
 * Unknown canonical keys in the mapping are ignored; missing values are omitted.
 */
export function applyFieldMapping(
  mapping: FieldMapping | null | undefined,
  lead: CrmLead,
): Record<string, string> {
  const canonical: Record<string, string | undefined> = {
    "contact.name": lead.name,
    "contact.phone": lead.phone,
    "contact.email": lead.email,
    "contact.note": lead.note,
    "call.outcome": lead.outcome,
  };
  const out: Record<string, string> = {};
  for (const [ourKey, crmKey] of Object.entries(mapping ?? {})) {
    const value = canonical[ourKey];
    if (value !== undefined && value !== "" && crmKey) out[crmKey] = value;
  }
  return out;
}

/** Validate a mapping from the JSON editor: keys must be canonical, values strings. */
export function validateFieldMapping(input: unknown): { ok: true; mapping: FieldMapping } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Mapping must be a JSON object like {\"contact.phone\":\"phone\"}." };
  }
  const out: FieldMapping = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(CANONICAL_KEYS as readonly string[]).includes(k)) {
      return { ok: false, error: `Unknown key "${k}". Allowed: ${CANONICAL_KEYS.join(", ")}` };
    }
    if (typeof v !== "string" || v.length === 0 || v.length > 120) {
      return { ok: false, error: `Value for "${k}" must be a CRM property name (string).` };
    }
    out[k] = v;
  }
  return { ok: true, mapping: out };
}
