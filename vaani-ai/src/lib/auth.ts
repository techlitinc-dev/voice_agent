import { cookies, headers } from "next/headers";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { deviceFingerprint } from "./device";
import { hasPermission, type PermissionKey } from "./permissions";
import type { Role, User, Membership } from "@prisma/client";

const COOKIE_NAME = "vaani_session";
const SESSION_DAYS = 7;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

// ---------- JWT signing keys (hardening doc §1.3) ----------
// Versioned scheme: the ACTIVE key signs; older versions still verify so
// sessions issued before a rotation keep working. Env:
//   JWT_SIGNING_KEY_V1 / JWT_SIGNING_KEY_V2 (or more), JWT_ACTIVE_KEY_VERSION.
// Falls back to SESSION_SECRET (legacy) when no versioned keys are configured.

const KEY_VERSION_RE = /^JWT_SIGNING_KEY_(V\d+)$/;

function keyMaterial(version: string): Uint8Array {
  const secret = process.env[`JWT_SIGNING_KEY_${version}`];
  if (!secret || secret.length < 32) {
    throw new Error(`JWT_SIGNING_KEY_${version} missing or too short (need 32+ chars)`);
  }
  return new TextEncoder().encode(secret);
}

function activeKeyVersion(): string {
  const active = process.env.JWT_ACTIVE_KEY_VERSION;
  if (active && process.env[`JWT_SIGNING_KEY_${active}`]) return active;
  // Default: the highest Vn present (so a fresh deploy with only V1 works).
  const versions = Object.keys(process.env)
    .map((k) => k.match(KEY_VERSION_RE)?.[1])
    .filter((v): v is string => Boolean(v));
  if (versions.length > 0) {
    versions.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    return versions[versions.length - 1];
  }
  return "LEGACY";
}

function signSecret() {
  const v = activeKeyVersion();
  if (v === "LEGACY") return secretKeyLegacy();
  return keyMaterial(v);
}

function secretKeyLegacy(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET missing or too short (need 32+ chars)");
  }
  return new TextEncoder().encode(secret);
}

/** All key versions that may still verify tokens (active + every older one). */
function verifyKeys(): Map<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  for (const k of Object.keys(process.env)) {
    const m = k.match(KEY_VERSION_RE);
    if (m) keys.set(m[1], keyMaterial(m[1]));
  }
  if (keys.size === 0) keys.set("LEGACY", secretKeyLegacy());
  return keys;
}

export type SessionPayload = { sessionId: string; userId: string };

function parseDeviceName(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const os =
    userAgent.includes("Windows") ? "Windows" :
    userAgent.includes("Mac OS") ? "macOS" :
    userAgent.includes("Android") ? "Android" :
    userAgent.includes("iPhone") || userAgent.includes("iPad") ? "iOS" :
    userAgent.includes("Linux") ? "Linux" : "Unknown OS";
  const browser =
    userAgent.includes("Edg/") ? "Edge" :
    userAgent.includes("Chrome/") ? "Chrome" :
    userAgent.includes("Firefox/") ? "Firefox" :
    userAgent.includes("Safari/") ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

function requestIp(): string | null {
  const h = headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip");
}

/** True when the request arrived over HTTPS (Caddy sets x-forwarded-proto). */
function isSecureRequest(): boolean {
  const proto = headers().get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https";
}

// ---------- Device binding (hardening doc §1.5) ----------
// See src/lib/device.ts — the session is bound to a fingerprint of User-Agent +
// first 3 octets of the IP. A token presented from a different device/IP prefix
// is rejected (session hijack protection). Stored as a SHA-256 hash.

function currentDeviceFingerprint(): string | null {
  return deviceFingerprint(headers().get("user-agent"), requestIp());
}

/** Create a DB session + signed cookie. Captures device/IP for the sessions page. */
export async function createSession(userId: string, activeWorkspaceId?: string) {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = headers().get("user-agent");
  const session = await db.session.create({
    data: {
      token: crypto.randomUUID(),
      userId,
      activeWorkspaceId: activeWorkspaceId ?? null,
      deviceName: parseDeviceName(userAgent),
      userAgent: userAgent ?? null,
      ipAddress: requestIp(),
      deviceFingerprint: currentDeviceFingerprint(),
      expiresAt,
    },
  });

  const jwt = await new SignJWT({ sessionId: session.id, userId })
    .setProtectedHeader({ alg: "HS256", kid: activeKeyVersion() })
    .setExpirationTime(expiresAt)
    .sign(signSecret());

  // cookie value = "<dbToken>.<jwt>"
  const value = `${session.token}.${jwt}`;
  cookies().set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(),
    path: "/",
    expires: expiresAt,
  });
  return session;
}

