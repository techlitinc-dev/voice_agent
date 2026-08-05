# 03 — Authentication, Workspaces, Roles & Security

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/03_authentication.md` exactly. Follow every step in order,
> create every file EXACTLY as shown (full contents, no truncation), run every
> **Verify**, compare with **Expected**, and use **If it fails** (max 2 attempts)
> before stopping to report. Do not swap the auth approach, do not add NextAuth, and
> install ONLY the packages pinned in Step 1 (no others). End with the FINAL REPORT.
> ---

---

## Goal

Full identity layer for spec §3.2 + §3.3:

1. Email + password auth with an httpOnly JWT session cookie backed by the `Session`
   table (register creates workspace + OWNER membership + wallet + trial subscription
   in one transaction; login/logout; middleware route protection).
2. **5 roles + granular permission matrix**: canonical permission-key vocabulary,
   role→permission defaults, per-member grant/revoke overrides, `requirePermission()`
   enforcement in server actions, members management UI.
3. **Audit log**: `logAudit()` helper wired into every auth/member/api-key action +
   a filterable viewer page.
4. **Google SSO** (OAuth2, account linking via `SsoIdentity`) and **OIDC enterprise
   SSO** (generic Authorization Code flow, manual fetch, no heavy lib); SAML documented
   as an OPERATOR GATE via a managed provider.
5. **TOTP 2FA**: enroll (QR + confirm), verify at login (second step), disable,
   single-use hashed backup codes.
6. **API keys**: `vaani_live_…` format, sha256 hash storage, scopes = permission keys,
   IP allowlisting (CIDR), `requireApiKey(scope)` helper + demo `/api/v1/ping` route,
   create/revoke UI, last-used tracking.
7. **Session management**: device history page, revoke one session, "log out all
   devices", revocation enforced in `requireUser`.
8. **Workspace invites**: invite by email → invite link shown in UI; accept flow.

**Design (do not change):** the cookie stores a random session token; the token is
also stored in the `Session` table so we can revoke sessions and track the active
workspace. The JWT layer (jose) signs the token value so a forged cookie without the
DB row still fails, and we verify expiry both in JWT and DB. Sessions are revoked by
setting `Session.revokedAt` — `requireUser` rejects revoked sessions.

**Time estimate:** 4 hours. **Prerequisites:** guide 02 green (schema migrated, seed
done, `tests/money.test.ts` passing, dev server boots). The guide 02 schema already
contains `Membership.grantedPermissions/revokedPermissions`, `AuditLog`, `ApiKey`,
`Session.deviceName/ipAddress/userAgent/lastSeenAt/revokedAt`, `TotpSecret`,
`SsoIdentity`, `WorkspaceInvite` — this guide adds ONE additive model (`BackupCode`)
in Step 2. Do not modify any other model.

---

## Step 1: Install new pinned dependencies + environment variables

These exact versions are canonical for the whole project (later guides rely on them):

```bash
cd /root/vaani-ai
npm install otplib@12.0.1 qrcode@1.5.4 googleapis@144.0.0
npm install --save-dev @types/qrcode@1.5.5
```

**Verify:**
```bash
node -e "const p=require('./package.json');console.log(p.dependencies.otplib,p.dependencies.qrcode,p.dependencies.googleapis,p.devDependencies['@types/qrcode'])"
```
**Expected:** `12.0.1 1.5.4 144.0.0 1.5.5`
**If it fails:** re-run the two npm install commands exactly. If npm reports a peer
conflict, run the same commands with `--legacy-peer-deps` appended once; if it still
fails, STOP and report.

Environment variables. Ownership rules (do not violate them):
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are **owned by guide 01** — they already
  exist (blank) in `.env` and `.env.example`. Do NOT append them here. When the
  operator creates the Google OAuth client (Step 24), they edit the existing lines in
  `.env` in place; the authorized redirect URI must be
  `${APP_BASE_URL}/api/auth/google/callback`.
- The vars below are **owned by this guide**. Append each one ONLY if missing
  (grep-guarded, idempotent — safe to re-run):

```bash
cd /root/vaani-ai

# Helper: append KEY=LINE to a file only if KEY is not already defined there.
# An optional COMMENT line is written immediately before the key — but only when the
# key itself is appended, so comments can never duplicate either.
append_env() {
  local file="$1" key="$2" line="$3" comment="${4:-}"
  if ! grep -q "^${key}=" "$file"; then
    [ -n "$comment" ] && echo "$comment" >> "$file"
    echo "$line" >> "$file"
  fi
}

# Real values file (.env) — keys present with dev defaults; operator edits in place later.
append_env /root/vaani-ai/.env APP_BASE_URL                   'APP_BASE_URL="http://localhost:3000"'
append_env /root/vaani-ai/.env NEXT_PUBLIC_GOOGLE_SSO_ENABLED 'NEXT_PUBLIC_GOOGLE_SSO_ENABLED="false"'
append_env /root/vaani-ai/.env NEXT_PUBLIC_OIDC_SSO_ENABLED   'NEXT_PUBLIC_OIDC_SSO_ENABLED="false"'
append_env /root/vaani-ai/.env OIDC_ISSUER_URL                'OIDC_ISSUER_URL=""'
append_env /root/vaani-ai/.env OIDC_CLIENT_ID                 'OIDC_CLIENT_ID=""'
append_env /root/vaani-ai/.env OIDC_CLIENT_SECRET             'OIDC_CLIENT_SECRET=""'
append_env /root/vaani-ai/.env SAML_PROVIDER                  'SAML_PROVIDER=""'
append_env /root/vaani-ai/.env SAML_CLIENT_ID                 'SAML_CLIENT_ID=""'
append_env /root/vaani-ai/.env SAML_CLIENT_SECRET             'SAML_CLIENT_SECRET=""'

# Documentation file (.env.example) — SAME per-key guards (guide 01's template may
# already define some of these keys, e.g. the SAML_* scaffolding, so a block-level
# guard is NOT sufficient). Every var documented with a comment (guide 01 rule).
EX=/root/vaani-ai/.env.example
append_env "$EX" APP_BASE_URL 'APP_BASE_URL="http://localhost:3000"' \
  '# Public base URL of the app; used to build SSO redirect URIs and invite links (guide 03).'
append_env "$EX" NEXT_PUBLIC_GOOGLE_SSO_ENABLED 'NEXT_PUBLIC_GOOGLE_SSO_ENABLED="false"' \
  '# Google SSO button toggle (guide 03) — set "true" after GOOGLE_CLIENT_ID/SECRET (guide 01) are filled. Redirect URI: ${APP_BASE_URL}/api/auth/google/callback'
append_env "$EX" NEXT_PUBLIC_OIDC_SSO_ENABLED 'NEXT_PUBLIC_OIDC_SSO_ENABLED="false"' \
  '# OIDC enterprise SSO toggle (guide 03; Keycloak, Okta, Entra ID, Auth0) — set "true" after the OIDC_* vars below are filled. Redirect URI: ${APP_BASE_URL}/api/auth/oidc/callback'
append_env "$EX" OIDC_ISSUER_URL    'OIDC_ISSUER_URL=""'
append_env "$EX" OIDC_CLIENT_ID     'OIDC_CLIENT_ID=""'
append_env "$EX" OIDC_CLIENT_SECRET 'OIDC_CLIENT_SECRET=""'
append_env "$EX" SAML_PROVIDER      'SAML_PROVIDER=""' \
  '# SAML enterprise SSO — OPERATOR GATE via a managed provider (WorkOS/Auth0) bridging SAML to OIDC; see guide 03 Step 25. Scaffolding only.'
append_env "$EX" SAML_CLIENT_ID     'SAML_CLIENT_ID=""'
append_env "$EX" SAML_CLIENT_SECRET 'SAML_CLIENT_SECRET=""'
```

Every line above is per-key grep-guarded: re-running the block, or running it after
guide 01 has already written any of these keys, always lands each key EXACTLY ONCE.

**Verify (each key exists EXACTLY ONCE per file — this also catches duplicates):**
```bash
for key in APP_BASE_URL NEXT_PUBLIC_GOOGLE_SSO_ENABLED NEXT_PUBLIC_OIDC_SSO_ENABLED OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET SAML_PROVIDER SAML_CLIENT_ID SAML_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  printf "%s .env=%s .env.example=%s\n" "$key" \
    "$(grep -c "^${key}=" /root/vaani-ai/.env)" \
    "$(grep -c "^${key}=" /root/vaani-ai/.env.example)"
done
```
**Expected:** 11 lines, every count is `1` (each key exactly once in each file).
**If it fails:** (1) a count is `0` → re-run the append commands above (they are
idempotent). (2) a count is `2+` → open the named file and delete the duplicate
line(s) by hand, keeping the first occurrence; if still wrong after one cleanup, STOP
and report.

---

## Step 2: Additive migration — `BackupCode` model (TOTP backup codes)

This is the ONLY schema change in this guide. It is additive (new model + one new
relation field on `User`); nothing from guide 02 is modified.

Append the relation field to the `User` model in `prisma/schema.prisma`: inside
`model User { ... }`, directly under the line `  ssoIdentities SsoIdentity[]`, add:

```prisma
  backupCodes   BackupCode[]
```

Then append this model at the END of `prisma/schema.prisma`:

```bash
cat >> /root/vaani-ai/prisma/schema.prisma <<'EOF'

// ---------- Auth: TOTP backup codes (guide 03) ----------
model BackupCode {
  id        String    @id @default(cuid())
  userId    String
  codeHash  String // sha256 hex of the normalized code; plaintext shown once
  usedAt    DateTime? // single-use: set when consumed at login
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
EOF
```

Run the migration:

```bash
cd /root/vaani-ai
npx prisma migrate dev --name backup_codes
```

**Verify:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c '\d "BackupCode"' | grep -E "codeHash|usedAt" | wc -l
```
**Expected:** `2`
**If it fails:** (1) check the relation field was added inside `model User` exactly
once — `grep -n "backupCodes" prisma/schema.prisma` must print exactly one line; fix
by hand if duplicated. (2) If migrate complains about drift, run
`npx prisma migrate dev --name backup_codes` again and accept the prompt; if it still
fails, STOP and report the full error.

---

## Step 3: Permission matrix — canonical permission vocabulary

This file is the **single source of truth for permission keys**. Guides 05–10 import
`PERMISSIONS` / `PermissionKey` / `requirePermission` from here — never invent new
strings elsewhere.

**File `src/lib/permissions.ts`** (full content):

```ts
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
    "calls:read", "recordings:read", "analytics:read",
    "live:listen",
  ],
  AGENT: [
    "calls:read", "recordings:read", "analytics:read",
    "live:listen", "live:whisper", "live:barge",
    "contacts:read",
  ],
  VIEWER: ["analytics:read"],
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
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.
**If it fails:** re-copy the file exactly; the only import is `Role` from
`@prisma/client` (exists since guide 02).

---

## Step 4: Core auth library (FULL rewrite — replaces the guide-03 draft of `src/lib/auth.ts`)

Adds: device/IP capture on session creation, `revokedAt` enforcement (forced logout,
spec 3.3), `lastSeenAt` tracking, `requirePermission()`, and short-lived "pending 2FA"
tokens for the TOTP login step.

**File `src/lib/auth.ts`** (full content — overwrite the whole file):

```ts
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
    secure: process.env.NODE_ENV === "production",
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
  const [token, jwt] = raw.split(".");
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
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** re-copy the file exactly. If the error says `headers` is not exported
from `next/headers`, you are not on `next@14.2.15` — check `node -e "console.log(require('./package.json').dependencies.next)"`.

---

## Step 5: Audit log helper

**File `src/lib/audit.ts`** (full content — overwrite the whole file):

```ts
import { db } from "./db";

/**
 * Append an audit log entry (spec 3.2 — audit log of every user action).
 * Never throws — audit failure must not break requests.
 */
export async function logAudit(input: {
  workspaceId: string;
  userId?: string;
  action: string; // e.g. "auth.login", "member.role_change", "apikey.create"
  entity: string; // e.g. "User", "Membership", "ApiKey"
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}

/** Backwards-compatible alias used by the register action and later guides. */
export const audit = logAudit;
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 6: TOTP 2FA library (enroll, verify, backup codes)

**File `src/lib/totp.ts`** (full content):

```ts
import crypto from "node:crypto";
import QRCode from "qrcode";
import { authenticator } from "otplib";

// Accept the previous/next 30s window to tolerate phone clock drift.
authenticator.options = { window: 1 };

export const TOTP_ISSUER = "Vaani AI";

export function generateTotpSecret(): string {
  return authenticator.generateSecret(); // base32
}

export function totpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, TOTP_ISSUER, secret);
}

