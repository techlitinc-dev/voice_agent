import { test, expect } from "@playwright/test";

/**
 * Registration edge cases (AUTH-02…04 from docs/manual-testing/01).
 * AUTH-01 (happy path) is covered by auth.spec.ts via registerFreshWorkspace.
 */
test.describe("registration edge cases (AUTH-02…04)", () => {
  test("AUTH-02: register with an existing email shows the duplicate error", async ({ page }) => {
    await page.goto("/register");
    await page.getByTestId("register-name-input").fill("Existing User");
    await page.getByTestId("register-business-input").fill("Test Co");
    await page.getByTestId("register-email-input").fill("owner@test.vaani.ai");
    await page.getByTestId("register-password-input").fill("Test@1234!");
    await page.getByTestId("register-submit").click();
    await expect(page.getByTestId("register-error")).toHaveText(
      /An account with this email already exists/
    );
    // The form also offers a login link for the duplicate case.
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
    // Still on /register — no session was created.
    await expect(page).toHaveURL(/\/register/);
  });

  test("AUTH-03: weak password shows a validation error and does not submit", async ({ page }) => {
    await page.goto("/register");
    await page.getByTestId("register-name-input").fill("Weak Pass User");
    await page.getByTestId("register-business-input").fill("Weak Co");
    await page.getByTestId("register-email-input").fill(`weak-${Date.now()}@test.dev`);
    await page.getByTestId("register-password-input").fill("123");
    await page.getByTestId("register-submit").click();
    await expect(page.getByTestId("register-password-error")).toHaveText(
      /Password must be at least 8 characters/
    );
    // The client-side gate blocks submission — no server round-trip → still on /register.
    await expect(page).toHaveURL(/\/register/);
  });

  test("AUTH-04: invalid email shows a validation error and does not submit", async ({ page }) => {
    await page.goto("/register");
    await page.getByTestId("register-name-input").fill("Bad Email User");
    await page.getByTestId("register-business-input").fill("Bad Co");
    await page.getByTestId("register-email-input").fill("notanemail");
    await page.getByTestId("register-password-input").fill("Test@1234!");
    await page.getByTestId("register-submit").click();
    await expect(page.getByTestId("register-email-error")).toHaveText(
      /Enter a valid email address/
    );
    await expect(page).toHaveURL(/\/register/);
  });
});
