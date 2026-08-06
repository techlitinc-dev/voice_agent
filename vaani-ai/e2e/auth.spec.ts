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
