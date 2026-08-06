import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";
import { writeFileSync } from "node:fs";

const PDF_BYTES = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

test.describe("KYC (guide 10, readme §13)", () => {
  test("upload a KYC document → status PENDING", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/settings/kyc");
    await expect(page.getByTestId("kyc-page")).toBeVisible();

    const docPath = "/tmp/e2e-kyc.pdf";
    writeFileSync(docPath, PDF_BYTES);
    await page.getByTestId("kyc-doctype-select").selectOption({ index: 1 });
    await page.getByTestId("kyc-ref-input").fill(`E2E-REF-${Date.now()}`);
    await page.getByTestId("kyc-file-input").setInputFiles(docPath);
    await page.getByTestId("kyc-submit-btn").click();
    await expect(page.getByTestId("kyc-success")).toContainText("PENDING", { timeout: 15_000 });
    await expect(page.getByTestId("kyc-status-banner")).toBeVisible();
  });
});
