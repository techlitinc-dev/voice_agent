import { test, expect, request } from "@playwright/test";

test.describe("public status page (guide 12)", () => {
  test("logged-out /status renders; /api/health answers JSON", async ({ browser, baseURL }) => {
    // Probe first (no cookies): skip cleanly until guide 12 ships the route.
    const probeCtx = await request.newContext({ baseURL });
    const probe = await probeCtx.get("/status");
    const missing = probe.status() === 404;
    await probeCtx.dispose();
    test.skip(missing, "/status ships in guide 12 — re-run the suite after guide 12");

    // Unauthenticated browser render (fresh context = no cookies).
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/status");
    await expect(page.getByTestId("status-page")).toBeVisible();
    await expect(page.getByTestId("status-banner")).toBeVisible();
    await expect(page.getByTestId("status-uptime")).toBeVisible();

    const health = await page.request.get("/api/health");
    expect(health.status()).toBe(200);
    const json = await health.json();
    expect(["ok", "degraded"]).toContain(json.status);
    expect(json.checks.db).toBe(true);
    await context.close();
  });
});
