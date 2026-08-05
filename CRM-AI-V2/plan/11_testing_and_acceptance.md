# 11 — Testing & Final Acceptance

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/11_testing_and_acceptance.md` exactly. This is the quality gate:
> create the test files EXACTLY as shown, make the whole suite green WITHOUT weakening
> assertions, install Playwright and make the E2E suite green, run the smoke script,
> and walk the acceptance matrix. If something fails, fix the CODE (never the test,
> unless the test contradicts a previous guide — then report the contradiction).
> End with the FINAL REPORT.
> ---

---

## Goal

Prove v1 works against EVERY section of the product spec (readme.md):

1. **Master unit-test run** — one `npm test` covering all 49 Vitest files
   (381 test cases) from guides 02–10, plus the 33-check Prisma schema smoke script.
2. **Playwright E2E suite** — browser-level proof of every critical user flow
   (auth + 2FA, agent lifecycle, knowledge base, onboarding, live ops, campaigns,
   opt-out, billing, analytics, webhooks, GDPR, branding, KYC, status page).
3. **`scripts/smoke-test.sh`** — black-box HTTP checks against any running instance.
4. **Tenant-isolation audit** — grep proof + a scripted cross-tenant API test.
5. **Golden Path** — the v1 definition of done, end to end.
6. **Live-call test scripts** — real-phone behavior scripts (also your sales demo).
7. **Performance & robustness spot-checks** — webhook burst, build size, E2E runtime.
8. **The honest v2 backlog** — every OPERATOR GATE from guides 03–12, tracked.

**Time estimate:** 4–6 hours. **Prerequisites:** guides 01–10 green (guide 12 comes
after; Steps 3/6/7 are re-run against production inside guide 12).

**Environment assumed by this guide (dev):** `npm run dev` on :3000, worker running
(`npm run worker`) with `CAMPAIGN_DRY_RUN=true`, `WHATSAPP_DRY_RUN=true`,
`QA_DRY_RUN=true`, Docker infra up (db/redis/minio), guide 02 seed applied
(demo login `demo@vaani.ai` / `demo1234`, workspace slug `demo-clinic`).

---

## Step 1: Master unit-test run (Vitest)

### 1a. Widen the vitest include (one-time consistency fix — do NOT skip)

Guide 06 Step 0 created `vitest.config.ts` with the `@/` alias and
`include: ["tests/**/*.test.ts"]`. Guide 04's three suites live under `src/lib/`,
so a bare `npm test` would silently skip them. Overwrite the config so `npm test`
runs EVERYTHING (the `@/` alias and all other settings are unchanged):

**File `vitest.config.ts`** (full content — overwrite):

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // tests/** = guides 02,03,05,06,07,08,09,10 suites
    // src/**   = guide 04 suites (src/lib/dograh.test.ts, dograhWebhook, vobiz)
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest list 2>/dev/null | grep -c ".test.ts"
```
**Expected:** `50` (or `51` lines if your vitest version prints a header line —
count only lines ending in `.test.ts`). **If it fails:** re-copy the config above
exactly; confirm no stray `vitest.config.mts`/`vitest.workspace.ts` exists
(`ls vitest*`). One retry, then STOP and report.

### 1b. Run the entire suite

```bash
cd /root/vaani-ai && npm test 2>&1 | tail -n 12
```
**Expected:** exit 0. The summary shows **`Test Files  50 passed (50)`** and
**`Tests  381 passed (381)`**. (Vitest counts are the source of truth — if your
counts differ, use the per-suite table below to find which file is missing/failing.)

**Per-suite inventory (file → owning guide → test count):**

| Test file | Guide | Tests |
|---|---|---|
| `tests/money.test.ts` | 02 | 9 |
| `tests/permissions.test.ts` | 03 | 12 |
| `tests/totp.test.ts` | 03 | 8 |
| `tests/apikeys.test.ts` | 03 | 11 |
| `src/lib/dograh.test.ts` | 04 | 17 |
| `src/lib/dograhWebhook.test.ts` | 04 | 9 |
| `src/lib/vobiz.test.ts` | 04 | 4 |
| `tests/workflow-builder.test.ts` | 05 | 12 |
| `tests/versions.test.ts` | 05 | 4 |
| `tests/ab.test.ts` | 05 | 6 |
| `tests/voices.test.ts` | 05 | 6 |
| `tests/tool-configs.test.ts` | 05 | 6 |
| `tests/crm-mapping.test.ts` | 05 | 5 |
| `tests/hubspot.test.ts` | 05 | 4 |
| `src/lib/vobiz.sms.test.ts` | 05 | 4 |
| `tests/greeting.test.ts` | 06 | 16 |
| `tests/spamFilter.test.ts` | 06 | 8 |
| `tests/fallbackPolicy.test.ts` | 06 | 12 |
| `tests/dialJobs.test.ts` | 06 | 4 |
| `tests/leadExtraction.test.ts` | 06 | 10 |
| `tests/liveState.test.ts` | 06 | 11 |
| `tests/campaign-phone.test.ts` | 07 | 6 |
| `tests/campaign-windows.test.ts` | 07 | 10 |
| `tests/campaign-retry.test.ts` | 07 | 11 |
| `tests/campaign-pacing.test.ts` | 07 | 9 |
| `tests/campaign-pool-compliance.test.ts` | 07 | 9 |
| `tests/campaign-scoring.test.ts` | 07 | 11 |
| `tests/campaign-fallback.test.ts` | 07 | 2 |
| `tests/analytics.test.ts` | 08 | 12 |
| `tests/fts.test.ts` | 08 | 4 |
| `tests/qa.test.ts` | 08 | 10 |
| `tests/deadair.test.ts` | 08 | 5 |
| `tests/pii.test.ts` | 08 | 8 |
| `tests/webhook-sign.test.ts` | 08 | 5 |
| `tests/csv.test.ts` | 08 | 5 |
| `tests/digest.test.ts` | 08 | 6 |
| `tests/retention.test.ts` | 08 | 2 |
| `tests/ratelimit.test.ts` | 08 | 4 |
| `tests/api-schemas.test.ts` | 08 | 7 |
| `tests/billing-ratecard.test.ts` | 09 | 13 |
| `tests/feature-gates.test.ts` | 09 | 7 |
| `tests/invoice.test.ts` | 09 | 9 |
| `tests/stripe-sig.test.ts` | 09 | 5 |
| `tests/addons-autotopup-reseller.test.ts` | 09 | 8 |
| `tests/onboarding.test.ts` | 10 | 11 |
| `tests/sample-data.test.ts` | 10 | 7 |
| `tests/branding.test.ts` | 10 | 8 |
| `tests/domain-verify.test.ts` | 10 | 9 |
| **TOTAL** | — | **381** |

**Isolating a failure:** re-run ONE file with
`npx vitest run tests/<name>.test.ts` (or `npx vitest run src/lib/<name>.test.ts`),
read the assertion, fix the CODE in the owning guide's module, never the test.
If the test genuinely contradicts its owning guide, STOP and report the pair.

### 1c. Schema smoke test (guide 02, 33 checks)

```bash
cd /root/vaani-ai && npx tsx scripts/schema-smoke.ts
```
**Expected:** `SCHEMA SMOKE: 33/33 checks passed` (exit 0). This is a live-DB
round-trip over all 49 Prisma models — it needs the dev db container up.
**If it fails:** the failing check number names the model group (guide 02 Step 6
maps check numbers → models). Re-run migrations: `npx prisma migrate dev`, then
`npx prisma generate`, retry once. Then STOP and report.

### 1d. Typecheck + build stay green

```bash
cd /root/vaani-ai && npm run typecheck && npm run build 2>&1 | tail -n 5
```
**Expected:** both exit 0.

---

## Step 2: Playwright E2E framework

Browser-level proof of the critical flows each guide reported. Every spec uses the
`data-testid` selectors the feature guides already ship (inventories live in each
guide's FINAL REPORT / selector table — guide 03 auth, 05 builder, 06 live ops,
07 campaigns, 08 analytics/webhooks/GDPR, 09 billing, 10 onboarding/branding/KYC,
12 status page).

### 2.1 Install Playwright (pinned)

```bash
cd /root/vaani-ai
npm install --save-dev @playwright/test@1.48.2
npx playwright install --with-deps chromium
```
**Expected:** `npm ls @playwright/test` → `@playwright/test@1.48.2`; the install
command ends with no errors (it downloads one Chromium build + apt deps).
**If it fails:** on a headless VPS `--with-deps` needs apt working — run
`apt-get update` first, retry once. If the download is blocked, set
`PLAYWRIGHT_DOWNLOAD_HOST` per the error message; otherwise STOP and report.

Guide 01 already added `"test:e2e": "playwright test"` to package.json and created
the `e2e/` directory. The config lives INSIDE `e2e/`, so point the script at it
(one-word change, exact sed):

```bash
cd /root/vaani-ai
sed -i 's#"test:e2e": "playwright test"#"test:e2e": "playwright test --config=e2e/playwright.config.ts"#' package.json
grep '"test:e2e"' package.json
```
**Expected:** `"test:e2e": "playwright test --config=e2e/playwright.config.ts"`.

**File `e2e/playwright.config.ts`** (full content):

```ts
import { defineConfig, devices } from "@playwright/test";

/**
 * Vaani AI E2E config. The app must already be running (npm run dev on :3000,
 * or a prod build). Override the target with E2E_BASE_URL.
 * Auth sessions are cached in e2e/.auth/ via the storageState pattern
 * (see helpers.ts — specs call loginDemo()/loginViaUi() which reuse it).
 */
export default defineConfig({
  testDir: ".",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // specs share one DB (demo workspace) — run serially
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

### 2.2 Shared helpers

**File `e2e/helpers.ts`** (full content):

```ts
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEMO_EMAIL = "demo@vaani.ai";
export const DEMO_PASSWORD = "demo1234";

const AUTH_DIR = path.join(__dirname, ".auth");
const DEMO_STATE = path.join(AUTH_DIR, "demo.json");

/** Run a shell command against the repo root; returns trimmed stdout. */
export function sh(cmd: string): string {
  return execSync(cmd, { cwd: path.join(__dirname, ".."), encoding: "utf-8" }).trim();
}

/** psql helper against the dev db container. */
export function psql(sql: string): string {
  return sh(`docker exec vaani-db psql -U vaani -d vaani -tAc ${JSON.stringify(sql)}`);
}

/**
 * UI login with the seeded demo user (guide 02 seed). Caches storageState in
 * e2e/.auth/demo.json and reuses it while valid (the storageState pattern).
 * The demo workspace has onboarding partially done, so OnboardingResume
 * (guide 10) does NOT force-redirect it — safe base for every non-onboarding spec.
 */
export async function loginDemo(page: Page): Promise<void> {
  if (existsSync(DEMO_STATE)) {
    await page.context().addCookies(
      JSON.parse(readFileSync(DEMO_STATE, "utf-8")).cookies ?? []
    );
    await page.goto("/dashboard");
    if (!page.url().includes("/login")) return; // cached session still valid
  }
  await loginViaUi(page, DEMO_EMAIL, DEMO_PASSWORD);
  mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: DEMO_STATE });
}

/** UI login through the real login form (password accounts without 2FA). */
export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill(email);
  await page.getByTestId("login-password-input").fill(password);
  await page.getByTestId("login-submit").click();
  // Password-only accounts land on /dashboard (or /onboarding for brand-new
  // workspaces — guide 10's OnboardingResume force-redirect).
  await expect(page).toHaveURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });
}

