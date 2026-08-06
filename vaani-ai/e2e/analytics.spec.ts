import { test, expect } from "@playwright/test";
import { loginDemo, postDograhEvent, psql, seedTestDid } from "./helpers";

test.describe("analytics + QA + exports (guide 08)", () => {
  test("completed call → transcript FTS → QA badge → cost card → CSV export", async ({ page }) => {
    const token = `zebracorn${Date.now()}`;
    const callId = `e2e_an_${Date.now()}`;
    seedTestDid(); // webhook handler needs the DID mapped (else it 200-ignores)

    await loginDemo(page);
    // Simulate a completed call whose transcript contains a unique token.
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: "+919812345678", to_number: "+918040001234" },
    });
    const ended = await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 150,
        summary: `Booked a cleaning; token ${token}.`,
        transcript: `AI: Namaste!\nCaller: ${token} — I want a cleaning on Saturday.\nAI: Booked for Saturday 11 AM.`,
      },
    });
    expect(ended.status).toBe(200);

    // Transcript full-text search finds exactly this call.
    await page.goto("/calls");
    await page.getByTestId("calls-transcript-search").fill(token);
    await page.getByTestId("calls-transcript-search").press("Enter");
    await expect(page.getByTestId("calls-fts-count")).toContainText("1 call(s)", { timeout: 15_000 });

    // Open the call: transcript, cost card, and (async, QA_DRY_RUN mock) QA badge.
    const dbId = psql(`SELECT id FROM "Call" WHERE "dograhCallId"='${callId}';`);
    await page.goto(`/calls/${dbId}`);
    await expect(page.getByTestId("call-transcript")).toContainText(token);
    await expect(page.getByTestId("call-cost-card")).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("call-qa-score")).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [5_000] });

    // CSV export downloads (authenticated route).
    await page.goto("/calls");
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-calls-csv").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("calls");

    // Analytics dashboard tiles render.
    await page.goto("/analytics");
    await expect(page.getByTestId("tile-total-calls")).toBeVisible();
    await expect(page.getByTestId("chart-calls-per-day")).toBeVisible();
  });
});
