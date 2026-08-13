# 01 — Hardening & Security

> **Goal:** Convert Vaani AI from "works in staging" to **survives the public
> internet**. This document covers authentication, authorization, secrets,
> network, data protection, and India-specific compliance (DPDP Act, TRAI).

---

## 1. Authentication & Session Security

### Current state
- Custom auth: `bcryptjs` (password hashing), `jose` (JWT in httpOnly cookie), `otplib` (TOTP 2FA).
- Google SSO via `googleapis`.
- Session table with token, `expiresAt`, `revokedAt`.

### Hardening checklist

| # | Item | Priority | Status |
|---|---|---|---|
| 1.1 | Enforce **bcrypt cost factor ≥ 12** (currently default 10) | High | ☐ |
| 1.2 | Add **argon2id** as the preferred hasher with bcrypt fallback for legacy hashes | High | ☐ |
| 1.3 | Rotate **JWT signing key** every 90 days; support 2 active keys (old verifies, new signs) | High | ☐ |
| 1.4 | Set cookie `SameSite=Lax`, `Secure=true`, `HttpOnly=true` in production | High | ☐ |
| 1.5 | Implement **device binding** — bind session token to a hash of User-Agent + IP prefix | Medium | ☐ |
| 1.6 | Add **failed-login lockout**: 5 attempts → 15-min lock + email alert | High | ☐ |
| 1.7 | Require **TOTP 2FA** for OWNER and ADMIN roles (RBAC-gated enforcement) | High | ☐ |
| 1.8 | Generate and display **backup codes** on 2FA enable (schema `BackupCode` exists) | Medium | ☐ |
| 1.9 | Add **session anomaly detection** — new geo + new device → email challenge | Medium | ☐ |
| 1.10 | Enforce **password policy**: ≥ 12 chars, ≥ 1 symbol, breach-list check (`haveibeenpwned` k-anonymity API) | High | ☐ |

### Implementation: bcrypt cost + lockout

```ts
// src/lib/auth.ts (extend existing)
import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}
```

Add a `failedLoginAttempts Int @default(0)` and `lockedUntil DateTime?` to the `User` model.

### JWT key rotation

Store signing keys in environment with a versioned scheme:

```env
# .env (production)
JWT_SIGNING_KEY_V2="-----BEGIN PRIVATE KEY-----..."
JWT_SIGNING_KEY_V1="-----BEGIN PRIVATE KEY-----..."   # still verifies, no longer signs
JWT_ACTIVE_KEY_VERSION="V2"
```

```ts
// src/lib/auth.ts
const KEYS = { V1: process.env.JWT_SIGNING_KEY_V1!, V2: process.env.JWT_SIGNING_KEY_V2! };
const ACTIVE = process.env.JWT_ACTIVE_KEY_VERSION as "V1" | "V2";

export function signJwt(payload: JWTPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: ACTIVE })
    .sign(KEYS[ACTIVE]);
}

export function verifyJwt(token: string) {
  // Decode header to get kid, then verify with the matching key
}
```

---

## 2. Authorization (RBAC + Permissions)

### Current state
- Roles: `OWNER, ADMIN, MANAGER, AGENT, VIEWER`.
- Granular overrides: `Membership.grantedPermissions` / `revokedPermissions` (string arrays).

### Hardening checklist

| # | Item | Priority |
|---|---|---|
| 2.1 | Add a **central permission registry** in `src/lib/permissions.ts` (enum of all keys) | High |
| 2.2 | Wrap every server action with `requirePermission("feature:action")` | High |
| 2.3 | Add **row-level security checks** — verify resource belongs to caller's workspace | Critical |
| 2.4 | Add a **permission test suite** — assert denial for every forbidden role×action | High |
| 2.5 | Log all permission denials to `AuditLog` with `action="authz.deny"` | Medium |

### Permission registry pattern

```ts
// src/lib/permissions.ts (extend existing)
export const PERMISSIONS = {
  // Agents
  AGENTS_READ: "agents:read",
  AGENTS_WRITE: "agents:write",
  AGENTS_PUBLISH: "agents:publish",
  // CRM (new)
  DEALS_READ: "deals:read",
  DEALS_WRITE: "deals:write",
  DEALS_DELETE: "deals:delete",
  // Billing
  BILLING_READ: "billing:read",
  BILLING_WRITE: "billing:write",
  // ... etc
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function requirePermission(perm: Permission, workspaceId: string, userId: string) {
  // load Membership, check role defaults + grants/revokes, throw 403 on deny
}
```

### Row-level security (critical)

**Every** query that reads or mutates tenant data **must** include `where: { workspaceId }`.

```ts
// ❌ DANGEROUS — can leak across tenants
const deal = await prisma.deal.findUnique({ where: { id } });

// ✅ SAFE
const deal = await prisma.deal.findFirst({
  where: { id, workspaceId: ctx.workspaceId },
});
```

