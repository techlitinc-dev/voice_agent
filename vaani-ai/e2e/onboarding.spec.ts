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