/** Register a brand-new workspace through the UI. Returns the credentials. */
export async function registerFreshWorkspace(page: Page, tag: string) {
  const email = `e2e-${tag}-${Date.now()}@test.dev`;
  const password = "e2e-pass-1234";
  await page.goto("/register");
  await page.getByTestId("register-name-input").fill("E2E Tester");
  await page.getByTestId("register-business-input").fill(`E2E ${tag}`);
  await page.getByTestId("register-email-input").fill(email);
  await page.getByTestId("register-password-input").fill(password);
  await page.getByTestId("register-submit").click();
  // Brand-new workspace → OnboardingResume bounces any app page to /onboarding.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  return { email, password };
}

/**
 * CAUTION (guide 10): OnboardingResume force-redirects brand-new workspaces to
 * /onboarding from every app page except /onboarding and /settings. Any spec for
 * a non-onboarding feature on a FRESH workspace must call this first (or use the
 * seeded demo workspace via loginDemo, where currentStep/checklist ≥ 1).
 * Walks the wizard with minimal input: industry → first template → skip KB →
 * skip test call → skip number → go live.
 */
export async function completeOnboardingFast(page: Page): Promise<void> {
  if (!page.url().includes("/onboarding")) await page.goto("/onboarding");
  await expect(page.getByTestId("onboarding-wizard")).toBeVisible();

  // Step 0 — industry (continue is disabled until an industry is picked)
  if (await page.getByTestId("onboarding-step-industry").isVisible()) {
    await page.getByTestId("onboarding-industry-select").selectOption({ index: 1 });
    await page.getByTestId("onboarding-industry-continue").click();
  }
  // Step 1 — template: create+publish from the first template card.
  // If Dograh is down the publish fails and onboarding-error shows instead —
  // then the explicit Continue button (rendered once an agent exists) is used.
  await expect(page.getByTestId("onboarding-step-template")).toBeVisible();
  await page.locator('[data-testid^="onboarding-template-select-"]').first().click();
  const kbStep = page.getByTestId("onboarding-step-knowledge");
  const tplNext = page.getByTestId("onboarding-template-next");
  await expect(kbStep.or(tplNext)).toBeVisible({ timeout: 30_000 });
  if (await tplNext.isVisible()) await tplNext.click();
  await expect(kbStep).toBeVisible();

  // Step 2 — knowledge: skip (KB itself is covered by knowledge.spec.ts)
  await page.getByTestId("onboarding-kb-skip").click();
  // Step 3 — browser test call: skip (needs Dograh webRTC)
  await page.getByTestId("onboarding-testcall-skip").click();
  // Step 4 — number: skip (no real DID in E2E)
  await page.getByTestId("onboarding-number-skip").click();
  // Step 5 — go live (enabled once industry + template are done)
  await page.getByTestId("onboarding-golive-btn").click();
  await expect(page.getByTestId("onboarding-done")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("onboarding-done-dashboard").click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Mint a session cookie via guide 03's CLI helper and inject it into the
 * browser context — simpler than UI login for role/permission specs.
 * Requires the demo-clinic workspace (guide 02 seed).
 */
export async function loginAsRole(
  context: BrowserContext,
  page: Page,
  email: string,
  role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER"
): Promise<void> {
  const out = sh(`npx tsx scripts/make-test-session.ts ${email} ${role}`);
  const cookieLine = out.split("\n").find((l) => l.startsWith("vaani_session="));
  if (!cookieLine) throw new Error(`make-test-session failed: ${out}`);
  const value = cookieLine.replace("vaani_session=", "").trim();
  const base = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000");
  await context.addCookies([
    { name: "vaani_session", value, domain: base.hostname, path: "/" },
  ]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Idempotent: map the +918040001234 test DID to the demo workspace (guide 06
 * Step 22 creates it, but specs must not depend on that having been run — without
 * the mapping the webhook handler 200-ignores the events).
 */
export function seedTestDid(): void {
  psql(
    `INSERT INTO "PhoneNumber" (id, "workspaceId", number, label, "agentId")
     SELECT 'pn_e2e', w.id, '+918040001234', 'E2E line', a.id FROM "Workspace" w, "Agent" a
     WHERE w.slug='demo-clinic' AND a."workspaceId"=w.id LIMIT 1 ON CONFLICT DO NOTHING;`
  );
}

/** Sign a Dograh webhook body exactly like Dograh does (guide 04/06). */
export function dograhSignature(body: string): string {
  const secret = sh(`grep '^DOGRAH_WEBHOOK_SECRET=' .env | cut -d= -f2`);
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** POST a signed Dograh webhook event to the running app. */
export async function postDograhEvent(
  page: Page,
  payload: unknown
): Promise<{ status: number; body: string }> {
  const body = JSON.stringify(payload);
  const res = await page.request.post("/api/webhooks/dograh", {
    data: body,
    headers: { "Content-Type": "application/json", "x-dograh-signature": dograhSignature(body) },
  });
  return { status: res.status(), body: await res.text() };
}
```

**Verify helpers compile:**
```bash
cd /root/vaani-ai && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "e2e/" || echo "0 e2e errors"
```
**Expected:** `0 e2e errors` (the repo tsconfig may not include `e2e/` — either
way no e2e-related errors). **If it fails:** the most common cause is
`require` usage in helpers — ensure `"module": "commonjs"` is NOT set; Next's
default tsconfig is fine because Playwright runs its own transform. Retry once;
then STOP and report the exact error.

### 2.3 Deterministic seed scripts for E2E (live ops + API keys)

Two specs need DB state the UI cannot create without real telephony. Create these
helpers (test-only, idempotent):

**File `scripts/e2e-seed-live.ts`** (full content):

```ts
/**
 * E2E-only: seed one in-progress LIVE call + one QUEUED transfer request in the
 * demo-clinic workspace so the live-ops spec has deterministic rows.
 * Usage: npx tsx scripts/e2e-seed-live.ts   (idempotent: deletes then recreates)
 */
import "../src/lib/db";
import { db } from "../src/lib/db";

async function main() {
  const ws = await db.workspace.findUniqueOrThrow({ where: { slug: "demo-clinic" } });

  await db.liveCallState.deleteMany({ where: { workspaceId: ws.id } });
  await db.transferRequest.deleteMany({ where: { workspaceId: ws.id } });
  await db.call.deleteMany({ where: { workspaceId: ws.id, dograhCallId: { startsWith: "e2e_live_" } } });

  const call = await db.call.create({
    data: {
      workspaceId: ws.id,
      dograhCallId: "e2e_live_1",
      direction: "INBOUND",
      status: "IN_PROGRESS",
      fromNumber: "+919811112222",
      toNumber: "+918040001234",
      transcript: "AI: Namaste! Demo Dental Clinic.\nCaller: I need a cleaning appointment.",
    },
  });
  await db.liveCallState.create({
    data: {
      workspaceId: ws.id,
      callId: call.id,
      status: "IN_PROGRESS",
      liveTranscript: "Caller: I need a cleaning appointment.",
    },
  });
  await db.transferRequest.create({
    data: {
      workspaceId: ws.id,
      callId: call.id,
      queue: "support",
      status: "QUEUED",
      reason: "caller asked for a human",
      contextSnapshot: { transcript: call.transcript, summary: "Wants a cleaning appointment" },
    },
  });
  console.log(`seeded live call ${call.id} + 1 transfer request`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
```

**File `scripts/e2e-make-apikey.ts`** (full content):

```ts
/**
 * E2E-only: create (or recreate) an isolated second workspace with a scoped API
 * key, for the cross-tenant isolation test. Prints the RAW key once (last line).
 * Usage: npx tsx scripts/e2e-make-apikey.ts
 */
import "../src/lib/db";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/lib/db";

async function main() {
  const ws = await db.workspace.upsert({
    where: { slug: "e2e-tenant-b" },
    update: {},
    create: { name: "E2E Tenant B", slug: "e2e-tenant-b" },
  });
  const rawKey = `vaani_test_${randomBytes(24).toString("hex")}`;
  await db.apiKey.deleteMany({ where: { workspaceId: ws.id, name: "e2e-cross-tenant" } });
  await db.apiKey.create({
    data: {
      workspaceId: ws.id,
      name: "e2e-cross-tenant",
      keyPrefix: rawKey.slice(0, 8),
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      scopes: ["calls:read"],
    },
  });
  console.log(`workspace=${ws.slug}`);
  console.log(rawKey);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
```

**Verify the seeds run:**
```bash
cd /root/vaani-ai
npx tsx scripts/e2e-seed-live.ts
npx tsx scripts/e2e-make-apikey.ts | head -n 1
docker exec vaani-db psql -U vaani -d vaani -tAc \
  "SELECT (SELECT count(*) FROM \"LiveCallState\"), (SELECT count(*) FROM \"TransferRequest\" WHERE status='QUEUED');"
```
**Expected:** `seeded live call … + 1 transfer request`, `workspace=e2e-tenant-b`,
then `1|1` (or higher if re-run after the spec — the seed is delete-then-create).
**If it fails:** `LiveCallState`/`TransferRequest`/`ApiKey` model names come from
guide 02's schema — if Prisma errors say a model doesn't exist, run
`npx prisma generate` and retry once; then STOP and report.
**Cleanup note:** the live-ops spec re-seeds before running; do not leave these
rows in production — this script is dev/E2E only (never run it in prod).

---

### 2.4 Spec — auth: register → wizard → login, TOTP 2FA, backup codes, RBAC

**File `e2e/auth.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { authenticator } from "otplib";
import {
  completeOnboardingFast,
  loginAsRole,
  loginViaUi,
  registerFreshWorkspace,
} from "./helpers";

test.describe("auth (guide 03 + guide 10 wizard redirect)", () => {
  test("register → wizard force-redirect → complete wizard → dashboard → logout → login", async ({ page }) => {
    const { email, password } = await registerFreshWorkspace(page, "auth");
    // Brand-new workspace MUST land on the wizard (OnboardingResume, guide 10).
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();
    await completeOnboardingFast(page);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();

    await page.getByTestId("logout-button").click();
    await expect(page).toHaveURL(/\/login/);

    await loginViaUi(page, email, password);
    // Wizard is completed now — no more force-redirect.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  test("TOTP 2FA: enable → login with authenticator code → backup code works once", async ({ page }) => {
    const { email, password } = await registerFreshWorkspace(page, "2fa");
    // /settings is exempt from the wizard force-redirect — 2FA can be enabled first.
    await page.goto("/settings/security");
    await page.getByTestId("totp-enroll-start").click();
    await expect(page.getByTestId("totp-qr")).toBeVisible();
    const secret = (await page.getByTestId("totp-secret").innerText()).trim();
    expect(secret.length).toBeGreaterThan(10);

    await page.getByTestId("totp-confirm-input").fill(authenticator.generate(secret));
    await page.getByTestId("totp-confirm-submit").click();
    await expect(page.getByTestId("totp-backup-codes")).toBeVisible({ timeout: 15_000 });
    const backupCodes = await page.getByTestId("totp-backup-codes").locator("li").allInnerTexts();
    expect(backupCodes.length).toBeGreaterThanOrEqual(6);

    // Login with a TOTP code (one retry across the 30s window boundary).
    await page.getByTestId("logout-button").click();
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill(email);
    await page.getByTestId("login-password-input").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-totp-form")).toBeVisible();
    await page.getByTestId("login-totp-input").fill(authenticator.generate(secret));
    await page.getByTestId("login-totp-submit").click();
    if (await page.getByTestId("login-error").isVisible()) {
      await page.getByTestId("login-totp-input").fill(authenticator.generate(secret));
      await page.getByTestId("login-totp-submit").click();
    }
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });

    // Backup code login — first use succeeds.
    await page.getByTestId("logout-button").click();
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill(email);
    await page.getByTestId("login-password-input").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-totp-form")).toBeVisible();
    await page.getByTestId("login-backup-code-toggle").click();
    await page.getByTestId("login-totp-input").fill(backupCodes[0]);
    await page.getByTestId("login-totp-submit").click();
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });

    // NEGATIVE: reusing the same backup code MUST fail.
    await page.getByTestId("logout-button").click();
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill(email);
    await page.getByTestId("login-password-input").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-totp-form")).toBeVisible();
    await page.getByTestId("login-backup-code-toggle").click();
    await page.getByTestId("login-totp-input").fill(backupCodes[0]);
    await page.getByTestId("login-totp-submit").click();
    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("RBAC negative: VIEWER cannot see member management", async ({ page, context }) => {
    await loginAsRole(context, page, "e2e-viewer@test.dev", "VIEWER");
    await page.goto("/settings/members");
    await expect(page.getByTestId("members-forbidden")).toBeVisible();
  });
});
```

### 2.5 Spec — agent lifecycle: template → edit → publish → rollback → A/B

Requires Dograh running (publish pushes a workflow — guide 04). Uses the seeded
demo workspace (no wizard redirect).

**File `e2e/agent-lifecycle.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";

test.describe("agent lifecycle (guide 05)", () => {
  test("template → edit → publish → version history → rollback → A/B variant", async ({ page }) => {
    await loginDemo(page);

    // Template gallery → use the real-estate template (guide 05 flow).
    await page.goto("/agents");
    await page.getByTestId("agents-new-btn").click();
    await expect(page.getByTestId("template-use-real-estate-qualifier")).toBeVisible();
    await page.getByTestId("template-use-real-estate-qualifier").click();
    // Editor opens pre-filled.
    await expect(page).toHaveURL(/\/agents\//, { timeout: 15_000 });
    await expect(page.getByTestId("agent-publish-btn")).toBeVisible();
    await page.getByTestId("agent-save-btn").click();

    // Publish v1 — pushes a workflow to Dograh.
    await page.getByTestId("agent-publish-btn").click();
    await expect(page.getByTestId("version-history-table")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("agent-publish-btn")).toHaveText(/Publish new version/);
    await expect(page.getByTestId("version-history-table")).toContainText("PUBLISHED");

    // Publish v2 so rollback has somewhere to go.
    await page.getByTestId("agent-publish-btn").click();
    await expect(page.getByTestId("version-rollback-1")).toBeVisible({ timeout: 30_000 });

    // Rollback to v1.
    await page.getByTestId("version-rollback-1").click();
    await expect(page.getByTestId("version-history-table")).toContainText("PUBLISHED", {
      timeout: 15_000,
    });

    // A/B variant off the live version: 20% traffic, then remove it.
    await page.getByTestId("ab-traffic-input").fill("20");
    await page.getByTestId("ab-create-btn").click();
    await expect(page.getByTestId("version-history-table")).toContainText("20", { timeout: 30_000 });
    await page.getByTestId("ab-remove-btn").click();
    await expect(page.getByTestId("ab-remove-btn")).toBeHidden({ timeout: 15_000 });
  });
});
```

### 2.6 Spec — knowledge base: FAQ paste → INDEXED

**File `e2e/knowledge.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";

test.describe("knowledge base (guide 05)", () => {
  test("paste FAQ text → document appears with INDEXED status", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/knowledge");

    const title = `E2E FAQ ${Date.now()}`;
    await page.locator('form:has([data-testid="kb-faq-btn"]) input[name="title"]').fill(title);
    await page
      .locator('form:has([data-testid="kb-faq-btn"]) textarea[name="contentText"]')
      .fill("Q: What are the clinic timings?\nA: 10 AM to 8 PM, Monday to Saturday.");
    await page.getByTestId("kb-faq-btn").click();

    // Text docs index synchronously (text lives in our DB — guide 05).
    const row = page.locator("div", { hasText: title }).last();
    await expect(page.locator('[data-testid^="kb-status-"]', { hasText: "INDEXED" }).first())
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(title)).toBeVisible();
  });
});
```

### 2.7 Spec — onboarding wizard end-to-end

**File `e2e/onboarding.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { registerFreshWorkspace } from "./helpers";

test.describe("onboarding wizard (guide 10)", () => {
  test("industry → template → KB text → skip test call → skip number → go live", async ({ page }) => {
    await registerFreshWorkspace(page, "wizard");
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();

    // Step 0 — industry
    await page.getByTestId("onboarding-industry-select").selectOption({ index: 1 });
    await page.getByTestId("onboarding-industry-continue").click();

    // Step 1 — template agent (creates + publishes via guide 05 actions; Dograh up)
    await expect(page.getByTestId("onboarding-step-template")).toBeVisible();
    await page.locator('[data-testid^="onboarding-template-select-"]').first().click();
    const kbStep = page.getByTestId("onboarding-step-knowledge");
    const tplNext = page.getByTestId("onboarding-template-next");
    await expect(kbStep.or(tplNext)).toBeVisible({ timeout: 30_000 });
    if (await tplNext.isVisible()) await tplNext.click();

    // Step 2 — knowledge: type FAQ text and SAVE (not skip)
    await expect(kbStep).toBeVisible();
    await page.getByTestId("onboarding-kb-textarea").fill("Q: Timings?\nA: 10am-8pm Mon-Sat.");
    await page.getByTestId("onboarding-kb-save").click();

    // Step 3 — browser test call: skip (needs Dograh webRTC — covered live in Step 6)
    await page.getByTestId("onboarding-testcall-skip").click();

    // Step 4 — number: skip (no real DID in E2E)
    await page.getByTestId("onboarding-number-skip").click();

    // Step 5 — go live
    await page.getByTestId("onboarding-golive-btn").click();
    await expect(page.getByTestId("onboarding-done")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("onboarding-done-dashboard").click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Wizard completed → app pages no longer redirect; checklist dismissed/done.
    await page.goto("/agents");
    await expect(page).toHaveURL(/\/agents/);
  });
});
```

### 2.8 Spec — sample data mode

**File `e2e/sample-data.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { registerFreshWorkspace, completeOnboardingFast } from "./helpers";

test.describe("sample data mode (guide 10)", () => {
  test("toggle on → sample rows visible; toggle off → removed", async ({ page }) => {
    // Fresh workspace keeps this spec isolated from real demo data.
    await registerFreshWorkspace(page, "sample");
    await completeOnboardingFast(page);

    await page.goto("/dashboard");
    await expect(page.getByTestId("sample-data-card")).toBeVisible();
    await page.getByTestId("sample-data-toggle").click();
    await expect(page.getByTestId("sample-data-toggle")).toHaveText(/Clear sample data/, {
      timeout: 20_000,
    });

    // Sample contacts list is prefixed (guide 10 SAMPLE_PREFIX) and visible.
    await page.goto("/contacts");
    await expect(page.getByText(/sample/i).first()).toBeVisible({ timeout: 15_000 });

    // Toggle off → sample rows purged, button resets.
    await page.goto("/dashboard");
    await page.getByTestId("sample-data-toggle").click();
    await expect(page.getByTestId("sample-data-toggle")).toHaveText(/Load sample data/, {
      timeout: 20_000,
    });
  });
});
```

### 2.9 Spec — live ops: simulated inbound → live dashboard → whisper → transfer accept

**File `e2e/live-ops.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo, psql, sh } from "./helpers";

test.describe("live ops / HITL (guide 06)", () => {
  test.beforeEach(() => {
    sh("npx tsx scripts/e2e-seed-live.ts"); // deterministic LIVE call + QUEUED transfer
  });

  test("live dashboard shows in-progress call → whisper coach → transfer accept", async ({ page }) => {
    await loginDemo(page);

    // Live dashboard: seeded in-progress call appears.
    await page.goto("/live");
    await expect(page.getByTestId("live-dashboard")).toBeVisible();
    await expect(page.getByTestId("live-call-row").first()).toBeVisible({ timeout: 15_000 });

    // Whisper: type coach text → send → whisper-active indicator appears.
    await page.getByTestId("live-whisper-input").first().fill("Offer the Saturday 11 AM slot.");
    await page.getByTestId("live-whisper-send").first().click();
    await expect(page.getByTestId("live-whisper-active").first()).toBeVisible({ timeout: 15_000 });

    // Transfer queue: accept the seeded request → lands in "accepted" list.
    await page.goto("/transfers");
    await expect(page.getByTestId("transfer-queue-row").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("transfer-context").first()).toBeVisible();
    await page.getByTestId("transfer-accept-btn").first().click();
    await expect(page.getByTestId("transfer-accepted-row").first()).toBeVisible({ timeout: 15_000 });

    // DB proof: transfer accepted by the demo user.
    const accepted = psql(
      `SELECT count(*) FROM "TransferRequest" WHERE status='ACCEPTED' AND "acceptedByUserId" IS NOT NULL;`
    );
    expect(Number(accepted)).toBeGreaterThanOrEqual(1);
  });

  test("negative: whisper input requires an in-progress call (empty state otherwise)", async ({ page }) => {
    psql(`DELETE FROM "LiveCallState";`);
    await loginDemo(page);
    await page.goto("/live");
    await expect(page.getByTestId("live-empty")).toBeVisible({ timeout: 15_000 });
  });
});
```

### 2.10 Spec — campaigns: CSV → dry-run → live status → mid-flight edit → pause

Requires the worker running with `CAMPAIGN_DRY_RUN=true` (guide 07 default).

**File `e2e/campaigns.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";
import { writeFileSync } from "node:fs";

test.describe("outbound campaigns (guide 07)", () => {
  test("CSV upload → campaign create → start → live status → mid-flight edit → pause", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();

    // 1. CSV upload (3 valid mobiles)
    const csvPath = `/tmp/e2e-contacts-${tag}.csv`;
    writeFileSync(
      csvPath,
      "phone,name\n+919700000001,E2E One\n+919700000002,E2E Two\n+919700000003,E2E Three\n"
    );
    await page.goto("/contacts");
    await page.getByTestId("list-name-input").fill(`E2E list ${tag}`);
    await page.getByTestId("csv-file-input").setInputFiles(csvPath);
    await page.getByTestId("csv-import-submit").click();
    await expect(page.getByTestId("csv-import-result")).toContainText("3", { timeout: 15_000 });

    // 2. New campaign on that list, wide window, dry-run worker dials it
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign-button").click();
    await page.getByTestId("campaign-name-input").fill(`E2E campaign ${tag}`);
    await page.getByTestId("agent-select").selectOption({ index: 1 });
    await page.getByTestId("list-select").selectOption({ label: `E2E list ${tag}` });
    await page.getByTestId("window-start-input").fill("00:00");
    await page.getByTestId("window-end-input").fill("23:59");
    await page.getByTestId("cpm-input").fill("60");
    await page.getByTestId("create-campaign-submit").click();

    // 3. Start → RUNNING (the start button is resume-button on a DRAFT campaign)
    await expect(page.getByTestId("campaign-detail")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("resume-button").click();
    await expect(page.getByTestId("campaign-status-pill")).toHaveText("RUNNING", { timeout: 15_000 });

    // 4. Live status rows as the dry-run worker dials (polls; allow 60s)
    await expect(page.getByTestId("live-status-table")).toBeVisible();
    await expect(async () => {
      await page.reload();
      const rows = await page.getByTestId("live-status-row").count();
      expect(rows).toBeGreaterThan(0);
    }).toPass({ timeout: 60_000, intervals: [5_000] });

    // 5. Mid-flight script edit (guide 07: edit while RUNNING)
    await page.getByTestId("edit-opening-hook").fill(`E2E hook edited ${tag}`);
    await page.getByTestId("edit-script-submit").click();
    await expect(page.getByTestId("edit-script-card")).toContainText(`E2E hook edited ${tag}`, {
      timeout: 15_000,
    });

    // 6. Pause
    await page.getByTestId("pause-button").click();
    await expect(page.getByTestId("campaign-status-pill")).toHaveText("PAUSED", { timeout: 15_000 });
  });
});
```

### 2.11 Spec — opt-out cascade (compliance)

**File `e2e/opt-out.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo, postDograhEvent, psql, seedTestDid } from "./helpers";

test.describe("opt-out cascade (readme §11, guides 06/07)", () => {
  test('"stop calling me" on a call flips Contact.dnc + creates DncEntry + UI badge', async ({ page }) => {
    const phone = "+919800009999";
    seedTestDid(); // the webhook handler needs the DID mapped (else it 200-ignores)
    psql(
      `INSERT INTO "Contact" (id, "workspaceId", phone, name)
       SELECT 'e2e_optout_c', id, '${phone}', 'E2E OptOut' FROM "Workspace" WHERE slug='demo-clinic'
       ON CONFLICT DO NOTHING;`
    );

    await loginDemo(page);
    const callId = `e2e_optout_${Date.now()}`;
    const started = await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: phone, to_number: "+918040001234" },
    });
    expect(started.status).toBe(200);
    const ended = await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 42,
        summary: "Caller asked to never be called again.",
        transcript: "AI: Hello!\nCaller: Stop calling me! Mujhe dobara call mat karna.",
      },
    });
    expect(ended.status).toBe(200);

    // Post-call pipeline is async — poll the DB, then check the UI badge.
    await expect(async () => {
      const dnc = psql(
        `SELECT count(*) FROM "Contact" c JOIN "Workspace" w ON w.id=c."workspaceId"
         WHERE w.slug='demo-clinic' AND c.phone='${phone}' AND c.dnc=true;`
      );
      expect(dnc).toBe("1");
      const entry = psql(
        `SELECT count(*) FROM "DncEntry" d JOIN "Workspace" w ON w.id=d."workspaceId"
         WHERE w.slug='demo-clinic' AND d.phone='${phone}';`
      );
      expect(Number(entry)).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    await page.goto("/contacts");
    await expect(page.getByTestId("dnc-badge").first()).toBeVisible({ timeout: 15_000 });
  });
});
```

---

### 2.12 Spec — billing: wallet, low-balance banner, plan upgrade, invoice, Razorpay

**File `e2e/billing.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { completeOnboardingFast, registerFreshWorkspace } from "./helpers";

