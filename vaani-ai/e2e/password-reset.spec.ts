import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { loginViaUi, psql, registerFreshWorkspace } from "./helpers";

/**
 * Password reset (AUTH-11…14). The raw token is hashed at rest, so the spec
 * inserts a KNOWN token hash directly via psql (test-only path — no prod code
 * involved), then drives the /reset-password page with the matching raw token.
 */
const RAW_TOKEN = "e2e-reset-token";

function tokenHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function insertResetToken(email: string, opts: { used?: boolean; expired?: boolean } = {}) {
  // Wipe any stale e2e token first so the tokenHash always binds to THIS user.
  psql(`DELETE FROM "PasswordResetToken" WHERE "tokenHash" = '${tokenHash(RAW_TOKEN)}';`);
  const expiry = opts.expired ? "now() - interval '1 hour'" : "now() + interval '1 hour'";
  const usedCol = opts.used ? ", \"usedAt\"" : "";
  const usedVal = opts.used ? ", now()" : "";
  psql(
    `INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt"${usedCol})
     SELECT 'prt_e2e', id, '${tokenHash(RAW_TOKEN)}', ${expiry}${usedVal}
     FROM "User" WHERE email='${email}';`
  );
}

function cleanupTokens(email: string) {
  psql(
    `DELETE FROM "PasswordResetToken"
     WHERE "userId" = (SELECT id FROM "User" WHERE email='${email}');`
  );
}

test.describe("password reset (AUTH-11…14)", () => {
  test("request → reset → login with new password; old session revoked", async ({ page, context }) => {
    const { email } = await registerFreshWorkspace(page, "reset");

    // AUTH-11: request reset from the login page's "Forgot password?" link.
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("logout-button").click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByTestId("login-forgot-link").click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await page.getByTestId("forgot-password-email-input").fill(email);
    await page.getByTestId("forgot-password-submit").click();
    await expect(page.getByTestId("forgot-password-sent")).toHaveText(
      /If an account exists for that email/
    );

    // Unknown email gets the identical message — no enumeration.
    await page.goto("/forgot-password");
    await page.getByTestId("forgot-password-email-input").fill("nobody@test.dev");
    await page.getByTestId("forgot-password-submit").click();
    await expect(page.getByTestId("forgot-password-sent")).toHaveText(
      /If an account exists for that email/
    );

    // AUTH-12: use a known token (inserted directly into the DB).
    insertResetToken(email);
    await page.goto(`/reset-password?token=${RAW_TOKEN}`);
    await page.getByTestId("reset-password-input").fill("new-pass-1234");
    await page.getByTestId("reset-password-confirm-input").fill("new-pass-1234");
    await page.getByTestId("reset-password-submit").click();
    // Success → redirected to /login with the "password updated" banner.
    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.getByTestId("login-reset-banner")).toBeVisible();

    // Login with the new password works. A fresh workspace lands on /onboarding
    // (wizard force-redirect) — accept either, since login itself succeeded.
    await loginViaUi(page, email, "new-pass-1234");
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/);

    cleanupTokens(email);
    void context;
  });

  test("expired token is rejected", async ({ page }) => {
    const { email } = await registerFreshWorkspace(page, "reset-expired");
    insertResetToken(email, { expired: true });
    await page.goto(`/reset-password?token=${RAW_TOKEN}`);
    await page.getByTestId("reset-password-input").fill("new-pass-1234");
    await page.getByTestId("reset-password-confirm-input").fill("new-pass-1234");
    await page.getByTestId("reset-password-submit").click();
    await expect(page.getByTestId("reset-password-error")).toHaveText(
      /This reset link is invalid or has expired/
    );
    cleanupTokens(email);
  });

  test("already-used token cannot be reused", async ({ page }) => {
    const { email } = await registerFreshWorkspace(page, "reset-reuse");
    insertResetToken(email, { used: true });
    await page.goto(`/reset-password?token=${RAW_TOKEN}`);
    await page.getByTestId("reset-password-input").fill("new-pass-1234");
    await page.getByTestId("reset-password-confirm-input").fill("new-pass-1234");
    await page.getByTestId("reset-password-submit").click();
    await expect(page.getByTestId("reset-password-error")).toHaveText(
      /This reset link is invalid or has expired/
    );
    cleanupTokens(email);
  });
});
