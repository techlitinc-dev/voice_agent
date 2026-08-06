import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";
import { writeFileSync } from "node:fs";

test.describe("outbound campaigns (guide 07)", () => {
  test("CSV upload → campaign create → start → live status → mid-flight edit → pause", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();

    // 1. CSV upload (3 valid mobiles)
    const csvPath = `/tmp/e2e-contacts-${tag}.csv`;
    writeFileSync(
      csvPath,
      "phone,name\n+919700000001,E2E One\n+919700000002,E2E Two\n+919700000003,E2E Three\n"
    );
    await page.goto("/contacts");
    await page.getByTestId("list-name-input").fill(`E2E list ${tag}`);
    await page.getByTestId("csv-file-input").setInputFiles(csvPath);
    await page.getByTestId("csv-import-submit").click();
    await expect(page.getByTestId("csv-import-result")).toContainText("3", { timeout: 15_000 });

    // 2. New campaign on that list, wide window, dry-run worker dials it
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign-button").click();
    await page.getByTestId("campaign-name-input").fill(`E2E campaign ${tag}`);
    await page.getByTestId("agent-select").selectOption({ index: 1 });
    await page.getByTestId("list-select").selectOption({ label: `E2E list ${tag}` });
    await page.getByTestId("window-start-input").fill("00:00");
    await page.getByTestId("window-end-input").fill("23:59");
    await page.getByTestId("cpm-input").fill("60");
    await page.getByTestId("create-campaign-submit").click();

    // 3. Start → RUNNING (the start button is resume-button on a DRAFT campaign)
    await expect(page.getByTestId("campaign-detail")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("resume-button").click();
    await expect(page.getByTestId("campaign-status-pill")).toHaveText("RUNNING", { timeout: 15_000 });

    // 4. Live status rows as the dry-run worker dials (polls; allow 60s)
    await expect(page.getByTestId("live-status-table")).toBeVisible();
    await expect(async () => {
      await page.reload();
      const rows = await page.getByTestId("live-status-row").count();
      expect(rows).toBeGreaterThan(0);
    }).toPass({ timeout: 60_000, intervals: [5_000] });

    // 5. Mid-flight script edit (guide 07: edit while RUNNING)
    await page.getByTestId("edit-opening-hook").fill(`E2E hook edited ${tag}`);
    await page.getByTestId("edit-script-submit").click();
    await expect(page.getByTestId("edit-script-card")).toContainText(`E2E hook edited ${tag}`, {
      timeout: 15_000,
    });

    // 6. Pause
    await page.getByTestId("pause-button").click();
    await expect(page.getByTestId("campaign-status-pill")).toHaveText("PAUSED", { timeout: 15_000 });
  });
});