test.describe("billing (guide 09)", () => {
  test("trial wallet → low-balance banner → plan upgrade → GST invoice", async ({ page }) => {
    // Fresh workspace = ₹1,000.00 trial credit (guide 09) and full isolation.
    await registerFreshWorkspace(page, "billing");
    await completeOnboardingFast(page);

    await page.goto("/billing");
    await expect(page.getByTestId("wallet-balance")).toContainText("₹1,000.00");

    // Low-balance banner: raise the alert threshold above the balance.
    await page.getByTestId("threshold-input").fill("2000");
    await page.getByTestId("threshold-save").click();
    await expect(page.getByTestId("low-balance-banner")).toBeVisible({ timeout: 15_000 });
    // Reset the threshold so the banner logic itself (not only the negative
    // balance below) is proven.
    await page.getByTestId("threshold-input").fill("100");
    await page.getByTestId("threshold-save").click();
    await expect(page.getByTestId("low-balance-banner")).toBeHidden({ timeout: 15_000 });

    // Plan upgrade: starter → growth debits PLAN_FEE immediately (wallet may go
    // negative by design — guide 13 §F4).
    await page.getByTestId("plans-link").click();
    await expect(page).toHaveURL(/\/billing\/plans/);
    await page.getByTestId("plan-upgrade-growth").click();
    await expect(page.getByTestId("plan-current-badge")).toBeVisible({ timeout: 15_000 });

    // GST invoice for the current month (covers the PLAN_FEE debit).
    await page.goto("/billing");
    await page.getByTestId("invoice-generate-button").click();
    await expect(page.getByTestId("invoice-table")).toContainText("998314", { timeout: 15_000 }); // HSN/SAC
    await expect(page.getByTestId("transaction-table")).toContainText("Subscription plan fee");
  });

  test("Razorpay test top-up via UI with test card", async ({ page }) => {
    test.skip(
      process.env.E2E_RAZORPAY_LIVE !== "1",
      "Set E2E_RAZORPAY_LIVE=1 with real Razorpay TEST keys in .env — drives the hosted checkout"
    );
    await registerFreshWorkspace(page, "topup");
    await completeOnboardingFast(page);
    await page.goto("/billing");
    await page.getByTestId("topup-dialog").getByTestId("topup-tab-razorpay").click();

    // Razorpay hosted checkout (external surface — if their sandbox UI changed,
    // STOP and report per the playbook rule; do not improvise selectors).
    const rz = page.frameLocator('iframe[src*="razorpay"]').first();
    await rz.locator('[name="card[number]"], input[name="card_number"]').first()
      .fill("4111111111111111", { timeout: 30_000 });
    await rz.locator('[name="card[expiry]"], input[name="expiry"]').first().fill("1230");
    await rz.locator('[name="card[cvv]"], input[name="cvv"]').first().fill("123");
    await rz.locator('[name="card[name]"], input[name="name"]').first().fill("E2E Tester");
    await rz.locator('button:has-text("Pay"), #pay-button').first().click();

    // Success returns to /billing?topup=success and the webhook credits the wallet.
    await expect(page).toHaveURL(/topup=success/, { timeout: 60_000 });
    await expect(async () => {
      await page.goto("/billing");
      await expect(page.getByTestId("transaction-table")).toContainText("TOPUP");
    }).toPass({ timeout: 60_000, intervals: [5_000] });
  });
});
```

### 2.13 Spec — analytics: transcript FTS, QA badge, CSV export

Requires `QA_DRY_RUN=true` (default) → deterministic mock QA scores.

**File `e2e/analytics.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo, postDograhEvent, psql, seedTestDid } from "./helpers";

