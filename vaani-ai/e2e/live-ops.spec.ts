import { test, expect } from "@playwright/test";
import { loginDemo, psql, sh } from "./helpers";

test.describe("live ops / HITL (guide 06)", () => {
  test.beforeEach(() => {
    sh("npx tsx scripts/e2e-seed-live.ts"); // deterministic LIVE call + QUEUED transfer
  });

  test("live dashboard shows in-progress call → whisper coach → transfer accept", async ({ page }) => {
    await loginDemo(page);

    // Live dashboard: seeded in-progress call appears.
    await page.goto("/live");
    await expect(page.getByTestId("live-dashboard")).toBeVisible();
    await expect(page.getByTestId("live-call-row").first()).toBeVisible({ timeout: 15_000 });

    // Whisper: type coach text → send → whisper-active indicator appears.
    await page.getByTestId("live-whisper-input").first().fill("Offer the Saturday 11 AM slot.");
    await page.getByTestId("live-whisper-send").first().click();
    await expect(page.getByTestId("live-whisper-active").first()).toBeVisible({ timeout: 15_000 });

    // Transfer queue: accept the seeded request → lands in "accepted" list.
    await page.goto("/transfers");
    await expect(page.getByTestId("transfer-queue-row").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("transfer-context").first()).toBeVisible();
    await page.getByTestId("transfer-accept-btn").first().click();
    await expect(page.getByTestId("transfer-accepted-row").first()).toBeVisible({ timeout: 15_000 });

    // DB proof: transfer accepted by the demo user.
    const accepted = psql(
      `SELECT count(*) FROM "TransferRequest" WHERE status='ACCEPTED' AND "acceptedByUserId" IS NOT NULL;`
    );
    expect(Number(accepted)).toBeGreaterThanOrEqual(1);
  });

  test("negative: whisper input requires an in-progress call (empty state otherwise)", async ({ page }) => {
    psql(`DELETE FROM "LiveCallState";`);
    await loginDemo(page);
    await page.goto("/live");
    await expect(page.getByTestId("live-empty")).toBeVisible({ timeout: 15_000 });
  });
});
