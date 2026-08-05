import { createHash } from "crypto";

/**
 * A/B resolver — called at CALL START by guide 06 (inbound) and guide 07 (outbound)
 * to pick which published AgentVersion (and therefore which Dograh workflow) serves
 * this call. Deterministic: the same caller always lands in the same bucket.
 */

export type AbCandidate = {
  id: string; // AgentVersion id
  isAbVariant: boolean;
  abTrafficPercent: number | null;
  dograhWorkflowId: string | null;
  dograhWorkflowUuid: string | null;
};

/** Deterministic bucket 0..99 for (agentId, phone). */
export function abBucket(agentId: string, callerPhone: string): number {
  const digest = createHash("sha256").update(`${agentId}:${callerPhone}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Pick the serving version. `published` = all PUBLISHED versions of the agent
 * (the main one has isAbVariant=false; at most one A/B variant exists).
 * Falls back to the main published version when no A/B variant or no phone given.
 */
export function resolveServingVersion(
  published: AbCandidate[],
  agentId: string,
  callerPhone?: string,
): AbCandidate | null {
  const main = published.find((v) => !v.isAbVariant) ?? null;
  const variant = published.find((v) => v.isAbVariant) ?? null;
  if (!variant || !callerPhone) return main;
  const pct = variant.abTrafficPercent ?? 0;
  if (pct <= 0) return main;
  return abBucket(agentId, callerPhone) < pct ? variant : main;
}

/**
 * Full resolution for call-start: which Dograh workflow should handle this call.
 * Returns null when nothing usable is published (caller must NOT dial then).
 */
export function resolveAgentForCall(input: {
  agentId: string;
  callerPhone?: string;
  publishedVersions: AbCandidate[];
}): { versionId: string; dograhWorkflowId: string; dograhWorkflowUuid: string | null } | null {
  const v = resolveServingVersion(input.publishedVersions, input.agentId, input.callerPhone);
  if (!v || !v.dograhWorkflowId) return null;
  return { versionId: v.id, dograhWorkflowId: v.dograhWorkflowId, dograhWorkflowUuid: v.dograhWorkflowUuid };
}
