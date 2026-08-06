import { cookies, headers } from "next/headers";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { hasPermission, type PermissionKey } from "./permissions";
import type { Role, User, Membership } from "@prisma/client";

const COOKIE_NAME = "vaani_session";
const SESSION_DAYS = 7;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET missing or too short (need 32+ chars)");
  }
  return new TextEncoder().encode(secret);
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
      expiresAt,
    },
  });

  const jwt = await new SignJWT({ sessionId: session.id, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .sign(secretKey());

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
    const { payload } = await jwtVerify(jwt, secretKey());
    return { sessionId: payload.sessionId as string, userId: payload.userId as string };
  } catch {
    return null;
  }
}

async function loadValidSession(sessionId: string) {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.revokedAt) return null; // forced logout (spec 3.3)
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
 */
export async function requirePermission(key: PermissionKey): Promise<WorkspaceContext> {
  const ctx = await requireWorkspace();
  if (!hasPermission(ctx.membership, key)) {
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
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${PENDING_TOTP_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Returns the userId if the pending token is valid, else null. */
export async function verifyPendingTotpToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.purpose !== "totp-pending") return null;
    return (payload.userId as string) ?? null;
  } catch {
    return null;
  }
}
