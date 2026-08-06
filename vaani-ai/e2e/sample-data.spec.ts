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
