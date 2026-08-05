import crypto from "node:crypto";
import { db } from "./db";
import { isPermissionKey, type PermissionKey } from "./permissions";
import type { ApiKey } from "@prisma/client";

/** Full secret: shown to the user exactly once. Format: vaani_live_<48 hex chars>. */
export function generateApiKeySecret(): string {
  return `vaani_live_${crypto.randomBytes(24).toString("hex")}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** First 15 chars ("vaani_live_" + 4) — safe to display in UI. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, 15);
}

// ---------- IPv4 CIDR allowlist ----------

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

/** True iff `cidr` is a syntactically valid IPv4 CIDR ("1.2.3.4/24") or plain IP. */
export function isValidCidr(cidr: string): boolean {
  const [ip, prefix] = cidr.trim().split("/");
  if (ipToInt(ip ?? "") === null) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,2}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= 32;
}

/** True iff `ip` falls inside `cidr` (IPv4 only). A bare IP means /32. */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!isValidCidr(cidr)) return false;
  const [base, prefix] = cidr.trim().split("/");
  const bits = prefix === undefined ? 32 : Number(prefix);
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base ?? "");
  if (ipInt === null || baseInt === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Empty allowlist = any IP allowed. Otherwise at least one CIDR must match. */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.some((cidr) => ipMatchesCidr(ip, cidr));
}

// ---------- Request guard for /api/v1 route handlers ----------

export class ApiAuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export type ApiKeyContext = { apiKey: ApiKey; workspaceId: string };

function requestIpFromHeaders(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}

/**
 * Guard for public REST routes (guide 08 builds them). Usage inside a route handler:
 *
 *   const ctx = await requireApiKey(req, "calls:read");  // throws ApiAuthError
 *
 * - 401: missing/malformed/unknown/revoked/expired key
 * - 403: key lacks `scope`, or caller IP not in the key's allowlist
 * Updates `lastUsedAt` on success.
 */
export async function requireApiKey(req: Request, scope: PermissionKey): Promise<ApiKeyContext> {
  if (!isPermissionKey(scope)) throw new ApiAuthError(403, "unknown_scope");
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!match) throw new ApiAuthError(401, "missing_api_key");
  const presented = match[1].trim();

  const apiKey = await db.apiKey.findUnique({ where: { keyHash: hashApiKey(presented) } });
  if (!apiKey) throw new ApiAuthError(401, "invalid_api_key");
  if (apiKey.revokedAt) throw new ApiAuthError(401, "key_revoked");
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) throw new ApiAuthError(401, "key_expired");

  if (!apiKey.scopes.includes(scope)) throw new ApiAuthError(403, "insufficient_scope");

  const ip = requestIpFromHeaders(req);
  if (!ipAllowed(ip, apiKey.ipAllowlist)) throw new ApiAuthError(403, "ip_not_allowed");

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
  return { apiKey, workspaceId: apiKey.workspaceId };
}
