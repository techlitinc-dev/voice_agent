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