Add an ESLint custom rule or Prisma middleware to enforce this:

```ts
// prisma/middleware-tenant-guard.ts
prisma.$use(async (params, next) => {
  const tenantScoped = ["deal", "contact", "call", "agent", "campaign"];
  if (tenantScoped.includes(params.model || "") && params.action === "findUnique") {
    // findUnique bypasses where — convert to findFirst with workspaceId
    throw new Error("Use findFirst with workspaceId, not findUnique, on tenant models");
  }
  return next(params);
});
```

---

## 3. Secrets Management

### Current state
Secrets in `.env` files (gitignored). Acceptable for dev, **not** for production.

### Production secrets architecture

```
┌──────────────┐    pulls at boot    ┌─────────────────┐
│  Vault / SSM │ ◀────────────────── │  Next.js server │
│  (source of  │                     │  (process)      │
│   truth)     │ ──── rotate ──────▶ │                 │
└──────────────┘                     └─────────────────┘
```

| Secret | Storage | Rotation |
|---|---|---|
| `DATABASE_URL` | Docker secret / Vault | 90 days (DB password) |
| `JWT_SIGNING_KEY_V2` | Vault | 90 days |
| `RAZORPAY_KEY_SECRET` | Vault | 180 days |
| `MINIO_ROOT_PASSWORD` | Vault | 90 days |
| `REDIS_PASSWORD` | Vault | 180 days |
| `OPENROUTER_API_KEY` | Vault | On-demand |
| `SARVAM_API_KEY` | Vault | On-demand |
| `VOBIZ_API_TOKEN` | Vault | On-demand |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Vault | On-demand |
| `SMTP_PASSWORD` | Vault | 180 days |

### Checklist

- [ ] Never commit `.env` to git (enforce with `.gitignore` + pre-commit hook `git-secrets`).
- [ ] Use **Docker secrets** (files mounted at `/run/secrets/`) instead of env vars in prod.
- [ ] Add a `/health/secrets` endpoint that verifies all required secrets are non-empty at boot (returns 500 if missing).
- [ ] Set up **Vault auto-rotation** or AWS SSM Parameter Store rotation for DB/JWT/MinIO.
- [ ] Restrict secret access via IAM — only the app's service account can read.

---

## 4. Network & API Hardening

### 4.1 Rate limiting (expand existing `src/lib/ratelimit.ts`)

The codebase has a `ratelimit.ts`. Expand it to cover all sensitive endpoints:

| Endpoint group | Limit | Window | Key |
|---|---|---|---|
| `/api/auth/login` | 10 | per minute | IP |
| `/api/auth/register` | 3 | per minute | IP |
| `/api/auth/totp/verify` | 5 | per minute | IP + email |
| `/api/webhooks/*` (incoming) | 60 | per minute | workspace + signature |
| `/api/v1/*` (public API) | per plan | — | API key |
| All other authenticated | 100 | per minute | userId |

Use a **sliding window** via Redis:

```ts
// src/lib/ratelimit.ts (extend)
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL);

export async function rateLimit(key: string, limit: number, windowSec: number) {
  const now = Date.now();
  const bucket = `rl:${key}`;
  const pipe = redis.pipeline();
  pipe.zremrangebyscore(bucket, 0, now - windowSec * 1000);
  pipe.zadd(bucket, now, `${now}:${Math.random()}`);
  pipe.zcard(bucket);
  pipe.expire(bucket, windowSec);
  const [, , count] = await pipe.exec();
  return (count as number) <= limit;
}
```

### 4.2 CSRF protection

Next.js Server Actions have built-in origin checks. For REST API routes, add a
double-submit cookie:

```ts
// src/middleware.ts (extend)
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  // Set CSRF token cookie on first visit
  const res = NextResponse.next();
  if (!req.cookies.get("csrf-token")) {
    res.cookies.set("csrf-token", crypto.randomUUID(), {
      httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    });
  }
  // For mutating requests, verify header matches cookie
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const headerToken = req.headers.get("x-csrf-token");
    const cookieToken = req.cookies.get("csrf-token");
    if (headerToken !== cookieToken) {
      return new NextResponse("CSRF token mismatch", { status: 403 });
    }
  }
  return res;
}
```

### 4.3 Security headers

Add via `next.config.mjs`:

```js
// vaani-ai/next.config.mjs
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss:; font-src 'self' data:;" },
];

export default {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
```

### 4.4 Input validation

All API inputs **must** pass through Zod schemas. No exceptions.

```ts
// Example pattern for every route
const schema = z.object({ name: z.string().min(1).max(100), phone: z.string().regex(/^\+\d{10,15}$/) });
const parsed = schema.safeParse(await req.json());
if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
```

---

## 5. Data Protection & Privacy

### 5.1 PII redaction (expand existing `src/lib/pii.ts`)

