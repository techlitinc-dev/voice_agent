import { test, expect } from "@playwright/test";

/**
 * Login negative cases (AUTH-06…07 from docs/manual-testing/01).
 *
 * AUTH-06: wrong password → "Invalid email or password".
 * AUTH-07: non-existent email → the SAME message (no user enumeration).
 * Both must stay on /login with no session cookie minted.
 */
test.describe("login errors (AUTH-06…07)", () => {
  test("AUTH-06: wrong password shows the generic error and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("owner@test.vaani.ai");
    await page.getByTestId("login-password-input").fill("wrongpass");
    await page.getByTestId("login-submit").click();

    await expect(page.getByTestId("login-error")).toHaveText("Invalid email or password.");
    await expect(page).toHaveURL(/\/login/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "vaani_session")).toBeUndefined();
  });

  test("AUTH-07: unknown email gets the identical message (no enumeration)", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("nobody@test.vaani.ai");
    await page.getByTestId("login-password-input").fill("whatever");
    await page.getByTestId("login-submit").click();

    // Same wording as AUTH-06 — an attacker cannot distinguish the two.
    await expect(page.getByTestId("login-error")).toHaveText("Invalid email or password.");
    await expect(page).toHaveURL(/\/login/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "vaani_session")).toBeUndefined();
  });
});
