import { test, expect } from "@playwright/test";
import { authenticator } from "otplib";
import { logoutViaUi, registerFreshWorkspace } from "./helpers";

/**
 * 2FA edge cases (AUTH-17, AUTH-19 from docs/manual-testing/01).
 *
 * AUTH-17: a wrong 6-digit TOTP at login must show "Invalid code." and NOT
 * create a session (the pending-token step stays up).
 * AUTH-19: disabling 2FA from Settings → Security requires the current password;
 * afterwards the login flow skips the TOTP step entirely.
 */
test.describe("2FA edge cases (AUTH-17, AUTH-19)", () => {
  async function enable2fa(page: Parameters<typeof registerFreshWorkspace>[0]): Promise<string> {
    await page.goto("/settings/security");
    await page.getByTestId("totp-enroll-start").click();
    await expect(page.getByTestId("totp-qr")).toBeVisible();
    const secret = (await page.getByTestId("totp-secret").innerText()).trim();
    await page.getByTestId("totp-confirm-input").fill(authenticator.generate(secret));
    await page.getByTestId("totp-confirm-submit").click();
    await expect(page.getByTestId("totp-backup-codes")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("totp-backup-codes").getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("totp-status")).toContainText("Enabled");
    return secret;
  }

  test("AUTH-17: wrong TOTP code at login shows Invalid code and no session", async ({ page }) => {
    const { email, password } = await registerFreshWorkspace(page, "2fa-wrong");
    const secret = await enable2fa(page);

    // Log out, then attempt login with a deliberately wrong code.
    await logoutViaUi(page);
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill(email);
    await page.getByTestId("login-password-input").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-totp-form")).toBeVisible();

    await page.getByTestId("login-totp-input").fill("000000");
    await page.getByTestId("login-totp-submit").click();
    await expect(page.getByTestId("login-error")).toHaveText("Invalid code.");
    // Still on the TOTP step — no session was created.
    await expect(page.getByTestId("login-totp-form")).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "vaani_session")).toBeUndefined();

    // A correct code on the retry still works (pending token is one-shot but
    // the user can retry the step — the code itself is what failed).
    // input-otp doesn't fully replace a previous value on fill() — clear first.
    await page.getByTestId("login-totp-input").fill("");
    await page.getByTestId("login-totp-input").fill(authenticator.generate(secret));
    await page.getByTestId("login-totp-submit").click();
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });
  });

  test("AUTH-19: disable 2FA with password, then login skips the TOTP step", async ({ page }) => {
    const { email, password } = await registerFreshWorkspace(page, "2fa-disable");
    const secret = await enable2fa(page);

    // Disable from Settings → Security, confirming with the current password.
    await page.goto("/settings/security");
    await page.getByTestId("totp-disable-password").fill(password);
    await page.getByTestId("totp-disable-button").click();
    await expect(page.getByTestId("totp-status")).toContainText("Disabled", { timeout: 15_000 });
    // The Enable button is back — enrollment can be started again.
    await expect(page.getByTestId("totp-enroll-start")).toBeVisible();

    // Future logins skip TOTP entirely.
    await logoutViaUi(page);
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill(email);
    await page.getByTestId("login-password-input").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });
    await expect(page.getByTestId("login-totp-form")).toHaveCount(0);
  });
});