test.describe("analytics + QA + exports (guide 08)", () => {
  test("completed call → transcript FTS → QA badge → cost card → CSV export", async ({ page }) => {
    const token = `zebracorn${Date.now()}`;
    const callId = `e2e_an_${Date.now()}`;
    seedTestDid(); // webhook handler needs the DID mapped (else it 200-ignores)

    await loginDemo(page);
    // Simulate a completed call whose transcript contains a unique token.
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: "+919812345678", to_number: "+918040001234" },
    });
    const ended = await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 150,
        summary: `Booked a cleaning; token ${token}.`,
        transcript: `AI: Namaste!\nCaller: ${token} — I want a cleaning on Saturday.\nAI: Booked for Saturday 11 AM.`,
      },
    });
    expect(ended.status).toBe(200);

    // Transcript full-text search finds exactly this call.
    await page.goto("/calls");
    await page.getByTestId("calls-transcript-search").fill(token);
    await page.getByTestId("calls-transcript-search").press("Enter");
    await expect(page.getByTestId("calls-fts-count")).toContainText("1 call(s)", { timeout: 15_000 });

    // Open the call: transcript, cost card, and (async, QA_DRY_RUN mock) QA badge.
    const dbId = psql(`SELECT id FROM "Call" WHERE "dograhCallId"='${callId}';`);
    await page.goto(`/calls/${dbId}`);
    await expect(page.getByTestId("call-transcript")).toContainText(token);
    await expect(page.getByTestId("call-cost-card")).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("call-qa-score")).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [5_000] });

    // CSV export downloads (authenticated route).
    await page.goto("/calls");
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-calls-csv").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("calls");

    // Analytics dashboard tiles render.
    await page.goto("/analytics");
    await expect(page.getByTestId("tile-total-calls")).toBeVisible();
    await expect(page.getByTestId("chart-calls-per-day")).toBeVisible();
  });
});
```

### 2.14 Spec — outbound webhooks: subscribe → test event → SUCCESS delivery

Requires the worker running (it dispatches deliveries) and uses guide 08's
`scripts/webhook-receiver.ts`.

**File `e2e/webhooks.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo, psql, sh } from "./helpers";

test.describe("event webhooks (guide 08)", () => {
  test("create subscription → send test event → signed SUCCESS delivery", async ({ page }) => {
    await loginDemo(page);

    // 1. Create a subscription via the UI.
    await page.goto("/settings/webhooks");
    await page.getByTestId("webhook-url-input").fill("http://localhost:4777/hook");
    await page.locator('input[name="events"]').first().check();
    await page.getByTestId("webhook-create-button").click();
    const row = page.locator('[data-testid="webhook-sub-table"] tr', { hasText: "localhost:4777" });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // 2. The table shows the generated secret — point the receiver at it.
    const secret = (await row.locator("td").nth(2).innerText()).trim();
    expect(secret.length).toBeGreaterThan(8);
    sh("pkill -f webhook-receiver || true");
    sh(`(RECEIVER_SECRET=${secret} npx tsx scripts/webhook-receiver.ts > /tmp/e2e-webhook.log 2>&1 &)`);
    await new Promise((r) => setTimeout(r, 3000));

    // 3. Send the test event from the UI; the worker delivers it.
    const subId = psql(
      `SELECT id FROM "WebhookSubscription" WHERE url='http://localhost:4777/hook' ORDER BY "createdAt" DESC LIMIT 1;`
    );
    await page.getByTestId(`webhook-test-${subId}`).click();

    // 4. Receiver saw a VALIDLY signed test.ping; delivery row → SUCCESS 200.
    await expect(async () => {
      const log = sh("cat /tmp/e2e-webhook.log");
      expect(log).toContain("event=test.ping signature_valid=true");
    }).toPass({ timeout: 60_000, intervals: [5_000] });
    await expect(async () => {
      const status = psql(
        `SELECT status FROM "WebhookDelivery" WHERE "subscriptionId"='${subId}' ORDER BY "createdAt" DESC LIMIT 1;`
      );
      expect(status).toBe("SUCCESS");
    }).toPass({ timeout: 60_000, intervals: [5_000] });
    sh("pkill -f webhook-receiver || true");
  });
});
```

### 2.15 Spec — GDPR export flow (non-destructive)

Requires the worker running (cron processes requests ~every 60s). Erasure is
covered by guide 08's scripted test — do NOT erase here (it deletes demo rows).

**File `e2e/gdpr.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo, psql } from "./helpers";

