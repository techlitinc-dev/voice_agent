import type { Role } from "@prisma/client";

/**
 * Canonical permission keys (spec 3.2 — granular feature-level permission matrix).
 * Format: "<domain>:<action>". API key scopes use the same strings.
 */
export const PERMISSIONS = [
  "agents:read",
  "agents:write",
  "agents:delete",
  "knowledge:read",
  "knowledge:write",
  "campaigns:read",
  "campaigns:write",
  "campaigns:delete",
  "campaigns:launch",
  "contacts:read",
  "contacts:write",
  "contacts:delete",
  "contacts:import",
  "deals:read",
  "deals:write",
  "deals:delete",
  "pipelines:write",
  "segments:read",
  "segments:write",
  "segments:delete",
  "calls:read",
  "recordings:read",
  "analytics:read",
  "live:listen",
  "live:whisper",
  "live:barge",
  "numbers:read",
  "numbers:write",
  "billing:read",
  "billing:write",
  "users:read",
  "users:write",
  "apikeys:read",
  "apikeys:write",
  "settings:read",
  "settings:write",
  "audit:read",
  "webhooks:read",
  "webhooks:write",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Default role → permission map (spec 3.2):
 * OWNER  — everything (billing, API keys, all domains)
 * ADMIN  — manage agents, campaigns, users, numbers (no billing:write, no apikeys:write)
 * MANAGER— campaigns, contacts, analytics, call recordings
 * AGENT  — agent/supervisor: live-call monitoring, whisper/barge, take-over
 * VIEWER — dashboards and reports only
 */
export const ROLE_PERMISSIONS: Record<Role, readonly PermissionKey[]> = {
  OWNER: PERMISSIONS,
  ADMIN: [
    "agents:read", "agents:write", "agents:delete",
    "knowledge:read", "knowledge:write",
    "campaigns:read", "campaigns:write", "campaigns:delete", "campaigns:launch",
    "contacts:read", "contacts:write", "contacts:delete", "contacts:import",
    "deals:read", "deals:write", "deals:delete",
    "pipelines:write",
    "segments:read", "segments:write", "segments:delete",
    "calls:read", "recordings:read", "analytics:read",
    "live:listen", "live:whisper", "live:barge",
    "numbers:read", "numbers:write",
    "billing:read",
    "users:read", "users:write",
    "apikeys:read",
    "settings:read", "settings:write",
    "audit:read",
    "webhooks:read", "webhooks:write",
  ],
  MANAGER: [
    "campaigns:read", "campaigns:write", "campaigns:launch",
    "contacts:read", "contacts:write", "contacts:delete", "contacts:import",
    "deals:read", "deals:write", "deals:delete",
    "segments:read", "segments:write",
    "calls:read", "recordings:read", "analytics:read",
    "live:listen",
  ],
  AGENT: [
    "calls:read", "recordings:read", "analytics:read",
    "live:listen", "live:whisper", "live:barge",
    "contacts:read",
    "deals:read", "deals:write",
    "segments:read",
  ],
  VIEWER: ["analytics:read", "deals:read", "segments:read"],
};

export type PermissionSource = {
  role: Role;
  grantedPermissions: string[];
  revokedPermissions: string[];
};

/**
 * Resolve the effective permission set for a membership:
 * role defaults, plus granted overrides, minus revoked overrides.
 * Revoke wins over grant if a key appears in both.
 */
export function resolvePermissions(source: PermissionSource): Set<PermissionKey> {
  const effective = new Set<PermissionKey>(ROLE_PERMISSIONS[source.role]);
  for (const key of source.grantedPermissions) {
    if (isPermissionKey(key)) effective.add(key);
  }
  for (const key of source.revokedPermissions) {
    if (isPermissionKey(key)) effective.delete(key);
  }
  return effective;
}

export function hasPermission(source: PermissionSource, key: PermissionKey): boolean {
  return resolvePermissions(source).has(key);
}