/** Data URL (image/png;base64) for the enrollment QR code. */
export async function totpQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(totpKeyUri(email, secret));
}

/** True iff the 6-digit code is valid for this secret right now (±1 window). */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}

// ---------- Backup codes (hashed, single-use) ----------

/** Generate `count` human-readable codes like "k7f2-9qx4". Plaintext is shown ONCE. */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = crypto.randomBytes(8);
    let raw = "";
    for (const b of bytes) raw += alphabet[b % alphabet.length];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}

export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

/**
 * Pure consume-once matcher (unit-tested). Returns the id of the matching UNUSED
 * code, or null. The caller then sets `usedAt` on that row.
 */
export function findMatchingBackupCode(
  code: string,
  stored: { id: string; codeHash: string; usedAt: Date | null }[]
): string | null {
  const hash = hashBackupCode(code);
  const match = stored.find((row) => row.usedAt === null && row.codeHash === hash);
  return match ? match.id : null;
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** confirm Step 1 installed `otplib@12.0.1`, `qrcode@1.5.4`,
`@types/qrcode@1.5.5` (`npm ls otplib qrcode`). Re-copy the file.

---

## Step 7: API key library (hashing, scopes, CIDR allowlist, `requireApiKey`)

Guide 08 builds the full `/api/v1` REST surface and imports `requireApiKey` from
here — do not change its signature.

**File `src/lib/apikeys.ts`** (full content):

```ts
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
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 8: Shared provisioning helper (register + Google SSO auto-provision)

**File `src/lib/provision.ts`** (full content):

```ts
import { db } from "./db";

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * One transaction: user + workspace + OWNER membership + 14-day starter trial +
 * wallet with ₹1,000 (100000 paise) trial credit. Used by email/password register
 * and by Google SSO first-login auto-provisioning.
 */
export async function provisionUserWithWorkspace(input: {
  fullName: string;
  email: string;
  passwordHash: string;
  businessName: string;
}) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { fullName: input.fullName, email: input.email, passwordHash: input.passwordHash },
    });
    const workspace = await tx.workspace.create({
      data: { name: input.businessName, slug: slugify(input.businessName) },
    });
    await tx.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
    });
    const starter = await tx.plan.findUnique({ where: { code: "starter" } });
    if (starter) {
      await tx.subscription.create({
        data: {
          workspaceId: workspace.id,
          planId: starter.id,
          status: "active",
          currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
        },
      });
    }
    const wallet = await tx.wallet.create({
      data: { workspaceId: workspace.id, balancePaise: 0 },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "TRIAL_CREDIT",
        amountPaise: 100000, // ₹1,000 trial credit
        balanceAfterPaise: 100000,
        note: "Welcome trial credit",
      },
    });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: 100000 },
    });
    return { user, workspace };
  });
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 9: Middleware — protect app routes (FULL rewrite)

Adds public prefixes for SSO callbacks, the public API (API-key guarded, not cookie
guarded), and the invite acceptance page.

**File `src/middleware.ts`** (full content — overwrite the whole file):

```ts
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register"];
const PUBLIC_PREFIXES = [
  "/api/webhooks/",   // Dograh/Razorpay webhooks have their own signature checks
  "/api/auth/",       // SSO start + callback routes set the cookie themselves
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
  "/invite/",         // invite acceptance page handles its own auth logic
  "/_next/",
  "/favicon.ico",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = req.cookies.get("vaani_session")?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
```

Note: middleware only checks cookie EXISTENCE (edge runtime cannot do the DB check);
the real verification — including revoked-session enforcement — happens in
`requireUser`/`requireWorkspace` on every page/action.

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 10: Server actions — register, login (with 2FA step), logout

**File `src/server/actions/auth.ts`** (full content — overwrite the whole file):

```ts
"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  createPendingTotpToken,
  createSession,
  destroySession,
  getCurrentSession,
  requireUser,
  setActiveWorkspace,
  verifyPendingTotpToken,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { provisionUserWithWorkspace } from "@/lib/provision";
import { findMatchingBackupCode, verifyTotpCode } from "@/lib/totp";

export type ActionResult = {
  ok: boolean;
  error?: string;
  requiresTotp?: boolean;
  pendingToken?: string;
};

const registerSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(100),
  businessName: z.string().min(2).max(80),
});

export async function registerAction(input: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid details. Password must be 8+ characters." };
  const { fullName, email, password, businessName } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "An account with this email already exists." };

  const passwordHash = await bcrypt.hash(password, 10);
  const { user, workspace } = await provisionUserWithWorkspace({
    fullName, email, passwordHash, businessName,
  });

  await createSession(user.id, workspace.id);
  await logAudit({
    workspaceId: workspace.id,
    userId: user.id,
    action: "workspace.create",
    entity: "Workspace",
    entityId: workspace.id,
    metadata: { businessName },
  });
  return { ok: true };
}

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

async function firstWorkspaceId(userId: string): Promise<string | undefined> {
  const membership = await db.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return membership?.workspaceId;
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid email or password." };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return { ok: false, error: "Invalid email or password." };

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) return { ok: false, error: "Invalid email or password." };

  // TOTP second factor (spec 3.3): if enabled, do NOT create the session yet.
  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (totp && totp.status === "ENABLED") {
    const pendingToken = await createPendingTotpToken(user.id);
    return { ok: true, requiresTotp: true, pendingToken };
  }

  const workspaceId = await firstWorkspaceId(user.id);
  await createSession(user.id, workspaceId);
  if (workspaceId) {
    await logAudit({
      workspaceId, userId: user.id,
      action: "auth.login", entity: "User", entityId: user.id,
      metadata: { method: "password" },
    });
  }
  return { ok: true };
}

const totpLoginSchema = z.object({
  pendingToken: z.string().min(10),
  code: z.string().min(6).max(20), // 6-digit TOTP or a backup code like "k7f2-9qx4"
});

/** Second step of login when TOTP is enabled. Accepts a TOTP code OR a backup code. */
export async function verifyLoginTotpAction(input: unknown): Promise<ActionResult> {
  const parsed = totpLoginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid code." };

  const userId = await verifyPendingTotpToken(parsed.data.pendingToken);
  if (!userId) return { ok: false, error: "Session expired. Sign in again." };

  const totp = await db.totpSecret.findUnique({ where: { userId } });
  if (!totp || totp.status !== "ENABLED") return { ok: false, error: "2FA is not enabled." };

  const code = parsed.data.code.trim();
  let method: "totp" | "backup_code";
  if (verifyTotpCode(totp.secret, code)) {
    method = "totp";
  } else {
    const codes = await db.backupCode.findMany({ where: { userId, usedAt: null } });
    const matchId = findMatchingBackupCode(code, codes);
    if (!matchId) return { ok: false, error: "Invalid code." };
    await db.backupCode.update({ where: { id: matchId }, data: { usedAt: new Date() } });
    method = "backup_code";
  }

  const workspaceId = await firstWorkspaceId(userId);
  await createSession(userId, workspaceId);
  if (workspaceId) {
    await logAudit({
      workspaceId, userId,
      action: "auth.login", entity: "User", entityId: userId,
      metadata: { method },
    });
  }
  return { ok: true };
}

export async function logoutAction() {
  const session = await getCurrentSession();
  if (session?.activeWorkspaceId) {
    await logAudit({
      workspaceId: session.activeWorkspaceId,
      userId: session.userId,
      action: "auth.logout",
      entity: "Session",
      entityId: session.id,
    });
  }
  await destroySession();
  redirect("/login");
}

/** Used by the workspace switcher UI. */
export async function switchWorkspaceAction(workspaceId: string): Promise<ActionResult> {
  const user = await requireUser();
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return { ok: false, error: "Not a member of this workspace." };
  await setActiveWorkspace(workspaceId);
  return { ok: true };
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** make sure Step 4 (`src/lib/auth.ts`) and Step 8 (`src/lib/provision.ts`)
were written first. Re-copy the failing file exactly.

---

## Step 11: Server actions — members, roles, permission overrides, invites

All actions follow the pattern: `requirePermission` (auth+tenant) → zod →
tenant-scoped prisma → audit → `revalidatePath`.

**File `src/server/actions/members.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isPermissionKey } from "@/lib/permissions";
import type { Role } from "@prisma/client";

export type MemberActionResult = { ok: boolean; error?: string };

const roleSchema = z.enum(["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"]);

/** Count OWNER memberships in a workspace (to protect the last owner). */
async function ownerCount(workspaceId: string): Promise<number> {
  return db.membership.count({ where: { workspaceId, role: "OWNER" } });
}