test.describe("GDPR data rights (guide 08)", () => {
  test("request workspace export → COMPLETED → download link", async ({ page }) => {
    test.setTimeout(240_000); // the worker cron ticks ~60s
    await loginDemo(page);

    await page.goto("/settings/data-rights");
    await page.getByTestId("gdpr-export-button").click(); // empty phone = whole workspace
    await expect(page.getByTestId("gdpr-requests-table")).toContainText("EXPORT", { timeout: 15_000 });

    const reqId = psql(
      `SELECT r.id FROM "GdprRequest" r JOIN "Workspace" w ON w.id=r."workspaceId"
       WHERE w.slug='demo-clinic' AND r.type='EXPORT' ORDER BY r."createdAt" DESC LIMIT 1;`
    );

    // Worker cron processes the request; the table then offers a download.
    await expect(async () => {
      const status = psql(`SELECT status FROM "GdprRequest" WHERE id='${reqId}';`);
      expect(status).toBe("COMPLETED");
    }).toPass({ timeout: 200_000, intervals: [10_000] });

    await page.goto("/settings/data-rights");
    await expect(page.getByTestId(`gdpr-download-${reqId}`)).toBeVisible({ timeout: 15_000 });
  });
});
```

### 2.16 Spec — white-label branding

Requires MinIO up (logo upload) — dev infra provides it.

**File `e2e/branding.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";
import { writeFileSync } from "node:fs";

// 1×1 px PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.describe("branding / white-label (guide 10)", () => {
  test("primary color change reflects in layout; logo shows in sidebar", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/settings/branding");
    await expect(page.getByTestId("branding-page")).toBeVisible();

    // Color: set a distinctive hex → the app layout injects --primary HSL.
    await page.getByTestId("branding-color-hex").fill("#ff0055");
    await page.getByTestId("branding-color-save").click();
    await page.goto("/dashboard");
    await expect(page.getByTestId("brand-style")).toHaveText(/--primary:\s*3\d\d/, { timeout: 15_000 });

    // Logo upload → sidebar <img data-testid="app-logo"> on next load.
    const logoPath = "/tmp/e2e-logo.png";
    writeFileSync(logoPath, Buffer.from(PNG_B64, "base64"));
    await page.goto("/settings/branding");
    await page.getByTestId("branding-logo-input").setInputFiles(logoPath);
    await page.getByTestId("branding-logo-upload").click();
    await expect(page.getByTestId("branding-logo-preview")).toBeVisible({ timeout: 15_000 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-logo")).toBeVisible({ timeout: 15_000 });
  });
});
```

### 2.17 Spec — KYC upload

**File `e2e/kyc.spec.ts`** (full content):

```ts
import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";
import { writeFileSync } from "node:fs";

const PDF_BYTES = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

test.describe("KYC (guide 10, readme §13)", () => {
  test("upload a KYC document → status PENDING", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/settings/kyc");
    await expect(page.getByTestId("kyc-page")).toBeVisible();

    const docPath = "/tmp/e2e-kyc.pdf";
    writeFileSync(docPath, PDF_BYTES);
    await page.getByTestId("kyc-doctype-select").selectOption({ index: 1 });
    await page.getByTestId("kyc-ref-input").fill(`E2E-REF-${Date.now()}`);
    await page.getByTestId("kyc-file-input").setInputFiles(docPath);
    await page.getByTestId("kyc-submit-btn").click();
    await expect(page.getByTestId("kyc-success")).toContainText("PENDING", { timeout: 15_000 });
    await expect(page.getByTestId("kyc-status-banner")).toBeVisible();
  });
});
```

### 2.18 Spec — public status page (guide 12 route — runs only once it exists)

`/status` and `/api/health` ship in guide 12, which runs AFTER this guide. This
spec self-skips while the route doesn't exist (guide 11 dev run) and becomes a
hard gate when guide 12 re-runs the E2E suite against production.

**File `e2e/status.spec.ts`** (full content):

```ts
import { test, expect, request } from "@playwright/test";

test.describe("public status page (guide 12)", () => {
  test("logged-out /status renders; /api/health answers JSON", async ({ browser, baseURL }) => {
    // Probe first (no cookies): skip cleanly until guide 12 ships the route.
    const probeCtx = await request.newContext({ baseURL });
    const probe = await probeCtx.get("/status");
    const missing = probe.status() === 404;
    await probeCtx.dispose();
    test.skip(missing, "/status ships in guide 12 — re-run the suite after guide 12");

    // Unauthenticated browser render (fresh context = no cookies).
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/status");
    await expect(page.getByTestId("status-page")).toBeVisible();
    await expect(page.getByTestId("status-banner")).toBeVisible();
    await expect(page.getByTestId("status-uptime")).toBeVisible();

    const health = await page.request.get("/api/health");
    expect(health.status()).toBe(200);
    const json = await health.json();
    expect(["ok", "degraded"]).toContain(json.status);
    expect(json.checks.db).toBe(true);
    await context.close();
  });
});
```

### 2.19 Run the E2E suite

**Prereqs:** dev server + worker running, Docker infra up, seed applied, Dograh
running (guide 04 — needed by agent publish and the onboarding template step).

```bash
cd /root/vaani-ai
pkill -f "next dev" || true; pkill -f "tsx src/worker" || true
(npm run dev > /tmp/next-dev.log 2>&1 &)
(npm run worker > /tmp/worker.log 2>&1 &)
sleep 15
npm run test:e2e 2>&1 | tail -n 30
```
**Expected:** `18 tests` total across 15 spec files: **`16 passed, 2 skipped`**
(the skips are the Razorpay hosted-checkout test — gated on `E2E_RAZORPAY_LIVE=1` —
and status.spec, which self-skips until guide 12 ships `/status`). Zero failed,
zero flaky. The `N passed, M skipped` summary line is the source of truth.
The full run takes ~6–10 minutes (the GDPR spec waits on the worker cron).
**If it fails:**
1. Re-run ONLY the failing spec headed to watch it:
   `npx playwright test --config=e2e/playwright.config.ts e2e/<spec>.spec.ts --headed`
   (no display on a VPS → use `--debug` for step-through, or
   `npx playwright test ... --trace on` then `npx playwright show-trace e2e/test-results/**/trace.zip`).
2. Read the screenshot in `e2e/test-results/` — a missing `data-testid` means the
   FEATURE page is broken (fix the feature per its guide), never delete the assertion.
3. `login-demo` failures usually mean the seed is stale: re-run
   `npm run prisma:seed` and retry once.
4. Dograh-dependent failures (publish, wizard template step): check
   `docker ps | grep dograh` and guide 04's health check; start Dograh, retry once.
5. Still red after 2 attempts → STOP and report spec name + the Playwright error.

---

## Step 3: The smoke test script (extended)

A repeatable black-box check that works against ANY running instance. Dev profile
(default) covers everything that exists after guides 01–10; `SMOKE_PROFILE=prod`
adds the guide-12 routes (`/api/health`, `/status`) — guide 12 Step 7 runs it that
way against the production domain.

**File `scripts/smoke-test.sh`** (full content — overwrite):

```bash
#!/usr/bin/env bash
# Vaani AI smoke test.
#   Usage: BASE_URL=http://localhost:3000 ./scripts/smoke-test.sh
#   Prod:  SMOKE_PROFILE=prod BASE_URL=https://vaani.example.com ./scripts/smoke-test.sh
set -u
BASE="${BASE_URL:-http://localhost:3000}"
PROFILE="${SMOKE_PROFILE:-dev}"
PASS=0; FAIL=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1";
  else FAIL=$((FAIL+1)); echo "FAIL  $1 — expected [$2] got [$3]"; fi
}

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

# 1. Public pages
check "landing 200"            "200" "$(code $BASE/)"
check "landing has hero"       "language" "$(curl -s $BASE/ | grep -o 'language' | head -1)"
check "login 200"              "200" "$(code $BASE/login)"
check "register 200"           "200" "$(code $BASE/register)"

# 2. Protected pages redirect when logged out (307 to /login)
for p in dashboard agents marketplace knowledge campaigns contacts calls live transfers dialer numbers analytics billing settings onboarding; do
  check "/$p redirects" "307" "$(code $BASE/$p)"
done

# 3. API auth enforcement (NEGATIVE tests — must all be 401)
check "csv export 401 logged-out"   "401" "$(code $BASE/api/exports/calls.csv)"
check "api v1 ping 401 no key"      "401" "$(code $BASE/api/v1/ping)"
check "api v1 ping 401 bad key"     "401" "$(code -H 'Authorization: Bearer nonsense' $BASE/api/v1/ping)"
check "api v1 calls 401 no key"     "401" "$(code $BASE/api/v1/calls)"
check "mcp 401 no key"              "401" "$(code -X POST $BASE/api/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
check "mcp 401 wrong key"           "401" "$(code -X POST $BASE/api/mcp -H 'x-mcp-key: wrong' -H 'Content-Type: application/json' -d '{}')"

# 4. Webhook endpoints reject unsigned/garbage calls
check "dograh webhook rejects unsigned"   "401" "$(code -X POST $BASE/api/webhooks/dograh -H 'Content-Type: application/json' -d '{}')"
check "razorpay webhook rejects unsigned" "401" "$(code -X POST $BASE/api/webhooks/razorpay -H 'Content-Type: application/json' -d '{}')"
check "stripe webhook rejects unsigned"   "401" "$(code -X POST $BASE/api/webhooks/stripe -H 'Content-Type: application/json' -d '{}')"
check "resolve-number rejects no-secret"  "401" "$(code "$BASE/api/v1/resolve-number?to=%2B910000000000")"

# 5. 404 page
check "unknown route handled" "404" "$(code $BASE/this-route-does-not-exist)"

# 6. Prod-only routes (ship in guide 12)
if [ "$PROFILE" = "prod" ]; then
  check "health 200"          "200" "$(code $BASE/api/health)"
  check "health json status"  "ok" "$(curl -s $BASE/api/health | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4 | sed 's/degraded/ok/')"
  check "status page 200"     "200" "$(code $BASE/status)"
  check "status page public"  "Vaani AI status" "$(curl -s $BASE/status | grep -o 'Vaani AI status' | head -1)"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed (profile=$PROFILE)"
