import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";

test.describe("knowledge base (guide 05)", () => {
  test("paste FAQ text → document appears with INDEXED status", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/knowledge");

    const title = `E2E FAQ ${Date.now()}`;
    await page.locator('form:has([data-testid="kb-faq-btn"]) input[name="title"]').fill(title);
    await page
      .locator('form:has([data-testid="kb-faq-btn"]) textarea[name="contentText"]')
      .fill("Q: What are the clinic timings?\nA: 10 AM to 8 PM, Monday to Saturday.");
    await page.getByTestId("kb-faq-btn").click();

    // Text docs index synchronously (text lives in our DB — guide 05).
    const row = page.locator("div", { hasText: title }).last();
    await expect(page.locator('[data-testid^="kb-status-"]', { hasText: "INDEXED" }).first())
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(title)).toBeVisible();
  });
});