export async function destroySession() {
  const payload = await readCookiePayload();
  if (payload) {
    await db.session.deleteMany({ where: { id: payload.sessionId } });
  }
  cookies().delete(COOKIE_NAME);
}

async function readCookiePayload(): Promise<SessionPayload | null> {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [token, ...jwtParts] = raw.split(".");
  const jwt = jwtParts.join(".");
  if (!token || !jwt) return null;
  try {
    // Verify against EVERY configured key version (the kid in the header tells
    // us which one signed it; keys that are no longer active still verify).
    let lastError: unknown;
    for (const [, key] of verifyKeys()) {
      try {
        const { payload } = await jwtVerify(jwt, key);
        return { sessionId: payload.sessionId as string, userId: payload.userId as string };
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) return null;
    return null;
  } catch {
    return null;
  }
}

async function loadValidSession(sessionId: string) {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.revokedAt) return null; // forced logout (spec 3.3)
  // Device binding check: fingerprint mismatch → treat as no session.
  if (session.deviceFingerprint) {
    const fp = currentDeviceFingerprint();
    if (!fp || fp !== session.deviceFingerprint) return null;
  }
  // Throttled last-seen tracking (device history)
  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), ipAddress: requestIp() },
    });
  }
  return session;
}

/** Current user from cookie + DB session. Cached per request. Returns null if logged out. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const payload = await readCookiePayload();
  if (!payload) return null;
  const session = await loadValidSession(payload.sessionId);
  if (!session) return null;
  return db.user.findUnique({ where: { id: session.userId } });
});

export const getCurrentSession = cache(async () => {
  const payload = await readCookiePayload();
  if (!payload) return null;
  return loadValidSession(payload.sessionId);
});

/** Throwing variants for server actions / protected pages. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export type WorkspaceContext = {
  user: User;
  workspaceId: string;
  membership: Membership;
};

/** The multi-tenancy gate. EVERY tenant-scoped query uses the workspaceId from here. */
export const requireWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const session = await getCurrentSession();
  if (!session?.activeWorkspaceId) throw new Error("NO_WORKSPACE");
  const membership = await db.membership.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: session.activeWorkspaceId },
    },
  });
  if (!membership) throw new Error("NO_WORKSPACE");
  return { user, workspaceId: session.activeWorkspaceId, membership };
});

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  AGENT: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

/** Throws unless the current membership role is >= minRole. */
export async function requireRole(minRole: Role): Promise<WorkspaceContext> {
  const ctx = await requireWorkspace();
  if (ROLE_RANK[ctx.membership.role] < ROLE_RANK[minRole]) {
    throw new Error("FORBIDDEN");
  }
  return ctx;
}

/**
 * The permission gate (spec 3.2). EVERY server action guarding a tenant feature
 * calls this FIRST: auth → permission → zod → tenant → prisma → revalidatePath.
 * Throws Error("FORBIDDEN") unless the membership's effective permissions
 * (role defaults + grant/revoke overrides) include `key`.
 *
 * Denials are written to the AuditLog with action "authz.deny" (hardening §2.5).
 */
export async function requirePermission(key: PermissionKey): Promise<WorkspaceContext> {
  const ctx = await requireWorkspace();
  if (!hasPermission(ctx.membership, key)) {
    try {
      await db.auditLog.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.user.id,
          action: "authz.deny",
          entity: "Permission",
          metadata: { key },
        },
      });
    } catch {
      // audit must never break the request
    }
    throw new Error("FORBIDDEN");
  }
  return ctx;
}

/** Switch the active workspace stored on the session. */
export async function setActiveWorkspace(workspaceId: string) {
  const session = await getCurrentSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  await db.session.update({
    where: { id: session.id },
    data: { activeWorkspaceId: workspaceId },
  });
}

/** Forced logout helpers (spec 3.3). */
export async function revokeSessionById(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

// ---------- Pending-2FA tokens (TOTP login second step) ----------

const PENDING_TOTP_TTL_SECONDS = 5 * 60;

/** Signed, 5-minute token proving the password step succeeded but 2FA is pending. */
export async function createPendingTotpToken(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: "totp-pending" })
    .setProtectedHeader({ alg: "HS256", kid: activeKeyVersion() })
    .setExpirationTime(`${PENDING_TOTP_TTL_SECONDS}s`)
    .sign(signSecret());
}

/** Returns the userId if the pending token is valid, else null. */
export async function verifyPendingTotpToken(token: string): Promise<string | null> {
  try {
    for (const [, key] of verifyKeys()) {
      try {
        const { payload } = await jwtVerify(token, key);
        if (payload.purpose !== "totp-pending") return null;
        return (payload.userId as string) ?? null;
      } catch {
        // try next key version
      }
    }
    return null;
  } catch {
    return null;
  }
}
