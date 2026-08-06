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
  return sh(`echo ${JSON.stringify(sql)} | docker exec -i vaani-db psql -U vaani -d vaani -tA`);
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
    // Cached session is valid only if the app shell renders (not a login redirect).
    if (!page.url().includes("/login")) {
      await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 15_000 });
      return;
    }
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
  // The Continue button appears once an agent exists (create+publish can take a
  // few seconds). It re-renders when the publish completes — wait for it to be
  // enabled and stable before clicking.
  if (await tplNext.isVisible().catch(() => false)) {
    await expect(tplNext).toBeEnabled({ timeout: 30_000 });
    await tplNext.click();
  }
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