The codebase has a `pii.ts` lib. Ensure it runs on:

- [ ] All transcripts before storage (`Call.transcript`, `TranscriptEntry.text`).
- [ ] All LLM tool-call payloads (`CRM_WRITE`, `SMS`).
- [ ] All webhook payloads before delivery.
- [ ] All log lines (structured logging must scrub PII).

Patterns to redact (Indian context):

```ts
// src/lib/pii.ts (extend)
const PII_PATTERNS = [
  { name: "aadhaar", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, replacement: "[AADHAAR]" },
  { name: "pan", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, replacement: "[PAN]" },
  { name: "card", re: /\b(?:\d[ -]*?){13,16}\b/g, replacement: "[CARD]" },
  { name: "cvv", re: /\b\d{3,4}\b(?=\s|$)/g, replacement: "[CVV]" }, // context-aware
  { name: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: "[EMAIL]" },
  { name: "phone", re: /\+91[\d\s-]{10,}/g, replacement: "[PHONE]" },
  { name: "otp", re: /\b\d{4,6}\b/g, replacement: "[OTP]" }, // context-aware
];
```

### 5.2 Encryption at rest

| Data | Method |
|---|---|
| Database (PostgreSQL) | TDE via `pgcrypto` for PII columns; full-disk encryption on VPS |
| Recordings (MinIO) | Server-side encryption (SSE-S3) with a per-workspace key |
| Backups | `gpg`-encrypted before upload to off-site storage |
| Secrets | Vault / SSM (see §3) |

### 5.3 DPDP Act compliance (India)

The **Digital Personal Data Protection Act, 2023** requires:

- [ ] **Consent banner** at registration — explicit opt-in for data processing.
- [ ] **Data subject rights endpoints**: export (existing `GdprRequest` type=EXPORT), erasure (type=ERASURE).
- [ ] **Retention policies** (existing `RetentionPolicy` model) — auto-delete after configured days.
- [ ] **Data processing notice** in T&Cs — what data, why, who sees it.
- [ ] **Breach notification** runbook — notify users within 72 hours of a breach.

### 5.4 TRAI compliance (telephony)

- [ ] DNC scrubbing before every outbound dial (existing `DncEntry` model).
- [ ] Calling window enforcement (existing `Campaign.callingWindowStart/End`).
- [ ] DLT template registration for SMS/WhatsApp (existing `dltTemplateId`).
- [ ] Recording disclosure played at call start (existing `recordingDisclosureText`).

---

## 6. Dependency Security

### Checklist

- [ ] Run `npm audit --omit=dev` in CI; fail build on `high` or `critical`.
- [ ] Enable **Dependabot** or **Snyk** for automated PRs.
- [ ] Pin all dependencies to exact versions (already done — see `package.json`).
- [ ] Add **Snyk Code** or **Semgrep** for SAST in CI.
- [ ] Scan Docker images with **Trivy** before pushing.

```yaml
# .github/workflows/security.yml (new)
name: Security
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd vaani-ai && npm ci
      - run: cd vaani-ai && npm audit --omit=dev --audit-level=high
      - uses: aquasecurity/trivy-action@master
        with: { image-ref: vaani-ai:latest, severity: CRITICAL,HIGH }
      - uses: returntocorp/semgrep-action@v1
```

---

## 7. Security audit log (expand existing)

The `AuditLog` model exists. Expand coverage to log **all** of:

| Category | Actions to log |
|---|---|
| Auth | login, logout, failed-login, password-change, 2fa-enable, 2fa-disable, session-revoke |
| Authz | role-change, permission-grant, permission-revoke |
| Data | export, bulk-delete, gdpr-request |
| Billing | wallet-topup, plan-change, invoice-download, refund |
| Agents | create, publish, archive, version-rollback |
| Campaigns | create, start, pause, stop |
| Integrations | connect, disconnect, sync |
| Settings | api-key-create, api-key-revoke, webhook-create, invite-send |

Add a helper:

```ts
// src/lib/audit.ts (extend)
export async function audit(params: {
  workspaceId: string; userId?: string; action: string; entity: string; entityId?: string; metadata?: any;
}) {
  await prisma.auditLog.create({ data: params });
}
```

---

## 8. Penetration test checklist

Before launch, run (or commission) a penetration test covering:

- [ ] OWASP Top 10 (2021): injection, broken auth, sensitive data, XXE, broken access, misconfig, XSS, insecure deserialization, vulnerable components, SSRF.
- [ ] Multi-tenancy isolation test: create 2 workspaces, verify no cross-reads via API or IDOR.
- [ ] JWT tampering / algorithm confusion.
- [ ] SSRF via webhook URL field.
- [ ] Rate-limit bypass via header rotation.
- [ ] File upload exploits (knowledge PDFs — check magic bytes, not just extension).

---

## Next

→ [02 — Observability & Monitoring](02-observability-and-monitoring.md)