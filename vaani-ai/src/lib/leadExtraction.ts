import type { Prisma } from "@prisma/client";

/** Flat lead fields extracted from the call. `name`/`email` are Contact columns;
 *  everything else (requirement, city, loan_id, …) lands in Contact.attributes. */
export type ExtractedEntities = Record<string, string | number | boolean>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize raw LLM JSON into safe entities, field by field (one bad field never
 *  nukes the rest). Non-object input → {}. Never throws. */
export function normalizeExtractedEntities(raw: unknown): ExtractedEntities {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: ExtractedEntities = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length === 0 || t.length > 200) continue;
      if (k === "email" && !EMAIL_RE.test(t)) continue;
      out[k] = t;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    // nested objects/arrays are dropped — flat entities only
  }
  return out;
}

/** Merge new entities into a Contact's existing attributes JSON (new keys win). */
export function mergeAttributes(existing: unknown, entities: ExtractedEntities): Prisma.InputJsonObject {
  const base: Prisma.InputJsonObject =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? (existing as Prisma.InputJsonObject)
      : {};
  const { name: _name, email: _email, ...rest } = entities; // name/email are Contact columns, not attributes
  return { ...base, ...rest };
}

/** Build the prisma upsert args for the lead-capture Contact write. */
export function buildContactUpsert(workspaceId: string, phone: string, entities: ExtractedEntities, existingAttributes: unknown) {
  const name = typeof entities.name === "string" ? entities.name : null;
  return {
    where: { workspaceId_phone: { workspaceId, phone } },
    create: {
      workspaceId,
      phone,
      name,
      attributes: mergeAttributes(null, entities),
    },
    update: {
      ...(name ? { name } : {}),
      attributes: mergeAttributes(existingAttributes, entities),
    },
  };
}
