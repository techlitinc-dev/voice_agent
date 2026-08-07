import { test, expect } from "@playwright/test";
import { loginDemo, psql, sh } from "./helpers";

test.describe("event webhooks (guide 08)", () => {
  test("create subscription → send test event → signed SUCCESS delivery", async ({ page }) => {
    await loginDemo(page);

    // 1. Create a subscription via the UI. Clear any residual subscriptions for
    //    the test URL first so the strict-mode table locator matches exactly one row.
    psql(`DELETE FROM "WebhookDelivery" WHERE "subscriptionId" IN
      (SELECT id FROM "WebhookSubscription" WHERE url='http://localhost:4777/hook');`);
    psql(`DELETE FROM "WebhookSubscription" WHERE url='http://localhost:4777/hook';`);
    await page.goto("/settings/webhooks");
    await page.getByTestId("webhook-url-input").fill("http://localhost:4777/hook");
    await page.locator('input[name="events"]').first().check();
    await page.getByTestId("webhook-create-button").click();
    const row = page.locator('[data-testid="webhook-sub-table"] tr', { hasText: "localhost:4777" });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // 2. The table shows the generated secret — point the receiver at it.
    const secret = (await row.locator("td").nth(2).innerText()).trim();
    expect(secret.length).toBeGreaterThan(8);
    sh("pkill -f '[w]ebhook-receiver' || true");
    sh(`(RECEIVER_SECRET=${secret} npx tsx scripts/webhook-receiver.ts > /tmp/e2e-webhook.log 2>&1 &)`);
    await new Promise((r) => setTimeout(r, 3000));

    // 3. Send the test event from the UI; the worker delivers it.
    const subId = psql(
      `SELECT id FROM "WebhookSubscription" WHERE url='http://localhost:4777/hook' ORDER BY "createdAt" DESC LIMIT 1;`
    );
    await page.getByTestId(`webhook-test-${subId}`).click();

    // 4. Receiver saw a VALIDLY signed test.ping; delivery row → SUCCESS 200.
    await expect(async () => {
      const log = sh("cat /tmp/e2e-webhook.log");
      expect(log).toContain("event=test.ping signature_valid=true");
    }).toPass({ timeout: 60_000, intervals: [5_000] });
    await expect(async () => {
      const status = psql(
        `SELECT status FROM "WebhookDelivery" WHERE "subscriptionId"='${subId}' ORDER BY "createdAt" DESC LIMIT 1;`
      );
      expect(status).toBe("SUCCESS");
    }).toPass({ timeout: 60_000, intervals: [5_000] });
    sh("pkill -f '[w]ebhook-receiver' || true");
  });
});