[ "$FAIL" -eq 0 ]
```

**Do:**
```bash
cd /root/vaani-ai
chmod +x scripts/smoke-test.sh
pkill -f "next dev" || true
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15
./scripts/smoke-test.sh
echo "exit: $?"
```
**Expected:** every line `PASS`, `RESULT: 30 passed, 0 failed (profile=dev)`,
`exit: 0` (prod profile: 34 checks). Caveats:
- The dograh-unsigned check needs `DOGRAH_WEBHOOK_SECRET` set in `.env` (dev route
  allows unsigned ONLY while the secret is unset — guide 04). Set it, restart, re-run.
- The stripe-unsigned check needs `STRIPE_SECRET_KEY` present (guide 09 — the route
  refuses to run without it). With placeholder keys it still rejects garbage → 401.
- `/api/v1/ping` with a key requires a real key (guide 03 flow) — that positive
  path is proven in Step 4 below; the smoke script asserts the negatives.
**If a FAIL appears:** the line names the check — fix the underlying route per its
guide, re-run. Stop dev server after: `pkill -f "next dev" || true`.

---

## Step 4: Tenant-isolation audit (grep proof + scripted cross-tenant test)

### 4a. Grep proof — every tenant-owned query path references workspaceId

```bash
cd /root/vaani-ai
echo "--- server actions: every file must reference workspaceId ---"
for f in src/server/actions/*.ts; do
  n=$(grep -c "workspaceId" "$f" || true)
  echo "$f: $n"
done
echo "--- query-heavy libs (guides 07/08/09 + public API): must scope by workspaceId ---"
for f in src/lib/campaign*.ts src/lib/analytics*.ts src/lib/billing*.ts src/lib/reseller*.ts src/lib/api/resources.ts src/lib/reports*.ts src/lib/gdpr*.ts src/lib/retention*.ts; do
  [ -f "$f" ] && echo "$f: $(grep -c 'workspaceId' "$f" || true)"
done
echo "--- app pages: every (app) page must call requireWorkspace or redirect ---"
grep -rl "requireWorkspace\|requireRole\|requirePermission" src/app/\(app\)/ --include=page.tsx | wc -l
find src/app/\(app\)/ -name page.tsx | wc -l
```
**Expected:**
- `workspaceId` count ≥ 1 in every `src/server/actions/*.ts` file except pure auth
  flows (`auth.ts` may scope via session instead — all others MUST be ≥ 1).
- Every listed lib ≥ 1 (these were built guides 07–09; a `0` means an unscoped
  query path → STOP and fix in the owning guide's pattern).
- The two page counts are EQUAL (every app page is guarded). If any page is
  unguarded → STOP, add the guard block copied from another page, re-run.

### 4b. Scripted cross-tenant API test (second tenant's key sees nothing of tenant A)

```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &) || true
sleep 12
KEY=$(npx tsx scripts/e2e-make-apikey.ts | tail -n 1)

# Tenant B's key works — but returns ONLY tenant B data (empty):
curl -s -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/calls | head -c 300; echo
# It must NOT see the demo workspace's seeded calls:
curl -s -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/calls | grep -c "919812345678" || echo "0 — no tenant-A data leaked"
# Scope enforcement: tenant B key has calls:read only — agents must 403:
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/agents
```
**Expected:**
1. A JSON list response (HTTP 200) whose calls array is empty (`[]`) or contains
   only `e2e-tenant-b` rows.
2. `0 — no tenant-A data leaked` (the seeded demo caller `919812345678` never
   appears through tenant B's key).
3. `403` (scope missing) — not 200.
**If it fails:** a leak means `requireApiKey`/`lib/api/resources.ts` lost its
workspace scoping — STOP and report; this is the highest-severity failure class
in the project. Fix per guide 03/08 pattern, re-run once.

### 4c. Scripted RBAC negatives (run each guide's OWN script — do not duplicate them here)

Each feature guide ships its own scripted permission negative. Run them all now
(the commands live in the owning guide's step; expected outputs below):

| Guide step | Script / check | Expected negative result |
|---|---|---|
| Guide 05 Step 22e | VIEWER agent-create attempt (resolvePermissions matrix; psql-seeded `viewer@vaani.ai`) | Create REFUSED — VIEWER lacks `agents:write` |
| Guide 06 — `scripts/perm-check.ts` | `npx tsx scripts/perm-check.ts` | Viewer `numbers:write=false`; `permissionForMode` live:* mapping printed (listen/whisper/barge/takeover → correct perms) |
| Guide 07 Scenario H (14.8) | `curl` `/api/internal/perm-check?perm=campaigns:launch` as VIEWER, then as MANAGER | VIEWER → `403 FORBIDDEN`; MANAGER control → `200` |
| Guide 08 Step 17 negative | psql flip demo user to VIEWER → webhook subscription create attempt → restore OWNER | Create REFUSED while VIEWER; succeeds again after restoring OWNER |

**Expected:** all four negatives refuse exactly as documented in their guides.
**If one fails:** the refusal must come from the permission layer, not a 500 —
read the owning guide's expected output, fix the guard, re-run once, then STOP
and report.

---

## Step 5: The Golden Path (v1 definition of done — scripted where possible)

Run in dev (`npm run dev` + `npm run worker`, all `*_DRY_RUN=true`). Rows marked
*(scripted)* are executed by Hermes; the rest are operator clicks. The onboarding
wizard + Playwright suite (Step 2) already prove several rows — record both.

| # | Actor | Action | Expected result | Proof |
|---|---|---|---|---|
| 1 | Operator | Register "Golden Path Clinic" | Lands on /onboarding (wizard force-redirect, guide 10); wallet ₹1,000.00; plan Starter trial | e2e/auth.spec |
| 2 | Operator | Wizard: industry → template → KB text → skip test call → skip number → go live | /onboarding → `onboarding-done`; agent created + PUBLISHED | e2e/onboarding.spec |
| 3 | Operator | Agents → open the agent → versions tab | version-history-table shows v1 PUBLISHED with Dograh workflow id | e2e/agent-lifecycle.spec |
| 4 | Operator | Knowledge → paste FAQ | doc row INDEXED | e2e/knowledge.spec |
| 5 | Hermes *(scripted)* | Register DID +918040009999 assigned to the agent (psql, guide 06 Step 22 pattern), then `curl` the resolver with `x-internal-secret` | `{"ok":true,"workflowId":...}` | guide 06 T1 |
| 6 | Hermes *(scripted)* | Fire signed call.started + call.ended (150s, transcript with a booking) | both `{"ok":true}`; Call row COMPLETED with summary | Step 2.13 pattern |
| 7 | Hermes *(scripted)* | Wait 10s, query the call | outcome `booked`-ish, sentiment set, `billedPaise = 294` (150s × 1.4 wholesale paise/s × markup — guide 09 rates), QaScore row exists (QA_DRY_RUN mock) | psql |
| 8 | Operator | /calls → open the call | transcript, summary, cost card, QA badge, timeline all render | e2e/analytics.spec |
| 9 | Operator | Contacts → upload 5-row CSV (1 DNC row, 1 bad phone) | 3–4 imported, bad row skipped, DNC flagged | e2e/campaigns.spec (CSV step) |
| 10 | Operator | Campaigns → new (published agent, the list, window 00:00–23:59, 60/min, 1 attempt) → Start | Status RUNNING | e2e/campaigns.spec |
| 11 | Hermes *(scripted)* | Watch worker log + DB 90s | contacts dialed (dry-run); DNC row SKIPPED_DNC; campaign → COMPLETED | worker log |
| 12 | Operator | /billing | CALL_DEBIT ledger rows; balance reduced accordingly | e2e/billing.spec (ledger visible) |
| 13 | Operator | /analytics | charts show today's calls; margin card positive | e2e/analytics.spec |
| 14 | Operator | /settings/audit-log | audit rows: register, agent.publish, campaign.start, contacts.import | audit-table |
| 15 | Operator | /settings/webhooks → test event to local receiver | signed delivery SUCCESS | e2e/webhooks.spec |
| 16 | Operator | /settings/data-rights → request export | COMPLETED + download link | e2e/gdpr.spec |
| 17 | Operator | CSV export from /calls | calls.csv downloads with today's rows | e2e/analytics.spec |

**Scripted rows 5–7 (exact commands):**
```bash
cd /root/vaani-ai
# row 5 — DID + resolver (assumes the wizard created a PUBLISHED agent in this workspace;
# for the demo workspace use guide 06 Step 22's setup instead)
SECRET=$(grep '^DOGRAH_WEBHOOK_SECRET=' .env | cut -d= -f2)
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"PhoneNumber\" (id, \"workspaceId\", number, label, \"agentId\") \
  SELECT 'pn_gp', w.id, '+918040009999', 'Golden line', a.id FROM \"Workspace\" w, \"Agent\" a \
  WHERE w.slug='demo-clinic' AND a.\"workspaceId\"=w.id AND a.status='PUBLISHED' LIMIT 1 ON CONFLICT DO NOTHING;"
curl -s -H "x-internal-secret: $SECRET" \
  "http://localhost:3000/api/v1/resolve-number?to=%2B918040009999&from=%2B919812345678"
# EXPECTED: {"ok":true,...,"workflowId":...}

# row 6 — signed call lifecycle
post() { BODY="$1"; SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}'); \
  curl -s -X POST http://localhost:3000/api/webhooks/dograh -H "Content-Type: application/json" \
  -H "x-dograh-signature: $SIG" -d "$BODY"; echo; }
post '{"event":"call.started","data":{"call_id":"gp_1","from_number":"+919812345678","to_number":"+918040009999"}}'
post '{"event":"call.ended","data":{"call_id":"gp_1","duration_seconds":150,"summary":"Booked Saturday 11 AM cleaning.","transcript":"AI: Namaste!\nCaller: Book me Saturday 11 AM.\nAI: Done, see you Saturday."}}'
sleep 10

# row 7 — DB proof
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, outcome, sentiment, \"billedPaise\" FROM \"Call\" WHERE \"dograhCallId\"='gp_1';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"totalScore\", \"maxScore\", \"scorerModel\" FROM \"QaScore\" q JOIN \"Call\" c ON c.id=q.\"callId\" WHERE c.\"dograhCallId\"='gp_1';"
```
**Expected:** `COMPLETED | <booked-ish> | <sentiment> | 294` and one QaScore row
(the QA_DRY_RUN mock: full marks minus 1 per criterion — guide 08).
**If billedPaise is 0:** the post-call billing didn't fire — check
`grep -i "billing" /tmp/next-dev.log`; see guide 13 §F3. Do not hand-edit the row
to make it pass.

**Golden Path = PASS only if all 17 rows match.** Record each row's result.

---

## Step 6: Live-call test scripts (REAL phone — production only, with operator)

Run after guide 12, when a real DID rings Dograh. The operator calls the DID from
a mobile and follows these scripts; the AI must behave as expected. These are
also your **demo scripts for selling to customers**.

**Script A — Receptionist FAQ (clinic agent):**

| Operator says | Expected AI response (paraphrase OK) |
|---|---|
| *(nothing — call connects)* | **Recording disclosure plays FIRST** (guide 06 config), then greeting within ~2s: "Namaste! Thank you for calling … how may I help?" |
| "What are your timings?" | "We're open 10 AM to 8 PM, Monday to Saturday." |
| "Where are you located?" | States the address from the prompt/KB |
| "Teeth cleaning ka charge kitna hai?" (Hinglish) | Answers in Hinglish/Hindi; only quotes a price present in the KB; if absent, says the clinic will confirm |
| "Do you do root canals?" | Does NOT give medical advice; offers to book a consultation |
| "Okay, book me for Saturday 11 AM" | Confirms name + phone number, confirms slot, summarizes the booking |
| "Thanks, bye" | Closes politely with a summary |

Pass criteria: ≥ 6/7 rows behave as expected; no >3s dead air; no invented prices.

**Script B — Language switching:**

| Operator says | Expected |
|---|---|
| "Hindi mein baat kariye" | Continues fully in Hindi |
| *(switch to English mid-call)* "Actually, English is fine" | Switches to English without losing context |

**Script C — Angry caller / escalation:**

| Operator says | Expected |
|---|---|
| "This is the third time I'm calling! Nobody helped me!" (angry tone) | Stays calm, apologizes, promises a manager callback; does NOT argue |
| "Stop calling me!" (in an outbound test) | Apologizes, ends call immediately; Hermes verifies `Contact.dnc = true` + `DncEntry` in DB afterwards |

**Script D — Outbound reminder (operator's own number in a 1-contact campaign,
`CAMPAIGN_DRY_RUN=false`):**

| Moment | Expected |
|---|---|
| Phone rings | DID shown on caller id |
| AI opening | Identifies as automated agent in the first sentence (compliance) |
| "Yes, I'll pay tomorrow" | Notes promise-to-pay; ends with summary |
| After call | /calls shows the call with outcome + recording + cost |

**Script E — Live ops on a real call (supervisor, needs 2 people):**

| Moment | Expected |
|---|---|
| Operator A calls the DID and stays on the line | /live shows the call row within ~5s with a rolling transcript |
| Operator B clicks **Listen** | Audio streams to B's browser (or the listen-mode indicator activates, per Dograh support — see OPERATOR GATE note if silent) |
| B types a whisper ("offer the 11 AM slot") and sends | `live-whisper-active` appears; the AI uses the hint within 1–2 turns (context whisper; mid-call audio injection is a Dograh gate — v2 backlog) |
| A asks "can I talk to a human?" | Transfer request appears in /transfers with context snapshot |
| B clicks **Accept** | Row moves to "Accepted by you"; A is connected to B (or the dial-out to the queue destination fires) |

**Script F — WhatsApp fallback (needs Vobiz WhatsApp access — OPERATOR GATE):**

| Moment | Expected |
|---|---|
| 1-contact campaign to the operator's number, no answer, `WHATSAPP_DRY_RUN=false` | The configured fallback template arrives on WhatsApp within ~2 min |
| If the gate is still open (no WhatsApp access) | `whatsAppMessage` row exists with status QUEUED/dry-run log line — record as GATE OPEN, move on |

**Script G — Recording disclosure:**

| Moment | Expected |
|---|---|
| Any call connects | The disclosure line (guide 06) is the FIRST audio the caller hears, before the greeting; audible and intelligible on a real phone |

Record results in the FINAL REPORT as `A: 6/7, B: PASS, C: PASS, D: PASS, E: 4/5, F: GATE OPEN, G: PASS`.

---

## Step 7: Performance & robustness spot-checks (Hermes)

```bash
# cold build size sanity
cd /root/vaani-ai && npm run build 2>&1 | tail -n 15
```
**Expected:** no route over ~300 kB first-load JS flagged red by Next (landing should
be well under).

**Webhook burst — script (also run against PROD in guide 12):**

**File `scripts/webhook-burst.sh`** (full content):

```bash
#!/usr/bin/env bash
# Webhook burst: 20 concurrent signed Dograh events must all get HTTP 200.
#   Usage: BASE_URL=http://localhost:3000 ./scripts/webhook-burst.sh
#   Prod:  BASE_URL=https://vaani.example.com ./scripts/webhook-burst.sh
set -u
BASE="${BASE_URL:-http://localhost:3000}"
cd "$(dirname "$0")/.."
SECRET=$(grep '^DOGRAH_WEBHOOK_SECRET=' .env | cut -d= -f2)
if [ -z "$SECRET" ]; then echo "DOGRAH_WEBHOOK_SECRET unset — cannot sign"; exit 1; fi
BODY='{"event":"call.ended","data":{"call_id":"burst_test","duration_seconds":10,"transcript":"x"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$BASE/api/webhooks/dograh" -H "Content-Type: application/json" \
  -H "x-dograh-signature: $SIG" -d "$BODY" | sort | uniq -c
```

```bash
cd /root/vaani-ai
chmod +x scripts/webhook-burst.sh
./scripts/webhook-burst.sh
```
(Dev server + a PhoneNumber/Call seeded for `burst_test`, or expect the tolerant
`{"ok":true, ignored:...}` path — either way HTTP 200. Idempotent dedupe in the
handler means repeats are safe.)
**Expected:** one line `     20 200` (twenty 200s). Clean up any test rows afterwards:
`docker exec vaani-db psql -U vaani -d vaani -c "DELETE FROM \"Call\" WHERE \"dograhCallId\"='burst_test';"`

**Playwright suite runtime:** the full E2E suite (Step 2) should complete in
≤ 12 minutes on the dev VPS. If it exceeds 15 min, check for a hanging dev server
(`tail -50 /tmp/next-dev.log`) before suspecting the specs.

---

## Step 8: The v2 backlog (record — do NOT build)

Everything shipped in v1 is proven above. What remains is post-launch work —
mostly OPERATOR GATES: features whose code/scaffolding is built and tested with
mocks, but which need a provider-side confirmation or credential the executor
cannot obtain. Each row names its owning guide and exactly what the human must
confirm to close it. Review this table at the acceptance meeting; every open row
is **planned, not forgotten**.

| # | Backlog item | Owning guide | What the operator must confirm / provide |
|---|---|---|---|
| 1 | SAML enterprise SSO via managed-provider bridge (WorkOS/Auth0) | 03 (Step 24) | Choose the managed provider; enterprise customer's IdP entry point, issuer, x509 cert. Scaffolding only today — no raw SAML SP by design. |
| 2 | Dograh knowledge-base API sync (push our KB docs into Dograh RAG) | 05 (KB steps) | Dograh docs: does a KB/vector-upload API exist? Until confirmed, operator mirrors KB text into the Dograh UI manually. |
| 3 | Dograh mid-call whisper **audio** injection (barge-style coach audio) | 06 | Dograh has no documented mid-call audio-splice API. Today: whisper = LLM context text (works). Confirm with Dograh before promising audio whisper. |
| 4 | Browser webRTC test-call widget | 05/06/10 | Dograh's browser call widget availability + route; wired behind `agent-test-call-btn` / wizard test-call step today. |
| 5 | Voice cloning (brand voice) | 04 (Step 18) | Sarvam Bulbul voice cloning is an enterprise feature — confirm access with Sarvam; scaffold flags `clonedVoiceId` already map through. |
| 6 | Speech-to-speech ultra-low-latency pipeline | 04 (Step 18) | Dograh speech-to-speech inference-provider support; config surface ships, no code path enabled. |
| 7 | BYOC (bring-your-own-carrier) provider-specific config | 04 | Vobiz BYOC SIP field names from Vobiz docs; only the generic scaffold ships. |
| 8 | Server-side PDF generation (invoices + full PDF reports) | 08/09 | Optional heavy dependency (e.g. Playwright/chromium print). Today: print-optimized pages (`invoice-print-button`, `call-report-print-hint`). |
| 9 | Google Sheets export OAuth enablement | 08 (Step 25) | Google Cloud service-account/OAuth consent; today the button is a no-op `not_configured` by design. |
| 10 | 4 stub CRM adapters: Salesforce, LeadSquared, Freshsales, Pipedrive | 05 (Step 13) | Per-provider OAuth app credentials + field mapping; adapters throw a clear "gate" error until then. HubSpot + Zoho are fully built. |
| 11 | 3 calendar providers: Microsoft 365, Calendly, Cal.com | 05 | Azure app registration / Calendly API key / Cal.com API key; Google Calendar ships fully. |
| 12 | Vobiz WhatsApp path + Meta/DLT template approval | 04/07 | Exact Vobiz WhatsApp endpoint path from Vobiz docs (`VOBIZ_WHATSAPP_PATH`), Meta Business approval, DLT template registration. Fallback code + dry-run ship today. |
| 13 | Razorpay tokenization → real auto top-up | 09 (Step 7) | Request tokenization via Razorpay dashboard → Settings → Configuration; until then `AUTOTOPUP_ENABLED=false` (dry-run only). |
| 14 | MCP per-tenant isolation | 04 | Dograh MCP is scoped to ONE Dograh organization — true per-tenant MCP needs one Dograh org per tenant or an upstream fix. Proxy + key gate ship today. |
| 15 | Converge guide 05/07 server actions onto `lib/api/resources.ts` | 08 (tech debt) | Internal refactor only — public API and server actions currently duplicate some query logic; no provider dependency, no user-visible change. |
| 16 | Full scheduled PDF reports (daily/weekly email with attachments) | 08 | Blocked on #8; email digests (HTML) ship today. |
| 17 | SRTP/TLS on the Vobiz SIP trunk | 04 | Enable in the Vobiz dashboard; `check-trunk.sh` verifies reachability either way. |
| 18 | Vobiz account-info endpoint path (trunk health probe) | 04 | If Vobiz documents a different account path, set the env override — `check-trunk.sh` false-alarms otherwise (see guide 13). |
| 19 | External uptime monitor feeding `/status` 30-day number | 12 | Create the monitor (UptimeRobot/BetterStack), set `STATUS_UPTIME_URL`; `/status` works live without it. |
| 20 | Public API SDK packages (npm) | 08 | npm account + package name; the OpenAPI conventions doc ships at /settings/api-docs. |
| 21 | Community template marketplace submissions + moderation | 05 | Post-launch product decision; in-house marketplace gallery ships today. |
| 22 | Dedicated enterprise VPC / air-gapped installs | 12 | Post-launch; the whole stack is already self-hosted Docker, so this is packaging + support, not code. |
| 23 | Predictive dialing beyond answer-rate adaptive pacing + AMD/voicemail detection tuning | 07 | Vobiz-side capabilities; adaptive pacing + AMD policy scaffold ship today. |

---

## Step 9: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 11: master vitest run, Playwright E2E suite, smoke + burst scripts, tenant audit, acceptance run"
```

---

## Acceptance Checklist (THE v1 GATE — mapped to readme.md)

Sign off section by section. Every item names its proof (suite/step/spec).
A "GATE" suffix means the code is built + mock-tested and the row tracks an open
v2-backlog OPERATOR GATE — acceptable for v1 sign-off only if the table in Step 8
records it.

### Suite-level gates (all must be green first)
- [ ] `npm test` — **50 files / 381 tests** pass (Step 1b) + schema smoke **33/33** (Step 1c)
- [ ] `npm run typecheck` + `npm run build` exit 0 (Step 1d)
- [ ] `npm run test:e2e` — zero failed (Step 2.19; Razorpay top-up spec may skip until `E2E_RAZORPAY_LIVE=1`; status.spec skips until guide 12, then MUST pass)
- [ ] `scripts/smoke-test.sh` → 30/30 dev (Step 3) and 34/34 prod after guide 12
- [ ] Tenant-isolation audit: greps clean + cross-tenant API test 0 leaks (Step 4)
- [ ] Golden Path 17/17 (Step 5)
- [ ] Webhook burst 20/20 HTTP 200, dev + prod (Step 7, guide 12 Step 13)
- [ ] Git commit `phase 11: ...` exists

### readme §3 — Multi-Tenancy & User Management
- [ ] Workspace isolation on every query path — Step 4a greps + Step 4b cross-tenant test
- [ ] Roles Owner/Admin/Manager/Agent/Viewer + permission matrix — `tests/permissions.test.ts` (12) + e2e/auth.spec RBAC negative (`members-forbidden`) + Step 4c scripted negatives (guides 05/06/07/08)
- [ ] Audit log of user actions — Golden Path row 14 (`audit-table`)
- [ ] White-label logo/colors — e2e/branding.spec + `tests/branding.test.ts` (8)
- [ ] Custom domains — `tests/domain-verify.test.ts` (9) + guide 12 on-demand TLS (prod)
- [ ] Email/password auth + sessions/device management/forced logout — e2e/auth.spec + guide 03 (`sessions-table`, `sessions-revoke-all` — manual spot check)
- [ ] Google SSO — guide 03 OAuth flow (manual with real Google client); OIDC/SAML — GATE (backlog #1)
- [ ] TOTP 2FA + single-use backup codes — `tests/totp.test.ts` (8) + e2e/auth.spec (enable → TOTP login → backup-code reuse fails)
- [ ] Scoped API keys + IP allowlisting — `tests/apikeys.test.ts` (11) + Step 4b (403 without scope)

### readme §4 — AI Agent Builder
- [ ] Template gallery → pre-filled editor → publish to Dograh — e2e/agent-lifecycle.spec + e2e/onboarding.spec
- [ ] Versioning: draft/publish/rollback/A-B traffic split — e2e/agent-lifecycle.spec + `tests/versions.test.ts` (4) + `tests/ab.test.ts` (6)
- [ ] Workflow definition build (nodes/edges → Dograh) — `tests/workflow-builder.test.ts` (12)
- [ ] Voice selection + per-language mapping; LLM per agent — `tests/voices.test.ts` (6) + editor selects (guide 05)
- [ ] Knowledge base: FAQ/URL/file upload → INDEXED → per-agent scoping + guardrails — e2e/knowledge.spec + schema smoke checks 8–11; Dograh-side RAG sync GATE (backlog #2)
- [ ] Mid-call tools (calendar/CRM/webhook/transfer/message) — `tests/tool-configs.test.ts` (6) + guide 05/06 scripted sims
- [ ] Test-in-browser webRTC call — GATE (backlog #4)
- [ ] Marketplace template gallery — guide 05 (`marketplace-publish-btn`, manual); community submissions GATE (backlog #21)

### readme §5 — Inbound Calling (AI Receptionist)
- [ ] Number → agent assignment + resolver contract — Golden Path rows 5–7 + guide 06 T1–T3
- [ ] Smart greeting (business hours, returning caller, holidays) — `tests/greeting.test.ts` (16)
- [ ] Spam/robocall filtering (fail-open design) — `tests/spamFilter.test.ts` (8) + guide 06 T3
- [ ] Opt-out honored instantly → DNC cascade — e2e/opt-out.spec
- [ ] Missed-call auto-callback task + dial job — `tests/dialJobs.test.ts` (4) + guide 06 Step 22
- [ ] Voicemail capture + staff notify — guide 06 (dry-run envs) — GATE on real WhatsApp (backlog #12)
- [ ] After-call: transcript + summary + outcome + webhook fan-out — e2e/analytics.spec + e2e/webhooks.spec
- [ ] 24/7 + unlimited concurrency — architectural (one Dograh run per call, guide 06 Step 1); burst test Step 7

### readme §6 — Outbound Calling (AI Telecaller)
- [ ] CSV upload w/ validation + dedupe + DNC scrub — e2e/campaigns.spec + `tests/csv.test.ts` (5) + `tests/campaign-phone.test.ts` (6)
- [ ] Timezone windows / business hours / day-of-week — `tests/campaign-windows.test.ts` (10)
- [ ] Retry logic per disposition — `tests/campaign-retry.test.ts` (11)
- [ ] Adaptive pacing + concurrency caps — `tests/campaign-pacing.test.ts` (9); predictive GATE (backlog #23)
- [ ] Number pool rotation + TRAI 140/1600 compliance — `tests/campaign-pool-compliance.test.ts` (9)
- [ ] Interest scoring (hot/warm/cold) — `tests/campaign-scoring.test.ts` (11)
- [ ] Live campaign control: pause/resume, mid-flight script edit — e2e/campaigns.spec
- [ ] WhatsApp template campaigns + call-to-WhatsApp fallback — `tests/campaign-fallback.test.ts` (2) + guide 07 UI; live send GATE (backlog #12)

### readme §7 — Human-in-the-Loop & Live Operations
- [ ] Live dashboard with real-time transcript — e2e/live-ops.spec + `tests/liveState.test.ts` (11)
- [ ] Whisper (context injection) — e2e/live-ops.spec; mid-call audio GATE (backlog #3)
- [ ] Listen/barge — `live-listen-btn`/`live-barge-btn` + Script E (prod); Dograh capability GATE (backlog #3)
- [ ] Transfer queue with context snapshot → accept — e2e/live-ops.spec + Script E
- [ ] Fallback policies (low confidence / explicit human / VIP) — `tests/fallbackPolicy.test.ts` (12)
- [ ] Web dialer — guide 06 /dialer UI (manual spot check: `dialer-pad` renders); browser audio GATE (backlog #4)

### readme §8 — Analytics, Reporting & Quality
- [ ] Real-time tiles (ASR/AHT/concurrency/cost) — e2e/analytics.spec (`tile-*`) + `tests/analytics.test.ts` (12)
- [ ] CDR with recording/transcript/summary/entities/sentiment/outcome/cost — e2e/analytics.spec (call detail) + Golden Path row 8
- [ ] AI QA auto-scoring vs rubric — `tests/qa.test.ts` (10) + e2e/analytics.spec (`call-qa-score`, QA_DRY_RUN mock; prod flips `QA_DRY_RUN=false`)
- [ ] Dead-air + hallucination flags — `tests/deadair.test.ts` (5) + flags on call detail
- [ ] Transcript full-text search — `tests/fts.test.ts` (4) + e2e/analytics.spec (`calls-fts-count`)
- [ ] PII redaction — `tests/pii.test.ts` (8)
- [ ] CSV exports + scheduled email digests — `tests/csv.test.ts` + `tests/digest.test.ts` (6) + e2e download; PDF reports GATE (backlog #8/#16)
- [ ] Cost/margin analytics per tenant/agent/campaign — Golden Path row 13 (`tile-margin*`)

### readme §9 — Integrations & Extensibility
- [ ] CRM: HubSpot + Zoho (OAuth + two-way sync + field mapping) — `tests/hubspot.test.ts` (4) + `tests/crm-mapping.test.ts` (5) (mock-tested); 4 more adapters GATE (backlog #10)
- [ ] Calendars: Google — `tests/tool-configs.test.ts` + guide 05 OAuth; M365/Calendly/Cal.com GATE (backlog #11)
- [ ] Signed outbound webhooks with retries (8 attempts) — `tests/webhook-sign.test.ts` (5) + e2e/webhooks.spec (SUCCESS 200)
- [ ] Public REST API v1 (agents/campaigns/contacts/calls/numbers) + rate limits — `tests/api-schemas.test.ts` (7) + `tests/ratelimit.test.ts` (4) + Step 4b
- [ ] MCP server proxy — smoke `mcp 401` checks + guide 04; per-tenant isolation GATE (backlog #14)
- [ ] WhatsApp Business — GATE (backlog #12); Google Sheets/Zapier recipes — GATE (backlog #9, docs ship at /settings/api-docs)

### readme §10 — Billing & Monetization
- [ ] Plans Starter/Growth/Enterprise + feature gates — `tests/feature-gates.test.ts` (7) + e2e/billing.spec (upgrade)
- [ ] Per-second metering telephony+STT+LLM+TTS with markup — `tests/billing-ratecard.test.ts` (13) + `tests/money.test.ts` (9) + Golden Path `billedPaise=294`
- [ ] Wallet + Razorpay top-up (test mode) — guide 09 webhook simulation + e2e/billing.spec (UI top-up gated `E2E_RAZORPAY_LIVE`)
- [ ] Stripe top-up (test mode) — `tests/stripe-sig.test.ts` (5) + guide 09 flow
- [ ] Low-balance alerts (banner + email + webhook event) — e2e/billing.spec (banner) + guide 09 scripted
- [ ] Auto top-up — `tests/addons-autotopup-reseller.test.ts` (8, dry-run); tokenization GATE (backlog #13)
- [ ] GST invoices (CGST/SGST/IGST, HSN 998314) — `tests/invoice.test.ts` (9) + e2e/billing.spec (`invoice-table`)
- [ ] Free trial ₹1,000 + KYC gate — `tests/onboarding.test.ts` (11) + e2e/kyc.spec
- [ ] Number rental passthrough — guide 09 (`rental-table`, manual spot check)
- [ ] Reseller panel + wholesale rate cards — `tests/addons-autotopup-reseller.test.ts` + guide 09 (`ratecard-editor`, `reseller-*`, manual spot check)

### readme §11 — Compliance, Security & Trust
- [ ] DNC registry scrubbing + instant opt-out — e2e/opt-out.spec + `tests/campaign-pool-compliance.test.ts`
- [ ] Permitted calling hours enforcement — `tests/campaign-windows.test.ts`
- [ ] Recording disclosure first — Script G (prod) + guide 06 workflow config
- [ ] GDPR export + erasure + retention policies — e2e/gdpr.spec + `tests/retention.test.ts` (2) + guide 08 scripted erasure
- [ ] PII redaction in transcripts — `tests/pii.test.ts`
- [ ] TLS everywhere / signed webhooks / hashed API keys — guide 12 + `tests/webhook-sign.test.ts` + `tests/apikeys.test.ts`
- [ ] Status page + audit trails — e2e/status.spec (post-12) + Golden Path row 14
- [ ] Data sovereignty (self-hosted stack) — architectural; enterprise VPC GATE (backlog #22)

### readme §12 — Reliability & Scale
- [ ] Idempotent webhooks under burst — Step 7 (`webhook-burst.sh` 20/20, dev + prod)
- [ ] Queue-based workers with backpressure + retry — guide 07 suites + worker logs (Golden Path row 11)
- [ ] Health endpoint + alerting + forced-failure paging — guide 12 Steps 1/7/8 (prod gate)
- [ ] Backups + restore drill + log rotation — guide 12 Step 8 (prod gate)
- [ ] LLM failover across providers — OpenRouter routing (config, guide 04); mid-call failover is provider-side

### readme §13 — Onboarding & Self-Serve UX
- [ ] Sign up → workspace + trial credits — e2e/auth.spec + e2e/billing.spec (`₹1,000.00`)
- [ ] Guided wizard industry → template → KB → test call → number → live — e2e/onboarding.spec
- [ ] Brand-new workspaces force-redirect to wizard; partial ones get checklist — e2e/auth.spec + `tests/onboarding.test.ts`
- [ ] In-app checklist + sample data mode — e2e/sample-data.spec + `tests/sample-data.test.ts` (7)
- [ ] KYC upload for regulated series — e2e/kyc.spec + `tests/domain-verify.test.ts` covers domain side

---

## FINAL REPORT format

```
STEP 1..9: PASS/FAIL — <evidence>
UNIT: <files passed>/50 files, <tests passed>/381 tests
SCHEMA SMOKE: <n>/33
E2E: <n passed, n skipped, n failed> — skips: <which + why>
SMOKE: dev=<n passed, n failed> (prod run happens in guide 12)
TENANT AUDIT: greps=<clean/issues> cross-tenant=<0 leaks/LEAK>
GOLDEN PATH: 17/17 or list failed rows
LIVE CALLS: A x/7, B, C, D, E x/5, F, G (or DEFERRED to post-12 — reason)
BURST: dev=<n/20>
V2 BACKLOG: acknowledged <n rows>; gates closed during this run: <list>
ACCEPTANCE: <n>/<total> checked; open GATE rows: <backlog #s>
NOTES: <deviations>
```
