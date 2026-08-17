import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

/**
 * Password hashing (hardening doc §1.2).
 *
 * Prefers argon2id (memory-hard, the modern standard). Legacy bcrypt hashes
 * (cost 10/12, prefix "$2a$"/"$2b$") are still VERIFIED for backward
 * compatibility — the caller should rehash on success (see rehashIfNeeded).
 *
 * argon2id is loaded lazily and only in server/Node contexts; the module is
 * importable from client code without pulling the native binding in.
 */

export const BCRYPT_COST = 12; // hardening doc §1.1 — was the default 10

let argon2Promise: Promise<typeof import("argon2")> | null = null;
function loadArgon2(): Promise<typeof import("argon2")> {
  if (!argon2Promise) argon2Promise = import("argon2");
  return argon2Promise;
}

function isBcryptHash(hash: string): boolean {
  return hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$");
}

function isArgon2Hash(hash: string): boolean {
  return hash.startsWith("$argon2id$");
}

/** Hash a password with argon2id. Callers that need bcrypt output can pass
 *  `algorithm: "bcrypt"` (used by tests that freeze the legacy path). */
export async function hashPassword(password: string, algorithm: "argon2id" | "bcrypt" = "argon2id"): Promise<string> {
  if (algorithm === "bcrypt") return bcrypt.hash(password, BCRYPT_COST);
  const argon2 = await loadArgon2();
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 64 * 1024, // 64 MiB
    timeCost: 3,
    parallelism: 1,
  });
}

/** Verify a password against a stored hash. Supports argon2id AND legacy bcrypt. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (isBcryptHash(hash)) return bcrypt.compare(password, hash);
  if (isArgon2Hash(hash)) {
    const argon2 = await loadArgon2();
    return argon2.verify(hash, password);
  }
  return false; // unknown scheme — never crash, never pass
}

/** True when the stored hash should be upgraded on next successful verify
 *  (legacy bcrypt at cost < 12, or a bcrypt hash while argon2id is preferred). */
export function rehashIfNeeded(hash: string): boolean {
  if (isArgon2Hash(hash)) return false;
  if (isBcryptHash(hash)) return true; // bcrypt is only ever legacy now
  return false;
}

// ---------- Breach check (hardening doc §1.10, HIBP k-anonymity) ----------

const HIBP_ENDPOINT = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 3000;

/** True if the password appears in a known breach, via HIBP k-anonymity
 *  (only the first 5 SHA-1 hex chars ever leave the server). Never throws —
 *  a failure to reach HIBP must not block registration. */
export async function isBreachedPassword(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HIBP_TIMEOUT_MS);
    try {
      const res = await fetch(`${HIBP_ENDPOINT}${prefix}`, {
        headers: { "User-Agent": "vaani-ai" },
        signal: ctrl.signal,
      });
      if (!res.ok) return false;
      const body = await res.text();
      // Response is "<SUFFIX>:<count>" lines; count > 0 means exposed.
      return body.split("\n").some((line) => {
        const [suffix, count] = line.split(":");
        return suffix === sha1.slice(5) && Number(count) > 0;
      });
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false; // offline / timeout → allow (fail-open documented)
  }
}
