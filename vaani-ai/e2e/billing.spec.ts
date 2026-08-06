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
