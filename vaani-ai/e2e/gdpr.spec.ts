import { test, expect } from "@playwright/test";
import { loginDemo, psql } from "./helpers";

test.describe("GDPR data rights (guide 08)", () => {
  test("request workspace export → COMPLETED → download link", async ({ page }) => {
    test.setTimeout(240_000); // the worker cron ticks ~60s
    await loginDemo(page);

    await page.goto("/settings/data-rights");
    await page.getByTestId("gdpr-export-button").click(); // empty phone = whole workspace
    await expect(page.getByTestId("gdpr-requests-table")).toContainText("EXPORT", { timeout: 15_000 });

    const reqId = psql(
      `SELECT r.id FROM "GdprRequest" r JOIN "Workspace" w ON w.id=r."workspaceId"
       WHERE w.slug='demo-clinic' AND r.type='EXPORT' ORDER BY r."createdAt" DESC LIMIT 1;`
    );

    // Worker cron processes the request; the table then offers a download.
    await expect(async () => {
      const status = psql(`SELECT status FROM "GdprRequest" WHERE id='${reqId}';`);
      expect(status).toBe("COMPLETED");
    }).toPass({ timeout: 200_000, intervals: [10_000] });

    await page.goto("/settings/data-rights");
    await expect(page.getByTestId(`gdpr-download-${reqId}`)).toBeVisible({ timeout: 15_000 });
  });
});
