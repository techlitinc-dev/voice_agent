import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";
import { writeFileSync } from "node:fs";

// 1×1 px PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.describe("branding / white-label (guide 10)", () => {
  test("primary color change reflects in layout; logo shows in sidebar", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/settings/branding");
    await expect(page.getByTestId("branding-page")).toBeVisible();

    // Color: set a distinctive hex → the app layout injects --primary HSL.
    await page.getByTestId("branding-color-hex").fill("#ff0055");
    await page.getByTestId("branding-color-save").click();
    await page.goto("/dashboard");
    await expect(page.getByTestId("brand-style")).toHaveText(/--primary:\s*3\d\d/, { timeout: 15_000 });

    // Logo upload → sidebar <img data-testid="app-logo"> on next load.
    const logoPath = "/tmp/e2e-logo.png";
    writeFileSync(logoPath, Buffer.from(PNG_B64, "base64"));
    await page.goto("/settings/branding");
    await page.getByTestId("branding-logo-input").setInputFiles(logoPath);
    await page.getByTestId("branding-logo-upload").click();
    await expect(page.getByTestId("branding-logo-preview")).toBeVisible({ timeout: 15_000 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-logo")).toBeVisible({ timeout: 15_000 });
  });
});