export async function updateMemberRoleAction(input: unknown): Promise<MemberActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z
    .object({ membershipId: z.string().min(1), role: roleSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  // Tenant scope: the membership MUST belong to the current workspace.
  const target = await db.membership.findFirst({
    where: { id: parsed.data.membershipId, workspaceId: ctx.workspaceId },
  });
  if (!target) return { ok: false, error: "Member not found." };
  if (target.userId === ctx.user.id) return { ok: false, error: "You cannot change your own role." };
  if (target.role === "OWNER" && parsed.data.role !== "OWNER" && (await ownerCount(ctx.workspaceId)) <= 1) {
    return { ok: false, error: "Cannot demote the last owner." };
  }

  await db.membership.update({
    where: { id: target.id },
    data: { role: parsed.data.role as Role },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.role_change", entity: "Membership", entityId: target.id,
    metadata: { from: target.role, to: parsed.data.role, targetUserId: target.userId },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}

export async function updateMemberPermissionsAction(input: unknown): Promise<MemberActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z
    .object({
      membershipId: z.string().min(1),
      grantedPermissions: z.array(z.string()).max(64),
      revokedPermissions: z.array(z.string()).max(64),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const granted = parsed.data.grantedPermissions.filter(isPermissionKey);
  const revoked = parsed.data.revokedPermissions.filter(isPermissionKey);
  if (granted.length !== parsed.data.grantedPermissions.length ||
      revoked.length !== parsed.data.revokedPermissions.length) {
    return { ok: false, error: "Unknown permission key." };
  }
  if (granted.some((k) => revoked.includes(k))) {
    return { ok: false, error: "A permission cannot be both granted and revoked." };
  }

  const target = await db.membership.findFirst({
    where: { id: parsed.data.membershipId, workspaceId: ctx.workspaceId },
  });
  if (!target) return { ok: false, error: "Member not found." };
  if (target.role === "OWNER") {
    return { ok: false, error: "Owner permissions cannot be restricted." };
  }

  await db.membership.update({
    where: { id: target.id },
    data: { grantedPermissions: granted, revokedPermissions: revoked },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.permissions_update", entity: "Membership", entityId: target.id,
    metadata: { granted, revoked, targetUserId: target.userId },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}

export async function removeMemberAction(input: unknown): Promise<MemberActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z.object({ membershipId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const target = await db.membership.findFirst({
    where: { id: parsed.data.membershipId, workspaceId: ctx.workspaceId },
  });
  if (!target) return { ok: false, error: "Member not found." };
  if (target.userId === ctx.user.id) return { ok: false, error: "You cannot remove yourself." };
  if (target.role === "OWNER" && (await ownerCount(ctx.workspaceId)) <= 1) {
    return { ok: false, error: "Cannot remove the last owner." };
  }

  await db.membership.delete({ where: { id: target.id } });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.remove", entity: "Membership", entityId: target.id,
    metadata: { targetUserId: target.userId },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}
```

**File `src/server/actions/invites.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, requireUser, setActiveWorkspace } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export type InviteActionResult = { ok: boolean; error?: string; inviteUrl?: string };

const INVITE_TTL_DAYS = 7;

function inviteUrlFor(token: string): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base}/invite/${token}`;
}

export async function createInviteAction(input: unknown): Promise<InviteActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z
    .object({
      email: z.string().email().toLowerCase(),
      role: z.enum(["ADMIN", "MANAGER", "AGENT", "VIEWER"]), // OWNER is never invitable
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Valid email and role required." };

  // Already a member?
  const existingMember = await db.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, user: { email: parsed.data.email } },
  });
  if (existingMember) return { ok: false, error: "This person is already a member." };

  // One pending invite per email per workspace: revoke older ones.
  await db.workspaceInvite.updateMany({
    where: { workspaceId: ctx.workspaceId, email: parsed.data.email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const invite = await db.workspaceInvite.create({
    data: {
      workspaceId: ctx.workspaceId,
      email: parsed.data.email,
      role: parsed.data.role,
      token: crypto.randomUUID(),
      invitedByUserId: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.invite", entity: "WorkspaceInvite", entityId: invite.id,
    metadata: { email: invite.email, role: invite.role },
  });
  revalidatePath("/settings/members");
  // Email delivery lands in guides 09/10 — for now the operator copies this link
  // from the UI and sends it manually.
  return { ok: true, inviteUrl: inviteUrlFor(invite.token) };
}

export async function revokeInviteAction(input: unknown): Promise<InviteActionResult> {
  const ctx = await requirePermission("users:write");
  const parsed = z.object({ inviteId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const invite = await db.workspaceInvite.findFirst({
    where: { id: parsed.data.inviteId, workspaceId: ctx.workspaceId, status: "PENDING" },
  });
  if (!invite) return { ok: false, error: "Invite not found." };

  await db.workspaceInvite.update({ where: { id: invite.id }, data: { status: "REVOKED" } });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "member.invite_revoke", entity: "WorkspaceInvite", entityId: invite.id,
    metadata: { email: invite.email },
  });
  revalidatePath("/settings/members");
  return { ok: true };
}

export async function acceptInviteAction(input: unknown): Promise<InviteActionResult> {
  const user = await requireUser(); // NOT requireWorkspace — the invitee may have none yet
  const parsed = z.object({ token: z.string().min(10) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invite." };

  const invite = await db.workspaceInvite.findUnique({ where: { token: parsed.data.token } });
  if (!invite || invite.status !== "PENDING") return { ok: false, error: "Invite is no longer valid." };
  if (invite.expiresAt < new Date()) {
    await db.workspaceInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return { ok: false, error: "Invite has expired. Ask for a new one." };
  }
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, error: `This invite was sent to ${invite.email}. Sign in with that email.` };
  }

  await db.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
      update: { role: invite.role },
      create: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role },
    });
    await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
  });
  await setActiveWorkspace(invite.workspaceId);
  await logAudit({
    workspaceId: invite.workspaceId, userId: user.id,
    action: "member.invite_accept", entity: "WorkspaceInvite", entityId: invite.id,
    metadata: { email: invite.email, role: invite.role },
  });
  return { ok: true };
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 12: Server actions — TOTP 2FA (enroll, confirm, disable)

**File `src/server/actions/totp.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentSession, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  totpQrDataUrl,
  verifyTotpCode,
} from "@/lib/totp";

export type TotpActionResult = {
  ok: boolean;
  error?: string;
  secret?: string;
  qrDataUrl?: string;
  backupCodes?: string[];
};

async function auditIfWorkspace(userId: string, action: string, entityId?: string) {
  const session = await getCurrentSession();
  if (!session?.activeWorkspaceId) return;
  await logAudit({
    workspaceId: session.activeWorkspaceId,
    userId, action, entity: "TotpSecret", entityId,
  });
}

/** Step 1 of enrollment: create/replace a PENDING secret and return QR + secret. */
export async function startTotpEnrollmentAction(): Promise<TotpActionResult> {
  const user = await requireUser();
  const existing = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (existing?.status === "ENABLED") {
    return { ok: false, error: "2FA is already enabled. Disable it first to re-enroll." };
  }
  const secret = generateTotpSecret();
  await db.totpSecret.upsert({
    where: { userId: user.id },
    update: { secret, status: "PENDING", enabledAt: null },
    create: { userId: user.id, secret, status: "PENDING" },
  });
  const qrDataUrl = await totpQrDataUrl(user.email, secret);
  return { ok: true, secret, qrDataUrl };
}

/** Step 2 of enrollment: confirm a code from the authenticator app → ENABLED + backup codes. */
export async function confirmTotpEnrollmentAction(input: unknown): Promise<TotpActionResult> {
  const user = await requireUser();
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter the 6-digit code." };

  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (!totp || totp.status !== "PENDING") {
    return { ok: false, error: "Start enrollment first." };
  }
  if (!verifyTotpCode(totp.secret, parsed.data.code)) {
    return { ok: false, error: "Wrong code. Check your authenticator app and try again." };
  }

  const backupCodes = generateBackupCodes(10);
  await db.$transaction(async (tx) => {
    await tx.totpSecret.update({
      where: { userId: user.id },
      data: { status: "ENABLED", enabledAt: new Date() },
    });
    await tx.backupCode.deleteMany({ where: { userId: user.id } });
    await tx.backupCode.createMany({
      data: backupCodes.map((code) => ({ userId: user.id, codeHash: hashBackupCode(code) })),
    });
  });
  await auditIfWorkspace(user.id, "totp.enable", totp.id);
  revalidatePath("/settings/security");
  return { ok: true, backupCodes };
}

/** Disable 2FA. Requires the current password (re-auth) — never disable silently. */
export async function disableTotpAction(input: unknown): Promise<TotpActionResult> {
  const user = await requireUser();
  const parsed = z.object({ password: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Password required." };

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) return { ok: false, error: "Wrong password." };

  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  if (!totp || totp.status !== "ENABLED") return { ok: false, error: "2FA is not enabled." };

  await db.$transaction(async (tx) => {
    await tx.totpSecret.update({ where: { userId: user.id }, data: { status: "DISABLED" } });
    await tx.backupCode.deleteMany({ where: { userId: user.id } });
  });
  await auditIfWorkspace(user.id, "totp.disable", totp.id);
  revalidatePath("/settings/security");
  return { ok: true };
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 13: Server actions — API keys (create, revoke)

**File `src/server/actions/apikeys.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isPermissionKey } from "@/lib/permissions";
import {
  apiKeyPrefix,
  generateApiKeySecret,
  hashApiKey,
  isValidCidr,
} from "@/lib/apikeys";

export type ApiKeyActionResult = { ok: boolean; error?: string; apiKey?: string };

const createSchema = z.object({
  name: z.string().min(2).max(60),
  scopes: z.array(z.string()).min(1).max(40),
  ipAllowlist: z.array(z.string()).max(20).default([]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** Creates the key. The full secret is returned ONCE — it is never stored. */
export async function createApiKeyAction(input: unknown): Promise<ApiKeyActionResult> {
  const ctx = await requirePermission("apikeys:write");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Name and at least one scope required." };

  if (!parsed.data.scopes.every(isPermissionKey)) {
    return { ok: false, error: "Unknown scope. Scopes must be permission keys." };
  }
  if (!parsed.data.ipAllowlist.every(isValidCidr)) {
    return { ok: false, error: "Invalid CIDR in IP allowlist (e.g. 203.0.113.10/32)." };
  }

  const secret = generateApiKeySecret();
  const record = await db.apiKey.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: parsed.data.name,
      keyPrefix: apiKeyPrefix(secret),
      keyHash: hashApiKey(secret),
      scopes: parsed.data.scopes,
      ipAllowlist: parsed.data.ipAllowlist,
      createdByUserId: ctx.user.id,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    },
  });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "apikey.create", entity: "ApiKey", entityId: record.id,
    metadata: { name: record.name, keyPrefix: record.keyPrefix, scopes: record.scopes },
  });
  revalidatePath("/settings/api-keys");
  return { ok: true, apiKey: secret };
}

export async function revokeApiKeyAction(input: unknown): Promise<ApiKeyActionResult> {
  const ctx = await requirePermission("apikeys:write");
  const parsed = z.object({ apiKeyId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const key = await db.apiKey.findFirst({
    where: { id: parsed.data.apiKeyId, workspaceId: ctx.workspaceId, revokedAt: null },
  });
  if (!key) return { ok: false, error: "API key not found." };

  await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await logAudit({
    workspaceId: ctx.workspaceId, userId: ctx.user.id,
    action: "apikey.revoke", entity: "ApiKey", entityId: key.id,
    metadata: { name: key.name, keyPrefix: key.keyPrefix },
  });
  revalidatePath("/settings/api-keys");
  return { ok: true };
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 14: Server actions — session management (device history, forced logout)

**File `src/server/actions/sessions.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  getCurrentSession,
  requireUser,
  revokeAllUserSessions,
  revokeSessionById,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export type SessionActionResult = { ok: boolean; error?: string };

/** Revoke one of YOUR sessions (device history → forced logout, spec 3.3). */
export async function revokeSessionAction(input: unknown): Promise<SessionActionResult> {
  const user = await requireUser();
  const current = await getCurrentSession();
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const target = await db.session.findFirst({
    where: { id: parsed.data.sessionId, userId: user.id },
  });
  if (!target) return { ok: false, error: "Session not found." };
  if (current && target.id === current.id) {
    return { ok: false, error: "Use Sign out to end your current session." };
  }

  await revokeSessionById(target.id);
  if (current?.activeWorkspaceId) {
    await logAudit({
      workspaceId: current.activeWorkspaceId, userId: user.id,
      action: "session.revoke", entity: "Session", entityId: target.id,
      metadata: { deviceName: target.deviceName },
    });
  }
  revalidatePath("/settings/sessions");
  return { ok: true };
}

/** "Log out all devices" — revokes every session of yours except the current one. */
export async function revokeOtherSessionsAction(): Promise<SessionActionResult> {
  const user = await requireUser();
  const current = await getCurrentSession();
  await revokeAllUserSessions(user.id, current?.id);
  if (current?.activeWorkspaceId) {
    await logAudit({
      workspaceId: current.activeWorkspaceId, userId: user.id,
      action: "session.revoke_all", entity: "User", entityId: user.id,
    });
  }
  revalidatePath("/settings/sessions");
  return { ok: true };
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 15: UI components (shadcn-style, used by all later pages)

Create these three files EXACTLY (skip any that already exist unchanged from a
previous attempt — `diff` to check). Later guides add more components in this style.

**File `src/components/ui/button.tsx`:**
```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        outline: "border border-border bg-transparent shadow-sm hover:bg-muted",
        ghost: "hover:bg-muted",
        destructive: "bg-red-600 text-white shadow-sm hover:bg-red-500",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

**File `src/components/ui/input.tsx`:**
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
```

**File `src/components/ui/card.tsx`:**
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow", className)} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardContent };
```

Plus two small shared pieces:

**File `src/components/ui/select.tsx`:**
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = "Select";

export { Select };
```

**File `src/components/settings-nav.tsx`** (settings section nav, used by the settings layout):
```tsx
import Link from "next/link";

const LINKS = [
  { href: "/settings/members", label: "Members" },
  { href: "/settings/security", label: "Security (2FA)" },
  { href: "/settings/api-keys", label: "API keys" },
  { href: "/settings/sessions", label: "Sessions" },
  { href: "/settings/audit-log", label: "Audit log" },
];

export function SettingsNav() {
  return (
    <nav data-testid="settings-nav" className="mb-6 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
```

**File `src/app/(app)/settings/layout.tsx`:**
```tsx
import { SettingsNav } from "@/components/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="mb-4 text-2xl font-bold">Workspace settings</h1>
      <SettingsNav />
      {children}
    </main>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 16: Login & Register pages (FULL rewrite — SSO buttons + TOTP step + testids)

**File `src/app/(auth)/login/page.tsx`:**
```tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction, verifyLoginTotpAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GOOGLE_SSO = process.env.NEXT_PUBLIC_GOOGLE_SSO_ENABLED === "true";
const OIDC_SSO = process.env.NEXT_PUBLIC_OIDC_SSO_ENABLED === "true";

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(
    search.get("error") === "sso" ? "SSO sign-in failed. Try again or use your password." : null
  );
  const [loading, setLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [useBackupCode, setUseBackupCode] = useState(false);

  function afterSuccess() {
    router.push(search.get("next") ?? "/dashboard");
    router.refresh();
  }

  async function onSubmitPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await loginAction({
      email: form.get("email"),
      password: form.get("password"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Login failed.");
    if (res.requiresTotp && res.pendingToken) return setPendingToken(res.pendingToken);
    afterSuccess();
  }

  async function onSubmitTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await verifyLoginTotpAction({
      pendingToken,
      code: form.get("code"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Invalid code.");
    afterSuccess();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            Sign in to <span className="text-primary">Vaani AI</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingToken === null ? (
            <>
              <form data-testid="login-form" onSubmit={onSubmitPassword} className="space-y-4">
                <Input data-testid="login-email-input" name="email" type="email" placeholder="you@business.com" required />
                <Input data-testid="login-password-input" name="password" type="password" placeholder="Password" required />
                {error && <p data-testid="login-error" className="text-sm text-red-400">{error}</p>}
                <Button data-testid="login-submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </form>
              {(GOOGLE_SSO || OIDC_SSO) && (
                <div className="mt-4 space-y-2">
                  <div className="text-center text-xs text-muted-foreground">or continue with</div>
                  {GOOGLE_SSO && (
                    <a data-testid="login-google-button" href="/api/auth/google/start">
                      <Button variant="outline" className="w-full" type="button">Google</Button>
                    </a>
                  )}
                  {OIDC_SSO && (
                    <a data-testid="login-oidc-button" href="/api/auth/oidc/start">
                      <Button variant="outline" className="w-full" type="button">Enterprise SSO</Button>
                    </a>
                  )}
                </div>
              )}
              <p className="mt-4 text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link href="/register" className="text-primary hover:underline">
                  Start free trial
                </Link>
              </p>
            </>
          ) : (
            <form data-testid="login-totp-form" onSubmit={onSubmitTotp} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {useBackupCode
                  ? "Enter one of your backup codes."
                  : "Enter the 6-digit code from your authenticator app."}
              </p>
              <Input
                data-testid="login-totp-input"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={useBackupCode ? "xxxx-xxxx" : "123456"}
                required
              />
              {error && <p data-testid="login-error" className="text-sm text-red-400">{error}</p>}
              <Button data-testid="login-totp-submit" className="w-full" disabled={loading}>
                {loading ? "Verifying…" : "Verify"}
              </Button>
              <button
                data-testid="login-backup-code-toggle"
                type="button"
                className="w-full text-center text-sm text-primary hover:underline"
                onClick={() => setUseBackupCode((v) => !v)}
              >
                {useBackupCode ? "Use authenticator code instead" : "Use a backup code instead"}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

**File `src/app/(auth)/register/page.tsx`:**
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registerAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await registerAction({
      fullName: form.get("fullName"),
      email: form.get("email"),
      password: form.get("password"),
      businessName: form.get("businessName"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Registration failed.");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            Create your <span className="text-primary">Vaani AI</span> workspace
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            ₹1,000 free call credit. No card required.
          </p>
        </CardHeader>
        <CardContent>
          <form data-testid="register-form" onSubmit={onSubmit} className="space-y-4">
            <Input data-testid="register-name-input" name="fullName" placeholder="Your name" required />
            <Input data-testid="register-business-input" name="businessName" placeholder="Business name (e.g. Sharma Dental)" required />
            <Input data-testid="register-email-input" name="email" type="email" placeholder="you@business.com" required />
            <Input data-testid="register-password-input" name="password" type="password" placeholder="Password (8+ chars)" required minLength={8} />
            {error && <p data-testid="register-error" className="text-sm text-red-400">{error}</p>}
            <Button data-testid="register-submit" className="w-full" disabled={loading}>
              {loading ? "Creating…" : "Create workspace"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already registered?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** typecheck exit 0; build succeeds and the route table includes
`/login` and `/register`.
**If it fails:** fix the named file by re-copying it exactly.

---

## Step 17: Temporary dashboard page (replaced by guide 08, needed now to test auth)

**File `src/app/(app)/dashboard/page.tsx`** (full content):
```tsx
import { requireWorkspace } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const workspace = await db.workspace.findUnique({ where: { id: ctx.workspaceId } });
  const wallet = await db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{workspace?.name}</h1>
        <div className="flex gap-2">
          <Link href="/settings/members">
            <Button variant="outline" size="sm">Settings</Button>
          </Link>
          <form action={logoutAction}>
            <Button data-testid="logout-button" variant="outline" size="sm">Sign out</Button>
          </form>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Wallet balance</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-primary">
            {formatINR(wallet?.balancePaise ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Signed in as</CardTitle></CardHeader>
          <CardContent>
            <p>{ctx.user.fullName}</p>
            <p className="text-sm text-muted-foreground">{ctx.user.email} · {ctx.membership.role}</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 18: Settings — Members page (roles + permission overrides + invites)

**File `src/app/(app)/settings/members/page.tsx`** (full content):
```tsx
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InviteForm,
  InviteRevokeButton,
  MemberPermissionsEditor,
  MemberRemoveButton,
  MemberRoleSelect,
} from "./client";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  let ctx;
  try {
    ctx = await requirePermission("users:read");
  } catch {
    return (
      <p data-testid="members-forbidden" className="text-sm text-red-400">
        You do not have permission to view members.
      </p>
    );
  }

  const memberships = await db.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invites = await db.workspaceInvite.findMany({
    where: { workspaceId: ctx.workspaceId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const canWrite = ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN";

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader><CardTitle>Members</CardTitle></CardHeader>
        <CardContent>
          <table data-testid="members-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Permission overrides</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id} data-testid="member-row" className="border-b align-top">
                  <td className="py-2 pr-4">{m.user.fullName}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{m.user.email}</td>
                  <td className="py-2 pr-4">
                    {canWrite && m.user.id !== ctx.user.id ? (
                      <MemberRoleSelect membershipId={m.id} role={m.role} />
                    ) : (
                      <span>{m.role}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {canWrite && m.role !== "OWNER" ? (
                      <MemberPermissionsEditor
                        membershipId={m.id}
                        granted={m.grantedPermissions}
                        revoked={m.revokedPermissions}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {canWrite && m.user.id !== ctx.user.id && (
                      <MemberRemoveButton membershipId={m.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader><CardTitle>Invite a teammate</CardTitle></CardHeader>
          <CardContent>
            <InviteForm />
            {invites.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-medium">Pending invites</h3>
                <table data-testid="invites-table" className="w-full text-sm">
                  <tbody>
                    {invites.map((inv) => (
                      <tr key={inv.id} className="border-b">
                        <td className="py-2 pr-4">{inv.email}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{inv.role}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          expires {inv.expiresAt.toISOString().slice(0, 10)}
                        </td>
                        <td className="py-2 pr-4">
                          <code data-testid="invite-link" className="block max-w-xs truncate rounded bg-muted px-2 py-1 text-xs">
                            {`${baseUrl}/invite/${inv.token}`}
                          </code>
                        </td>
                        <td className="py-2 text-right">
                          <InviteRevokeButton inviteId={inv.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

**File `src/app/(app)/settings/members/client.tsx`** (full content):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  removeMemberAction,
  updateMemberPermissionsAction,
  updateMemberRoleAction,
} from "@/server/actions/members";
import { createInviteAction, revokeInviteAction } from "@/server/actions/invites";
import { PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const ROLES = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;

export function MemberRoleSelect({ membershipId, role }: { membershipId: string; role: string }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: string) {
    setValue(next);
    setError(null);
    const res = await updateMemberRoleAction({ membershipId, role: next });
    if (!res.ok) {
      setError(res.error ?? "Failed.");
      setValue(role);
    }
    router.refresh();
  }

  return (
    <span>
      <Select
        data-testid="member-role-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-32"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </Select>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function MemberPermissionsEditor({
  membershipId,
  granted,
  revoked,
}: {
  membershipId: string;
  granted: string[];
  revoked: string[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function initial(key: string): string {
    if (granted.includes(key)) return "grant";
    if (revoked.includes(key)) return "revoke";
    return "default";
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(e.currentTarget);
    const grantedPermissions: string[] = [];
    const revokedPermissions: string[] = [];
    for (const key of PERMISSIONS) {
      const v = form.get(`perm:${key}`);
      if (v === "grant") grantedPermissions.push(key);
      if (v === "revoke") revokedPermissions.push(key);
    }
    const res = await updateMemberPermissionsAction({ membershipId, grantedPermissions, revokedPermissions });
    setSaving(false);
    setMessage(res.ok ? "Saved." : res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <details>
      <summary data-testid="member-permissions-toggle" className="cursor-pointer text-primary hover:underline">
        Edit overrides
      </summary>
      <form onSubmit={onSave} className="mt-2 space-y-1 rounded-md border border-border p-3">
        <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {PERMISSIONS.map((key) => (
            <label key={key} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono">{key}</span>
              <Select name={`perm:${key}`} defaultValue={initial(key)} className="h-7 w-24 text-xs">
                <option value="default">default</option>
                <option value="grant">grant</option>
                <option value="revoke">revoke</option>
              </Select>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button data-testid="member-overrides-save" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save overrides"}
          </Button>
          {message && <span className="text-xs text-muted-foreground">{message}</span>}
        </div>
      </form>
    </details>
  );
}

export function MemberRemoveButton({ membershipId }: { membershipId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onRemove() {
    setError(null);
    const res = await removeMemberAction({ membershipId });
    if (!res.ok) return setError(res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <span>
      <Button data-testid="member-remove-button" variant="destructive" size="sm" onClick={onRemove}>
        Remove
      </Button>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function InviteForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInviteUrl(null);
    const form = new FormData(e.currentTarget);
    const res = await createInviteAction({
      email: form.get("email"),
      role: form.get("role"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setInviteUrl(res.inviteUrl ?? null);
    router.refresh();
  }

  return (
    <div>
      <form data-testid="invite-form" onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <Input data-testid="invite-email-input" name="email" type="email" placeholder="teammate@business.com" required className="w-64" />
        <Select data-testid="invite-role-select" name="role" defaultValue="AGENT" className="w-36">
          <option value="ADMIN">ADMIN</option>
          <option value="MANAGER">MANAGER</option>
          <option value="AGENT">AGENT</option>
          <option value="VIEWER">VIEWER</option>
        </Select>
        <Button data-testid="invite-submit" disabled={loading}>
          {loading ? "Creating…" : "Create invite link"}
        </Button>
      </form>
      {error && <p data-testid="invite-error" className="mt-2 text-sm text-red-400">{error}</p>}
      {inviteUrl && (
        <p className="mt-3 text-sm">
          Share this link (email delivery arrives in a later guide):{" "}
          <code data-testid="invite-created-link" className="rounded bg-muted px-2 py-1 text-xs">{inviteUrl}</code>
        </p>
      )}
    </div>
  );
}

export function InviteRevokeButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  async function onRevoke() {
    await revokeInviteAction({ inviteId });
    router.refresh();
  }
  return (
    <Button data-testid="invite-revoke-button" variant="outline" size="sm" onClick={onRevoke}>
      Revoke
    </Button>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 19: Invite acceptance page

**File `src/app/invite/[token]/page.tsx`** (full content):
```tsx
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { AcceptInviteButton } from "./client";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const invite = await db.workspaceInvite.findUnique({
    where: { token: params.token },
    include: { workspace: { select: { name: true } } },
  });
  const user = await getCurrentUser();

  const invalid =
    !invite || invite.status !== "PENDING" || invite.expiresAt < new Date();

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Workspace invite</CardTitle></CardHeader>
        <CardContent>
          {invalid ? (
            <p data-testid="invite-invalid" className="text-sm text-red-400">
              This invite is invalid, revoked, or expired. Ask your admin for a new one.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm" data-testid="invite-details">
                You have been invited to join{" "}
                <span className="font-semibold">{invite.workspace.name}</span> as{" "}
                <span className="font-semibold">{invite.role}</span> ({invite.email}).
              </p>
              {user ? (
                <AcceptInviteButton token={params.token} />
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">Sign in with {invite.email} to accept.</p>
                  <Link href={`/login?next=/invite/${params.token}`}>
                    <Button data-testid="invite-login-link" className="w-full">Sign in to accept</Button>
                  </Link>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

**File `src/app/invite/[token]/client.tsx`** (full content):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/server/actions/invites";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onAccept() {
    setLoading(true);
    setError(null);
    const res = await acceptInviteAction({ token });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed to accept invite.");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <Button data-testid="invite-accept-button" className="w-full" onClick={onAccept} disabled={loading}>
        {loading ? "Joining…" : "Accept invite"}
      </Button>
      {error && <p data-testid="invite-accept-error" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 20: Settings — Security page (TOTP 2FA enroll/disable)

**File `src/app/(app)/settings/security/page.tsx`** (full content):
```tsx
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { TotpManager } from "./client";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }
  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  const remainingBackupCodes = totp?.status === "ENABLED"
    ? await db.backupCode.count({ where: { userId: user.id, usedAt: null } })
    : 0;

  return (
    <Card>
      <CardHeader><CardTitle>Two-factor authentication (TOTP)</CardTitle></CardHeader>
      <CardContent>
        <p data-testid="totp-status" className="mb-4 text-sm">
          Status:{" "}
          <span className="font-semibold">
            {totp?.status === "ENABLED" ? `Enabled (${remainingBackupCodes} backup codes left)` : "Disabled"}
          </span>
        </p>
        <TotpManager enabled={totp?.status === "ENABLED"} />
      </CardContent>
    </Card>
  );
}
```

**File `src/app/(app)/settings/security/client.tsx`** (full content):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmTotpEnrollmentAction,
  disableTotpAction,
  startTotpEnrollmentAction,
} from "@/server/actions/totp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TotpManager({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enroll, setEnroll] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  async function onStart() {
    setLoading(true);
    setError(null);
    const res = await startTotpEnrollmentAction();
    setLoading(false);
    if (!res.ok || !res.secret || !res.qrDataUrl) return setError(res.error ?? "Failed to start.");
    setEnroll({ secret: res.secret, qrDataUrl: res.qrDataUrl });
  }

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const code = new FormData(e.currentTarget).get("code");
    const res = await confirmTotpEnrollmentAction({ code });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setBackupCodes(res.backupCodes ?? []);
    setEnroll(null);
    router.refresh();
  }

  async function onDisable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const password = new FormData(e.currentTarget).get("password");
    const res = await disableTotpAction({ password });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    router.refresh();
  }

  if (backupCodes) {
    return (
      <div data-testid="totp-backup-codes" className="space-y-3">
        <p className="text-sm font-medium text-amber-400">
          Save these backup codes NOW — they are shown only once. Each works once.
        </p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-3">
          {backupCodes.map((c) => (
            <li key={c} className="rounded bg-muted px-2 py-1">{c}</li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => setBackupCodes(null)}>Done</Button>
      </div>
    );
  }

  if (enroll) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Scan with your authenticator app (Google Authenticator, Authy, 1Password…):
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img data-testid="totp-qr" src={enroll.qrDataUrl} alt="TOTP QR code" className="h-44 w-44 rounded-md bg-white p-2" />
        <p className="text-sm">
          Or enter manually: <code data-testid="totp-secret" className="rounded bg-muted px-2 py-1 text-xs">{enroll.secret}</code>
        </p>
        <form onSubmit={onConfirm} className="flex items-end gap-2">
          <Input
            data-testid="totp-confirm-input"
            name="code"
            inputMode="numeric"
            placeholder="123456"
            maxLength={6}
            required
            className="w-32"
          />
          <Button data-testid="totp-confirm-submit" disabled={loading}>
            {loading ? "Verifying…" : "Confirm & enable"}
          </Button>
        </form>
        {error && <p data-testid="totp-error" className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  if (enabled) {
    return (
      <form onSubmit={onDisable} className="flex items-end gap-2">
        <Input
          data-testid="totp-disable-password"
          name="password"
          type="password"
          placeholder="Confirm with password"
          required
          className="w-56"
        />
        <Button data-testid="totp-disable-button" variant="destructive" disabled={loading}>
          {loading ? "Disabling…" : "Disable 2FA"}
        </Button>
        {error && <p data-testid="totp-error" className="text-sm text-red-400">{error}</p>}
      </form>
    );
  }

  return (
    <div>
      <Button data-testid="totp-enroll-start" onClick={onStart} disabled={loading}>
        {loading ? "Preparing…" : "Enable 2FA"}
      </Button>
      {error && <p data-testid="totp-error" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 21: Settings — API keys page

**File `src/app/(app)/settings/api-keys/page.tsx`** (full content):
```tsx
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeyCreateForm, ApiKeyRevokeButton } from "./client";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  let ctx;
  try {
    ctx = await requirePermission("apikeys:read");
  } catch {
    return (
      <p data-testid="apikeys-forbidden" className="text-sm text-red-400">
        You do not have permission to view API keys.
      </p>
    );
  }

  const keys = await db.apiKey.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  const canWrite = ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN";

  return (
    <div className="space-y-8">
      {canWrite && (
        <Card>
          <CardHeader><CardTitle>Create API key</CardTitle></CardHeader>
          <CardContent><ApiKeyCreateForm /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>API keys</CardTitle></CardHeader>
        <CardContent>
          <table data-testid="apikey-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Prefix</th>
                <th className="py-2 pr-4">Scopes</th>
                <th className="py-2 pr-4">IP allowlist</th>
                <th className="py-2 pr-4">Last used</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} data-testid="apikey-row" className="border-b align-top">
                  <td className="py-2 pr-4">{k.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{k.keyPrefix}…</td>
                  <td className="py-2 pr-4 font-mono text-xs">{k.scopes.join(", ")}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {k.ipAllowlist.length ? k.ipAllowlist.join(", ") : "any"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground" data-testid="apikey-last-used">
                    {k.lastUsedAt ? k.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "never"}
                  </td>
                  <td className="py-2 pr-4">{k.revokedAt ? "revoked" : "active"}</td>
                  <td className="py-2 text-right">
                    {canWrite && !k.revokedAt && <ApiKeyRevokeButton apiKeyId={k.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/settings/api-keys/client.tsx`** (full content):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createApiKeyAction, revokeApiKeyAction } from "@/server/actions/apikeys";
import { PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ApiKeyCreateForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCreatedKey(null);
    const form = new FormData(e.currentTarget);
    const scopes = PERMISSIONS.filter((p) => form.get(`scope:${p}`) === "on");
    const ipAllowlist = String(form.get("ipAllowlist") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await createApiKeyAction({
      name: form.get("name"),
      scopes,
      ipAllowlist,
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setCreatedKey(res.apiKey ?? null);
    router.refresh();
  }

  if (createdKey) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-amber-400">
          Copy this key NOW — it is shown only once and never stored in plain text.
        </p>
        <code data-testid="apikey-created-value" className="block break-all rounded bg-muted px-3 py-2 font-mono text-sm">
          {createdKey}
        </code>
        <Button variant="outline" size="sm" onClick={() => setCreatedKey(null)}>Done</Button>
      </div>
    );
  }

  return (
    <form data-testid="apikey-form" onSubmit={onSubmit} className="space-y-4">
      <Input data-testid="apikey-name-input" name="name" placeholder="Key name (e.g. CRM sync)" required className="w-72" />
      <div>
        <p className="mb-1 text-sm text-muted-foreground">Scopes (permission keys):</p>
        <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-3">
          {PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 font-mono text-xs">
              <input data-testid="apikey-scope-checkbox" type="checkbox" name={`scope:${p}`} /> {p}
            </label>
          ))}
        </div>
      </div>
      <Input
        data-testid="apikey-ipallowlist-input"
        name="ipAllowlist"
        placeholder="IP allowlist CIDRs, comma-separated (empty = any IP)"
        className="w-full"
      />
      {error && <p data-testid="apikey-error" className="text-sm text-red-400">{error}</p>}
      <Button data-testid="apikey-create-submit" disabled={loading}>
        {loading ? "Creating…" : "Create key"}
      </Button>
    </form>
  );
}

export function ApiKeyRevokeButton({ apiKeyId }: { apiKeyId: string }) {
  const router = useRouter();
  async function onRevoke() {
    await revokeApiKeyAction({ apiKeyId });
    router.refresh();
  }
  return (
    <Button data-testid="apikey-revoke-button" variant="destructive" size="sm" onClick={onRevoke}>
      Revoke
    </Button>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 22: Settings — Sessions page (device history + forced logout)

**File `src/app/(app)/settings/sessions/page.tsx`** (full content):
```tsx
import { getCurrentSession, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { RevokeAllButton, RevokeSessionButton } from "./client";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }
  const current = await getCurrentSession();
  const sessions = await db.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Your active sessions</CardTitle>
          <RevokeAllButton />
        </div>
      </CardHeader>
      <CardContent>
        <table data-testid="sessions-table" className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Device</th>
              <th className="py-2 pr-4">IP</th>
              <th className="py-2 pr-4">Last seen</th>
              <th className="py-2 pr-4" />
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} data-testid="session-row" className="border-b">
                <td className="py-2 pr-4">{s.deviceName ?? "Unknown device"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{s.ipAddress ?? "—"}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {s.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="py-2 pr-4">
                  {current?.id === s.id && (
                    <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">this device</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {current?.id !== s.id && <RevokeSessionButton sessionId={s.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
```

**File `src/app/(app)/settings/sessions/client.tsx`** (full content):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/server/actions/sessions";
import { Button } from "@/components/ui/button";

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onRevoke() {
    setError(null);
    const res = await revokeSessionAction({ sessionId });
    if (!res.ok) return setError(res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <span>
      <Button data-testid="session-revoke-button" variant="outline" size="sm" onClick={onRevoke}>
        Revoke
      </Button>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function RevokeAllButton() {
  const router = useRouter();
  async function onRevokeAll() {
    await revokeOtherSessionsAction();
    router.refresh();
  }
  return (
    <Button data-testid="sessions-revoke-all" variant="destructive" size="sm" onClick={onRevokeAll}>
      Log out all other devices
    </Button>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 23: Settings — Audit log viewer

**File `src/app/(app)/settings/audit-log/page.tsx`** (full content):
```tsx
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: { action?: string; entity?: string };
}) {
  let ctx;
  try {
    ctx = await requirePermission("audit:read");
  } catch {
    return (
      <p data-testid="audit-forbidden" className="text-sm text-red-400">
        You do not have permission to view the audit log.
      </p>
    );
  }

  const actionFilter = (searchParams.action ?? "").trim();
  const entityFilter = (searchParams.entity ?? "").trim();

  const logs = await db.auditLog.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(actionFilter ? { action: { contains: actionFilter, mode: "insensitive" } } : {}),
      ...(entityFilter ? { entity: { contains: entityFilter, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return (
    <Card>
      <CardHeader><CardTitle>Audit log (latest 100)</CardTitle></CardHeader>
      <CardContent>
        <form data-testid="audit-filter-form" method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <Input
            data-testid="audit-filter-action"
            name="action"
            placeholder="Filter by action (e.g. auth.login)"
            defaultValue={actionFilter}
            className="w-64"
          />
          <Input
            data-testid="audit-filter-entity"
            name="entity"
            placeholder="Filter by entity (e.g. ApiKey)"
            defaultValue={entityFilter}
            className="w-56"
          />
          <Button data-testid="audit-filter-submit" type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>
        <table data-testid="audit-table" className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Time (UTC)</th>
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Action</th>
              <th className="py-2 pr-4">Entity</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} data-testid="audit-row" className="border-b">
                <td className="py-2 pr-4 text-muted-foreground">
                  {l.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                </td>
                <td className="py-2 pr-4">{l.userId ? emailById.get(l.userId) ?? l.userId : "system"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{l.action}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {l.entity}
                  {l.entityId ? ` ${l.entityId.slice(0, 8)}…` : ""}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No entries.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** typecheck exit 0; build succeeds; route table includes
`/settings/members`, `/settings/security`, `/settings/api-keys`, `/settings/sessions`,
`/settings/audit-log`, `/invite/[token]`.
**If it fails:** re-copy the file named in the first error. If the error is
"'force-dynamic' is not a valid export" — remove that line only from the named file
(older Next cache); everything else stays.

---

## Step 24: Google SSO (OAuth2 + account linking via `SsoIdentity`)

Flow: `/api/auth/google/start` → Google consent → `/api/auth/google/callback` →
find `SsoIdentity(GOOGLE, sub)` → linked user; else match by email and link; else
auto-provision a new workspace (same as register). A random `state` cookie prevents
CSRF — a bad/missing state MUST return HTTP 400.

**File `src/app/api/auth/google/start/route.ts`** (full content):
```ts
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, error: "google_sso_not_configured" }, { status: 400 });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `${baseUrl}/api/auth/google/callback`);
  const state = crypto.randomUUID();
  const url = oauth2.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set("vaani_sso_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
```

**File `src/app/api/auth/google/callback/route.ts`** (full content):
```ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { google } from "googleapis";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { provisionUserWithWorkspace } from "@/lib/provision";

function baseUrl() {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const cookieState = req.cookies.get("vaani_sso_state")?.value;
  if (!state || !code || !cookieState || state !== cookieState) {
    return NextResponse.json({ ok: false, error: "invalid_state" }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, error: "google_sso_not_configured" }, { status: 400 });
  }

  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `${baseUrl()}/api/auth/google/callback`);
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
    const { data: profile } = await oauth2api.userinfo.get();
    if (!profile.id || !profile.email) throw new Error("no profile");

    const email = profile.email.toLowerCase();

    // 1) Existing SSO link?
    let identity = await db.ssoIdentity.findUnique({
      where: { provider_externalSubjectId: { provider: "GOOGLE", externalSubjectId: profile.id } },
    });
    let userId: string;
    if (identity) {
      userId = identity.userId;
    } else {
      // 2) Existing user with same email → link the identity.
      let user = await db.user.findUnique({ where: { email } });
      if (!user) {
        // 3) First login via Google → auto-provision a workspace (like register).
        const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
        const provisioned = await provisionUserWithWorkspace({
          fullName: profile.name ?? email.split("@")[0],
          email,
          passwordHash,
          businessName: `${profile.name ?? "My"}'s Workspace`,
        });
        user = provisioned.user;
      }
      identity = await db.ssoIdentity.create({
        data: { userId: user.id, provider: "GOOGLE", externalSubjectId: profile.id, email },
      });
      userId = user.id;
    }

    const membership = await db.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    await createSession(userId, membership?.workspaceId);
    if (membership) {
      await logAudit({
        workspaceId: membership.workspaceId, userId,
        action: "sso.login", entity: "User", entityId: userId,
        metadata: { provider: "GOOGLE" },
      });
    }
    return NextResponse.redirect(`${baseUrl()}/dashboard`);
  } catch (e) {
    console.error("google sso failed", e);
    return NextResponse.redirect(`${baseUrl()}/login?error=sso`);
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** confirm `googleapis@144.0.0` is installed (`npm ls googleapis`).

**Operator setup (human task, not Hermes):** Google Cloud Console → APIs & Services →
Credentials → Create OAuth client ID (Web application) → authorized redirect URI
`<APP_BASE_URL>/api/auth/google/callback` → edit the EXISTING (guide 01)
`GOOGLE_CLIENT_ID=` / `GOOGLE_CLIENT_SECRET=` lines in `.env` in place — do not
append new ones — and set `NEXT_PUBLIC_GOOGLE_SSO_ENABLED="true"`. Restart the dev
server. The "Continue with Google" button then appears on `/login`.

---

## Step 25: OIDC enterprise SSO (+ SAML OPERATOR GATE)

Generic OIDC Authorization Code flow implemented with plain `fetch` against the IdP's
discovery document — no passport, no SAML/XML parsing. Works with Keycloak, Okta,
Entra ID, Auth0, or any OIDC-compliant IdP.

Enterprise rule (differs from Google): an unknown email is NOT auto-provisioned — the
user must already exist (invited by an admin). This is deliberate: enterprise tenants
control membership.

**File `src/lib/oidc.ts`** (full content):
```ts
export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
};

export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER_URL?.replace(/\/+$/, "");
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  if (!issuer || !clientId || !clientSecret) return null;
  return { issuer, clientId, clientSecret, redirectUri: `${baseUrl}/api/auth/oidc/callback` };
}

export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const doc = (await res.json()) as Partial<OidcDiscovery>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
    throw new Error("OIDC discovery document incomplete");
  }
  return doc as OidcDiscovery;
}

export async function exchangeOidcCode(
  cfg: OidcConfig,
  discovery: OidcDiscovery,
  code: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed: HTTP ${res.status}`);
  const tokens = (await res.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("OIDC token response missing access_token");
  return tokens.access_token;
}

export async function fetchOidcUserInfo(
  discovery: OidcDiscovery,
  accessToken: string
): Promise<{ sub: string; email?: string; name?: string }> {
  const res = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OIDC userinfo failed: HTTP ${res.status}`);
  const info = (await res.json()) as { sub?: string; email?: string; name?: string };
  if (!info.sub) throw new Error("OIDC userinfo missing sub");
  return { sub: info.sub, email: info.email, name: info.name };
}
```

**File `src/app/api/auth/oidc/start/route.ts`** (full content):
```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchOidcDiscovery, getOidcConfig } from "@/lib/oidc";

export async function GET(req: NextRequest) {
  const cfg = getOidcConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "oidc_not_configured" }, { status: 400 });
  }
  try {
    const discovery = await fetchOidcDiscovery(cfg.issuer);
    const state = crypto.randomUUID();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);

    const res = NextResponse.redirect(url.toString());
    res.cookies.set("vaani_sso_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return res;
  } catch (e) {
    console.error("oidc start failed", e);
    return NextResponse.json({ ok: false, error: "oidc_discovery_failed" }, { status: 502 });
  }
}
```

**File `src/app/api/auth/oidc/callback/route.ts`** (full content):
```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { exchangeOidcCode, fetchOidcDiscovery, fetchOidcUserInfo, getOidcConfig } from "@/lib/oidc";

function baseUrl() {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const cookieState = req.cookies.get("vaani_sso_state")?.value;
  if (!state || !code || !cookieState || state !== cookieState) {
    return NextResponse.json({ ok: false, error: "invalid_state" }, { status: 400 });
  }

  const cfg = getOidcConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "oidc_not_configured" }, { status: 400 });
  }

  try {
    const discovery = await fetchOidcDiscovery(cfg.issuer);
    const accessToken = await exchangeOidcCode(cfg, discovery, code);
    const info = await fetchOidcUserInfo(discovery, accessToken);
    if (!info.email) throw new Error("IdP did not return an email claim");
    const email = info.email.toLowerCase();

    // 1) Existing SSO link?
    const identity = await db.ssoIdentity.findUnique({
      where: { provider_externalSubjectId: { provider: "OIDC", externalSubjectId: info.sub } },
    });
    let userId: string;
    if (identity) {
      userId = identity.userId;
    } else {
      // 2) Enterprise rule: user must already exist (invited). No auto-provisioning.
      const user = await db.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json(
          { ok: false, error: "no_account", message: "Ask your workspace admin to invite this email first." },
          { status: 403 }
        );
      }
      await db.ssoIdentity.create({
        data: { userId: user.id, provider: "OIDC", externalSubjectId: info.sub, email },
      });
      userId = user.id;
    }

    const membership = await db.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    await createSession(userId, membership?.workspaceId);
    if (membership) {
      await logAudit({
        workspaceId: membership.workspaceId, userId,
        action: "sso.login", entity: "User", entityId: userId,
        metadata: { provider: "OIDC", issuer: cfg.issuer },
      });
    }
    return NextResponse.redirect(`${baseUrl()}/dashboard`);
  } catch (e) {
    console.error("oidc sso failed", e);
    return NextResponse.redirect(`${baseUrl()}/login?error=sso`);
  }
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0; route table includes `/api/auth/google/start`,
`/api/auth/google/callback`, `/api/auth/oidc/start`, `/api/auth/oidc/callback`.

**Operator setup (human task):** register Vaani AI as an OIDC client at your IdP with
redirect URI `<APP_BASE_URL>/api/auth/oidc/callback`; put issuer URL + client ID/secret
into `.env`; set `NEXT_PUBLIC_OIDC_SSO_ENABLED="true"`; restart.

### SAML — OPERATOR GATE (scaffolding only, do NOT attempt a raw SAML SP)

A hand-rolled SAML Service Provider (XML signatures, metadata, cert rotation) is too
error-prone for this codebase. Spec §3.3 "enterprise SAML" is delivered through a
**managed SAML bridge** (WorkOS or Auth0) that itself speaks OIDC to us.

Note: the three scaffolding vars `SAML_PROVIDER` / `SAML_CLIENT_ID` /
`SAML_CLIENT_SECRET` are documented in guide 01's `.env.example` (blank defaults);
guide 03 Step 1 grep-guards them into both env files if missing — no further env
changes are needed here.

1. OPERATOR creates a WorkOS (or Auth0) account and configures the customer's SAML IdP
   there (WorkOS Admin Portal does the IdP-side setup).
2. WorkOS exposes an **OIDC-compatible** Authorization Code flow → the operator fills
   `.env`: `SAML_PROVIDER="workos"`, `SAML_CLIENT_ID`, `SAML_CLIENT_SECRET` and —
   because WorkOS speaks OIDC — ALSO sets `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
   `OIDC_CLIENT_SECRET` to the WorkOS-issued values and
   `NEXT_PUBLIC_OIDC_SSO_ENABLED="true"`. No code changes needed: the Step 25 OIDC
   routes handle the SAML login end-to-end.
3. VERIFY WITH PROVIDER before marking done: WorkOS dashboard shows the customer's
   IdP connection as "Active", and a test login from the customer's domain succeeds.
4. Until the operator confirms, treat "SAML SSO" as NOT delivered. The `SsoIdentity`
   provider enum already includes `SAML` for a future native implementation — do not
   write SAML XML handling code.

---

## Step 26: Demo API-key route + internal permission-check route (for tests)

`/api/v1/ping` is the reference implementation guide 08 copies for every v1 route.
`/api/internal/perm-check` exists ONLY to make permission enforcement curl-testable.

**File `src/app/api/v1/ping/route.ts`** (full content):
```ts
import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiKey } from "@/lib/apikeys";

/**
 * Demo route for the public API (guide 08 builds the real surface).
 * Auth pattern EVERY /api/v1 route uses:
 *   try { const ctx = await requireApiKey(req, "<perm>"); ...use ctx.workspaceId... }
 *   catch (e) { if (e instanceof ApiAuthError) return 401/403; throw e; }
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireApiKey(req, "calls:read");
    return NextResponse.json({
      ok: true,
      workspaceId: ctx.workspaceId,
      keyPrefix: ctx.apiKey.keyPrefix,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
```

**File `src/app/api/internal/perm-check/route.ts`** (full content):
```ts
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { isPermissionKey } from "@/lib/permissions";

/**
 * Test-only endpoint used by guide 03's scripted negative tests (and later by guide
 * 11's E2E suite) to prove permission enforcement with a real session cookie.
 *   GET /api/internal/perm-check?perm=users:write
 *   200 { ok: true, role } | 401 UNAUTHENTICATED/NO_WORKSPACE | 403 FORBIDDEN
 */
export async function GET(req: NextRequest) {
  const perm = req.nextUrl.searchParams.get("perm") ?? "users:write";
  if (!isPermissionKey(perm)) {
    return NextResponse.json({ ok: false, error: "unknown_permission" }, { status: 400 });
  }
  try {
    const ctx = await requirePermission(perm);
    return NextResponse.json({ ok: true, workspaceId: ctx.workspaceId, role: ctx.membership.role });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHENTICATED" || msg === "NO_WORKSPACE") {
      return NextResponse.json({ ok: false, error: msg }, { status: 401 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    throw e;
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 27: Test helper — mint a session cookie from the CLI

Scripted integration tests need real session cookies without a browser. This script
creates (or reuses) a user, sets their role in the `demo-clinic` workspace, creates a
DB session, and prints a valid cookie value.

**File `scripts/make-test-session.ts`** (full content):
```ts
/**
 * Usage: npx tsx scripts/make-test-session.ts <email> [role]
 *   npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER
 * Prints:  vaani_session=<token>.<jwt>   (last line)
 * TEST ONLY — never run against production data.
 */
import "../src/lib/db"; // importing the Prisma client first loads .env into process.env
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { db } from "../src/lib/db";
import type { Role } from "@prisma/client";

async function main() {
  const [email, role = "VIEWER"] = process.argv.slice(2);
  if (!email) throw new Error("usage: tsx scripts/make-test-session.ts <email> [role]");

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET missing in .env");

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      fullName: "Test User",
      passwordHash: await bcrypt.hash("test1234", 10),
    },
  });

  const workspace = await db.workspace.findUnique({ where: { slug: "demo-clinic" } });
  if (!workspace) throw new Error("demo-clinic workspace not found — run the guide 02 seed first");

  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: role as Role, grantedPermissions: [], revokedPermissions: [] },
    create: { userId: user.id, workspaceId: workspace.id, role: role as Role },
  });

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h test session
  const session = await db.session.create({
    data: {
      token: randomUUID(),
      userId: user.id,
      activeWorkspaceId: workspace.id,
      deviceName: "test-script",
      expiresAt,
    },
  });

  const jwt = await new SignJWT({ sessionId: session.id, userId: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));

  console.log(`userId=${user.id} sessionId=${session.id} role=${role}`);
  console.log(`vaani_session=${session.token}.${jwt}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

**Verify:**
```bash
cd /root/vaani-ai
npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER | tail -n 1 | cut -c1-20
```
**Expected:** `vaani_session=xxxx` (a UUID fragment after the `=`).
**If it fails:** confirm guide 02 seed ran (`docker exec vaani-db psql -U vaani -d
vaani -c 'SELECT slug FROM "Workspace";'` shows `demo-clinic`). If it errors with
`SESSION_SECRET missing in .env`, confirm `.env` exists in `/root/vaani-ai` (guide 01).

---

## Step 28: Vitest unit tests (permissions, TOTP + backup codes, API keys/CIDR)

**File `tests/permissions.test.ts`** (full content):
```ts
import { describe, expect, it } from "vitest";
import {
  hasPermission,
  isPermissionKey,
  PERMISSIONS,
  resolvePermissions,
  ROLE_PERMISSIONS,
} from "../src/lib/permissions";

describe("permission vocabulary", () => {
  it("contains the canonical domains", () => {
    for (const key of [
      "agents:read", "agents:write",
      "campaigns:read", "campaigns:write", "campaigns:launch",
      "contacts:read", "contacts:write", "contacts:import",
      "calls:read", "recordings:read", "analytics:read",
      "billing:read", "billing:write",
      "users:read", "users:write",
      "apikeys:read", "apikeys:write",
      "live:listen", "live:whisper", "live:barge",
      "settings:read", "settings:write",
    ]) {
      expect(isPermissionKey(key), key).toBe(true);
    }
  });

  it("rejects unknown keys", () => {
    expect(isPermissionKey("admin:everything")).toBe(false);
    expect(isPermissionKey("agents")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
  });
});

describe("role defaults (spec 3.2)", () => {
  it("OWNER gets every permission", () => {
    expect(new Set(ROLE_PERMISSIONS.OWNER)).toEqual(new Set(PERMISSIONS));
  });

  it("ADMIN manages agents/campaigns/users/numbers but not billing or api keys", () => {
    for (const key of ["agents:write", "campaigns:write", "users:write", "numbers:write"]) {
      expect(ROLE_PERMISSIONS.ADMIN).toContain(key);
    }
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("billing:write");
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("apikeys:write");
    expect(ROLE_PERMISSIONS.ADMIN).toContain("billing:read");
  });

  it("MANAGER gets campaigns/contacts/analytics/recordings but not users or billing", () => {
    for (const key of ["campaigns:launch", "contacts:import", "analytics:read", "recordings:read"]) {
      expect(ROLE_PERMISSIONS.MANAGER).toContain(key);
    }
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain("users:write");
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain("billing:read");
  });

  it("AGENT (supervisor) gets live listen/whisper/barge but not campaigns", () => {
    for (const key of ["live:listen", "live:whisper", "live:barge"]) {
      expect(ROLE_PERMISSIONS.AGENT).toContain(key);
    }
    expect(ROLE_PERMISSIONS.AGENT).not.toContain("campaigns:write");
  });

  it("VIEWER gets dashboards/reports only", () => {
    expect(ROLE_PERMISSIONS.VIEWER).toEqual(["analytics:read"]);
  });
});

describe("grant/revoke overrides", () => {
  const base = { grantedPermissions: [] as string[], revokedPermissions: [] as string[] };

  it("grant adds a permission the role lacks", () => {
    const resolved = resolvePermissions({ role: "VIEWER", ...base, grantedPermissions: ["calls:read"] });
    expect(resolved.has("calls:read")).toBe(true);
    expect(resolved.has("analytics:read")).toBe(true);
  });

  it("revoke removes a permission the role has", () => {
    const resolved = resolvePermissions({ role: "ADMIN", ...base, revokedPermissions: ["users:write"] });
    expect(resolved.has("users:write")).toBe(false);
    expect(resolved.has("agents:write")).toBe(true);
  });

  it("revoke wins over grant for the same key", () => {
    const resolved = resolvePermissions({
      role: "MANAGER",
      grantedPermissions: ["billing:read"],
      revokedPermissions: ["billing:read"],
    });
    expect(resolved.has("billing:read")).toBe(false);
  });

  it("ignores garbage strings in the override arrays", () => {
    const resolved = resolvePermissions({
      role: "VIEWER",
      grantedPermissions: ["not-a-permission", "calls:read"],
      revokedPermissions: ["also-garbage"],
    });
    expect(resolved.has("calls:read")).toBe(true);
    expect(resolved.size).toBe(2);
  });

  it("hasPermission composes role + overrides", () => {
    expect(hasPermission({ role: "AGENT", ...base }, "live:barge")).toBe(true);
    expect(hasPermission({ role: "AGENT", ...base }, "campaigns:write")).toBe(false);
    expect(
      hasPermission({ role: "AGENT", grantedPermissions: ["campaigns:write"], revokedPermissions: [] }, "campaigns:write")
    ).toBe(true);
  });
});
```

**File `tests/totp.test.ts`** (full content):
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticator } from "otplib";
import {
  findMatchingBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  normalizeBackupCode,
  totpKeyUri,
  verifyTotpCode,
} from "../src/lib/totp";

afterEach(() => {
  vi.useRealTimers();
});

describe("TOTP secret + key URI", () => {
  it("generates a base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    expect(/^[A-Z2-7]+=*$/.test(secret)).toBe(true);
  });

  it("builds an otpauth:// URI with the Vaani AI issuer", () => {
    const uri = totpKeyUri("demo@vaani.ai", "JBSWY3DPEHPK3PXP");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Vaani%20AI");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });
});

describe("TOTP verify round-trip (mocked time)", () => {
  it("accepts the current code and rejects it 10 minutes later", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret); // code valid "now"
    expect(verifyTotpCode(secret, code)).toBe(true);

    vi.setSystemTime(new Date("2024-06-01T12:10:00Z")); // far beyond ±1 window
    expect(verifyTotpCode(secret, code)).toBe(false);
  });

  it("rejects malformed codes deterministically", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "abcdef")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false);
    expect(verifyTotpCode(secret, "")).toBe(false);
  });

  it("rejects a code generated for a different secret", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    const other = authenticator.generate(generateTotpSecret());
    expect(verifyTotpCode(generateTotpSecret(), other)).toBe(false);
  });
});

describe("backup codes", () => {
  it("generates 10 unique human-readable codes", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it("hash is deterministic and normalization ignores case/dashes", () => {
    expect(hashBackupCode("K7F2-9QX4")).toBe(hashBackupCode("k7f2-9qx4"));
    expect(hashBackupCode("k7f29qx4")).toBe(hashBackupCode("k7f2-9qx4"));
    expect(normalizeBackupCode(" K7F2-9QX4 ")).toBe("k7f29qx4");
  });

  it("matches an unused code exactly once (consume-once)", () => {
    const [a, b] = generateBackupCodes(2);
    const stored = [
      { id: "row-a", codeHash: hashBackupCode(a), usedAt: null as Date | null },
      { id: "row-b", codeHash: hashBackupCode(b), usedAt: new Date() }, // already used
    ];
    expect(findMatchingBackupCode(a, stored)).toBe("row-a");
    // Simulate consumption:
    stored[0].usedAt = new Date();
    expect(findMatchingBackupCode(a, stored)).toBeNull();
    // Used code never matches again; wrong code never matches.
    expect(findMatchingBackupCode(b, stored)).toBeNull();
    expect(findMatchingBackupCode("zzzz-zzzz", stored)).toBeNull();
  });
});
```

**File `tests/apikeys.test.ts`** (full content):
```ts
import { describe, expect, it } from "vitest";
import {
  apiKeyPrefix,
  generateApiKeySecret,
  hashApiKey,
  ipAllowed,
  ipMatchesCidr,
  ipToInt,
  isValidCidr,
} from "../src/lib/apikeys";

describe("api key secrets", () => {
  it("generates vaani_live_ keys with 48 hex chars", () => {
    const key = generateApiKeySecret();
    expect(key).toMatch(/^vaani_live_[0-9a-f]{48}$/);
    expect(generateApiKeySecret()).not.toBe(key); // unique
  });

  it("hashes to 64-char hex, deterministically", () => {
    const hash = hashApiKey("vaani_live_abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("vaani_live_abc")).toBe(hash);
    expect(hashApiKey("vaani_live_abd")).not.toBe(hash);
  });

  it("matches the guide-02 seeded demo key hash", () => {
    // The seed stores sha256("demo-api-key-do-not-use") — proves our hashing lines up.
    expect(hashApiKey("demo-api-key-do-not-use")).toBe(
      "e46ea83ec368dc44797a4b7da96ad92963dae141d417cd89fdb211b488422b0f"
    );
  });

  it("prefix is the display-safe first 15 chars", () => {
    const key = generateApiKeySecret();
    expect(apiKeyPrefix(key)).toBe(key.slice(0, 15));
    expect(apiKeyPrefix(key).startsWith("vaani_live_")).toBe(true);
  });
});

describe("IPv4 parsing", () => {
  it("parses valid IPs", () => {
    expect(ipToInt("0.0.0.0")).toBe(0);
    expect(ipToInt("255.255.255.255")).toBe(4294967295);
    expect(ipToInt("192.168.1.1")).toBe(0xc0a80101);
  });

  it("rejects invalid IPs", () => {
    expect(ipToInt("256.1.1.1")).toBeNull();
    expect(ipToInt("1.2.3")).toBeNull();
    expect(ipToInt("1.2.3.4.5")).toBeNull();
    expect(ipToInt("abc")).toBeNull();
    expect(ipToInt("::1")).toBeNull(); // IPv6 not supported
  });
});

describe("CIDR matching", () => {
  it("validates CIDR syntax", () => {
    expect(isValidCidr("203.0.113.10/32")).toBe(true);
    expect(isValidCidr("10.0.0.0/8")).toBe(true);
    expect(isValidCidr("1.2.3.4")).toBe(true); // bare IP = /32
    expect(isValidCidr("1.2.3.4/33")).toBe(false);
    expect(isValidCidr("999.1.1.1/8")).toBe(false);
    expect(isValidCidr("1.2.3.4/x")).toBe(false);
  });

  it("matches exact IPs and subnets", () => {
    expect(ipMatchesCidr("203.0.113.10", "203.0.113.10/32")).toBe(true);
    expect(ipMatchesCidr("203.0.113.10", "203.0.113.10")).toBe(true);
    expect(ipMatchesCidr("203.0.113.11", "203.0.113.10/32")).toBe(false);
    expect(ipMatchesCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipMatchesCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipMatchesCidr("192.168.1.55", "192.168.1.0/24")).toBe(true);
    expect(ipMatchesCidr("192.168.2.1", "192.168.1.0/24")).toBe(false);
  });

  it("/0 matches everything; invalid input never matches", () => {
    expect(ipMatchesCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(ipMatchesCidr("not-an-ip", "0.0.0.0/0")).toBe(false);
    expect(ipMatchesCidr("8.8.8.8", "bad-cidr")).toBe(false);
  });
});

describe("ipAllowed (allowlist semantics)", () => {
  it("empty allowlist allows any IP", () => {
    expect(ipAllowed("1.2.3.4", [])).toBe(true);
  });

  it("non-empty allowlist requires at least one match", () => {
    const list = ["203.0.113.0/24", "198.51.100.7/32"];
    expect(ipAllowed("203.0.113.99", list)).toBe(true);
    expect(ipAllowed("198.51.100.7", list)).toBe(true);
    expect(ipAllowed("198.51.100.8", list)).toBe(false);
    expect(ipAllowed("127.0.0.1", list)).toBe(false);
  });
});
```

Run all unit tests:
```bash
cd /root/vaani-ai && npx vitest run tests/permissions.test.ts tests/totp.test.ts tests/apikeys.test.ts
```
**Expected:** 3 files pass; summary shows `Test Files  3 passed (3)` and all tests
green (≈ 24 tests).
**If it fails:** read the first failing assertion name.
(1) `totp … mocked time` fails → confirm `otplib@12.0.1` is installed
(`npm ls otplib`); re-run. (2) seeded demo key hash mismatch → do NOT edit the test;
report the hash you see (it means guide 02 seed changed — STOP and report). Anything
else: re-copy the named test file exactly.

---

## Step 29: Integration tests (positive + negative — security invariants, do not skip)

Start the dev server:
```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15
```

### 29a — Positive flows

```bash
# A1. Protected route redirects when logged out
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard
```
**Expected:** `307`

```bash
# A2. Login page renders
curl -s http://localhost:3000/login | grep -o "Sign in to" | head -n 1
```
**Expected:** `Sign in to`

```bash
# A3. Public API works with the guide-02 seeded demo key (scopes: calls:read, contacts:read)
curl -s -H "Authorization: Bearer demo-api-key-do-not-use" http://localhost:3000/api/v1/ping
```
**Expected:** `{"ok":true,"workspaceId":"...","keyPrefix":"vaani_de"}` (workspaceId varies).

```bash
# A4. lastUsedAt was updated by A3
docker exec vaani-db psql -U vaani -d vaani -t -c 'SELECT "lastUsedAt" IS NOT NULL FROM "ApiKey" WHERE "keyPrefix"='"'"'vaani_de'"'"';'
```
**Expected:** `t`

```bash
# A5. A VIEWER session passes a permission it HAS (analytics:read)
COOKIE=$(npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER | tail -n 1)
curl -s -H "Cookie: $COOKIE" "http://localhost:3000/api/internal/perm-check?perm=analytics:read"
```
**Expected:** `{"ok":true,"workspaceId":"...","role":"VIEWER"}`

### 29b — Negative flows (each MUST fail exactly as stated)

```bash
# N1. Forged cookie must NOT authenticate
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: vaani_session=fake.fake" http://localhost:3000/dashboard
```
**Expected:** `307`

```bash
# N2. Missing API key → 401
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/v1/ping
```
**Expected:** `{"ok":false,"error":"missing_api_key"}` then `401`

```bash
# N3. Unknown API key → 401
curl -s -w "\n%{http_code}\n" -H "Authorization: Bearer vaani_live_000000000000000000000000000000000000000000000000" http://localhost:3000/api/v1/ping
```
**Expected:** `{"ok":false,"error":"invalid_api_key"}` then `401`

```bash
# N4. Wrong role → 403 (VIEWER asking for users:write)
COOKIE=$(npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER | tail -n 1)
curl -s -w "\n%{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/api/internal/perm-check?perm=users:write"
```
**Expected:** `{"ok":false,"error":"FORBIDDEN"}` then `403`

```bash
# N5. Grant override unlocks, revoke override blocks (permission matrix end-to-end)
COOKIE=$(npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER | tail -n 1)
SESSION_USER=$(npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER | head -n 1 | cut -d' ' -f1 | cut -d= -f2)
docker exec vaani-db psql -U vaani -d vaani -c "UPDATE \"Membership\" SET \"grantedPermissions\"='{users:read}' WHERE \"userId\"='$SESSION_USER';"
curl -s -w "\n%{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/api/internal/perm-check?perm=users:read"
docker exec vaani-db psql -U vaani -d vaani -c "UPDATE \"Membership\" SET \"grantedPermissions\"='{}', \"revokedPermissions\"='{analytics:read}' WHERE \"userId\"='$SESSION_USER';"
curl -s -w "\n%{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/api/internal/perm-check?perm=analytics:read"
docker exec vaani-db psql -U vaani -d vaani -c "UPDATE \"Membership\" SET \"revokedPermissions\"='{}' WHERE \"userId\"='$SESSION_USER';"
```
**Expected:** first curl `{"ok":true,...,"role":"VIEWER"}` + `200`; second curl
`{"ok":false,"error":"FORBIDDEN"}` + `403`.

```bash
# N6. Revoked session → redirect (forced logout enforced in requireUser)
COOKIE=$(npx tsx scripts/make-test-session.ts revoke@test.dev AGENT | tail -n 1)
docker exec vaani-db psql -U vaani -d vaani -c "UPDATE \"Session\" SET \"revokedAt\"=now() WHERE \"deviceName\"='test-script' AND \"revokedAt\" IS NULL;"
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: $COOKIE" http://localhost:3000/dashboard
```
**Expected:** `307`

```bash
# N7. Valid key, wrong scope → 403
HASH=$(printf 'scope-test-key' | sha256sum | cut -d' ' -f1)
docker exec vaani-db psql -U vaani -d vaani -c "INSERT INTO \"ApiKey\" (id, \"workspaceId\", name, \"keyPrefix\", \"keyHash\", scopes, \"ipAllowlist\") SELECT 'test-scope-key-1', id, 'scope test', 'vaani_sc', '$HASH', '{contacts:read}', '{}' FROM \"Workspace\" WHERE slug='demo-clinic';"
curl -s -w "\n%{http_code}\n" -H "Authorization: Bearer scope-test-key" http://localhost:3000/api/v1/ping
```
**Expected:** `{"ok":false,"error":"insufficient_scope"}` then `403`

```bash
# N8. Valid key + scope, but caller IP not in allowlist → 403
HASH2=$(printf 'iplist-test-key' | sha256sum | cut -d' ' -f1)
docker exec vaani-db psql -U vaani -d vaani -c "INSERT INTO \"ApiKey\" (id, \"workspaceId\", name, \"keyPrefix\", \"keyHash\", scopes, \"ipAllowlist\") SELECT 'test-iplist-key-1', id, 'iplist test', 'vaani_ip', '$HASH2', '{calls:read}', '{203.0.113.0/24}' FROM \"Workspace\" WHERE slug='demo-clinic';"
curl -s -w "\n%{http_code}\n" -H "Authorization: Bearer iplist-test-key" http://localhost:3000/api/v1/ping
docker exec vaani-db psql -U vaani -d vaani -c "DELETE FROM \"ApiKey\" WHERE id IN ('test-scope-key-1','test-iplist-key-1');"
```
**Expected:** `{"ok":false,"error":"ip_not_allowed"}` then `403` (request came from
127.0.0.1, which is outside 203.0.113.0/24). The DELETE cleans up both temp keys.

```bash
# N9. SSO callback with bad/missing state → 400 (CSRF protection)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/auth/google/callback?state=bogus&code=x"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/auth/oidc/callback?state=bogus&code=x"
```
**Expected:** `400` then `400`

```bash
# N10. SSO start routes refuse to run unconfigured → 400 (env vars empty in dev)
curl -s -w "\n%{http_code}\n" -o /dev/null http://localhost:3000/api/auth/google/start
curl -s -w "\n%{http_code}\n" -o /dev/null http://localhost:3000/api/auth/oidc/start
```
**Expected:** `400` then `400`

### 29c — Browser/operator flows (Hermes cannot click; the OPERATOR verifies, Hermes records)

Use SSH port-forward (`ssh -L 3000:localhost:3000 root@<VPS_IP>`) and open
`http://localhost:3000` on your laptop:

1. **Register → dashboard:** `/register` a new business → lands on `/dashboard`,
   business name, `₹1,000.00` wallet, role `OWNER`.
2. **Enable 2FA → login with 2FA:** dashboard → Settings → Security (2FA) →
   `Enable 2FA` → scan QR with any authenticator app → enter 6-digit code → backup
   codes appear (save them) → Sign out → Sign in with email+password → 2FA code
   screen appears → enter current code → dashboard. Sign out, sign in again, click
   "Use a backup code instead" → enter one saved code → dashboard; re-using the SAME
   backup code on the next login MUST fail with "Invalid code."
3. **Invite → accept:** as OWNER: Settings → Members → create invite for a second
   email you control (role VIEWER) → copy the shown link → in an incognito window:
   `/register` that email (any business name) → open the invite link → Accept invite →
   dashboard now shows `Demo Dental Clinic` (or your first workspace) with role VIEWER.
4. **Sessions:** Settings → Sessions shows your current device; sign in from an
   incognito window too, then in the main window click the row's `Revoke` → the
   incognito window's next page load lands on `/login`. `Log out all other devices`
   revokes everything except the current window.
5. **Audit log:** Settings → Audit log shows `workspace.create`, `auth.login`,
   `member.invite`, `member.invite_accept`, `totp.enable`, `session.revoke` entries;
   the action filter `auth.login` narrows the table.
6. **Demo login:** sign in as `demo@vaani.ai` / `demo1234` → dashboard shows
   `Demo Dental Clinic`.

Stop the dev server after tests: `pkill -f "next dev" || true`.

**If any 29a/29b check fails:** re-run it once (dev server cold-start can 500 on first
hit). If it still fails, STOP and report the command + full output.

---

## Step 30: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 03: auth + RBAC permission matrix, audit log, Google/OIDC SSO, TOTP 2FA, API keys, sessions, invites"
```

---

## Acceptance Checklist

- [ ] Step 1 deps pinned: `otplib@12.0.1`, `qrcode@1.5.4`, `@types/qrcode@1.5.5`,
      `googleapis@144.0.0`; `.env` + `.env.example` contain the SSO/SAML block
- [ ] Step 2 migration `backup_codes` applied; `\d "BackupCode"` shows codeHash+usedAt
- [ ] `/dashboard` without cookie → 307 to `/login`
- [ ] Register creates: user + workspace + OWNER membership + wallet ₹1,000 trial +
      14-day starter subscription
- [ ] Login with `demo@vaani.ai / demo1234` shows demo workspace dashboard
- [ ] Logout returns to `/login` and cookie is cleared
- [ ] Permission matrix: role defaults + grant/revoke overrides enforced
      (29a A5 + 29b N4/N5 green)
- [ ] Members page: role select works, last-owner protection, permission overrides save
- [ ] Audit log: `auth.login`, `auth.logout`, `member.*`, `apikey.*`, `totp.*`,
      `session.*`, `sso.login` entries appear; filters work
- [ ] Google SSO routes return 400 unconfigured / bad state; operator-configured login
      links `SsoIdentity` (or auto-provisions) — or explicitly pending operator setup
- [ ] OIDC routes executable; SAML documented as OPERATOR GATE only (no SAML code)
- [ ] TOTP 2FA: enroll (QR+confirm), login second step, backup codes single-use,
      disable requires password
- [ ] API keys: created once-shown, sha256-stored, scoped, IP-allowlisted, revocable;
      29a A3/A4 + 29b N2/N3/N7/N8 green
- [ ] Sessions page lists devices; revoke one + revoke-all work; revoked session → 307
      (29b N6 green)
- [ ] Invites: create → link shown → accept joins workspace with invited role;
      wrong-email accept fails
- [ ] Vitest: `tests/permissions.test.ts`, `tests/totp.test.ts`, `tests/apikeys.test.ts`
      all green (plus guide 02's `tests/money.test.ts` still green)
- [ ] `npm run typecheck` and `npm run build` both exit 0
- [ ] Git commit `phase 03: ...` exists

## FINAL REPORT format

```
STEP 1..30: PASS/FAIL — <one line of evidence each>
ACCEPTANCE: n/18 checked
NOTES: <deviations, operator-pending items (Google/OIDC/SAML config)>
```
