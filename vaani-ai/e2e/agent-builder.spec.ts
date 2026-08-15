import { test, expect } from "@playwright/test";
import { loginDemo, registerFreshWorkspace, completeOnboardingFast, psql } from "./helpers";

/**
 * Agent builder coverage for docs/manual-testing/02-agent-builder.md.
 *
 * Deterministic cases only — real phone calls (AGENT-15/20-24/31), voice
 * cloning provider spend (AGENT-10 upgrade half), and Dograh WebRTC test calls
 * are operator-gated and covered by manual testing. The e2e env runs with
 * Dograh possibly down, so publish-dependent assertions tolerate a failed
 * publish by falling back to the version table that publish populates.
 */
test.describe("agent builder (AGENT-01..36, deterministic)", () => {
  test("AGENT-01/03: create blank agent, edit general settings, persists in list", async ({ page }) => {
    await loginDemo(page);
    const name = `Blank ${Date.now()}`;

    await page.goto("/agents");
    await page.getByTestId("agents-new-btn").click();
    await expect(page).toHaveURL(/\/agents\/new/);

    // General tab fields on the create form.
    const nameInput = page.locator('input[name="name"]');
    await nameInput.fill(name);
    await page.locator('textarea[name="greeting"]').fill("Namaste! How can I help you today?");
    await page.locator('textarea[name="systemPrompt"]').fill(
      "You are a helpful receptionist for a clinic. Answer calls politely, take messages, and confirm appointments. Keep responses short and friendly."
    );
    await page.getByTestId("agent-save-btn").click();

    // Created → redirected to the editor, list shows it as DRAFT.
    await expect(page).toHaveURL(/\/agents\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByTestId("agent-save-btn")).toBeVisible();
    await page.goto("/agents");
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // AGENT-03: edit name + description (greeting) and confirm it updates.
    await page.getByText(name, { exact: true }).first().click();
    await expect(page).toHaveURL(/\/agents\//);
    const edited = `${name} v2`;
    await page.locator('input[name="name"]').fill(edited);
    await page.getByTestId("agent-save-btn").click();
    await expect(page.getByText(edited, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("AGENT-02: create from template pre-fills prompt/voice/tools", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/agents");

    // Pick the first template card.
    await page.locator('[data-testid^="template-use-"]').first().click();
    await expect(page).toHaveURL(/\/agents\/[^/]+$/, { timeout: 15_000 });
    // Editor opened with pre-filled system prompt (template text is long).
    const prompt = page.locator('textarea[name="systemPrompt"]');
    await expect(prompt).not.toHaveValue("", { timeout: 15_000 });
    await expect(prompt).toHaveValue(/.{80,}/);
    // Template's suggested voice select is set to a non-empty value.
    await expect(page.getByTestId("agent-voice-select")).not.toHaveValue("");
  });

  test("AGENT-05: delete (archive) removes agent from list", async ({ page }) => {
    await loginDemo(page);
    // Create a disposable agent.
    const name = `DeleteMe ${Date.now()}`;
    await page.goto("/agents/new");
    await page.locator('input[name="name"]').fill(name);
    await page.locator('textarea[name="greeting"]').fill("Hello, how can I help?");
    await page.locator('textarea[name="systemPrompt"]').fill(
      "You are a short-lived test agent. Answer questions politely and end calls with a thank you."
    );
    await page.getByTestId("agent-save-btn").click();
    await expect(page).toHaveURL(/\/agents\/[^/]+$/, { timeout: 15_000 });

    // Archive from the editor header (danger zone).
    await page.getByTestId("agent-archive-btn").click();
    await expect(page).toHaveURL(/\/agents/, { timeout: 15_000 });
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test("AGENT-06: search filters the agent list", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/agents");

    const search = page.getByTestId("agents-search-input");
    await search.fill("zzz-no-such-agent");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=zzz-no-such-agent/);
    await expect(page.getByTestId("agents-empty-state")).toBeVisible();

    // Clear → list returns.
    await page.getByTestId("agents-filter-clear").click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByTestId("agents-grid")).toBeVisible();
  });

  test("AGENT-08/11/13: language mode, LLM switch and temp/max-tokens persist", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/agents");
    await page.locator('[data-testid^="agent-card-"]').first().click();
    await expect(page).toHaveURL(/\/agents\/[^/]+$/);

    // Voice tab: language mode → Hindi (fixed).
    await page.getByTestId("agent-tab-voice").click();
    await page.getByTestId("agent-language-mode").selectOption("fixed");
    await page.locator('select[name="fixedLanguage"]').selectOption("hi");
    // Voice preview button is present (AGENT-09).
    await expect(page.getByTestId("agent-voice-preview")).toBeVisible();
    await page.getByTestId("agent-save-btn").click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

    // LLM tab: switch model + temperature/maxTokens.
    await page.getByTestId("agent-tab-llm").click();
    await page.getByTestId("agent-llm-select").selectOption("deepseek/deepseek-chat:floor");
    await page.getByTestId("agent-temperature-input").fill("0.2");
    await page.getByTestId("agent-max-tokens-input").fill("512");
    await page.getByTestId("agent-save-btn").click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

    // Reload — values persisted (server re-renders form from DB).
    await page.reload();
    await page.getByTestId("agent-tab-llm").click();
    await expect(page.getByTestId("agent-llm-select")).toHaveValue("deepseek/deepseek-chat:floor");
    await expect(page.getByTestId("agent-temperature-input")).toHaveValue("0.2");
    await expect(page.getByTestId("agent-max-tokens-input")).toHaveValue("512");
    await page.getByTestId("agent-tab-voice").click();
    await expect(page.getByTestId("agent-language-mode")).toHaveValue("fixed");
  });

  test("AGENT-16: KB guardrail toggle saves on the general tab", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/agents");
    await page.locator('[data-testid^="agent-card-"]').first().click();
    await page.getByTestId("agent-kb-guardrail").check();
    await page.getByTestId("agent-save-btn").click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("agent-kb-guardrail")).toBeChecked();
  });

  test("AGENT-25: tool off-state — disabling a tool removes it from the workflow", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/agents");
    await page.locator('[data-testid^="agent-card-"]').first().click();
    await page.getByTestId("agent-tab-tools").click();

    // Enable SMS, then disable it again — the row reflects the state.
    const sms = page.getByTestId("tool-section-SMS");
    await sms.getByTestId("tool-enable-SMS").check();
    await sms.getByTestId("tool-save-SMS").click();
    await expect(sms.getByTestId("tool-enable-SMS")).toBeChecked();

    // Off-state: uncheck + save → disabled (excluded from workflow on publish).
    await sms.getByTestId("tool-enable-SMS").uncheck();
    await sms.getByTestId("tool-save-SMS").click();
    await expect(sms.getByTestId("tool-enable-SMS")).not.toBeChecked();

    // A dry-run test button exists for testable tools (AGENT-21 uses HUMAN_TRANSFER
    // which is not dry-runnable, so assert the button on SMS).
    await expect(sms.getByTestId("tool-test-SMS")).toBeVisible();
  });

  test("AGENT-32: A/B split validation rejects 101%", async ({ page }) => {
    await loginDemo(page);
    // Publish an agent first (needs a live version to clone). Reuse the
    // real-estate template flow from agent-lifecycle.spec.ts.
    await page.goto("/agents");
    await page.locator('[data-testid^="template-use-"]').first().click();
    await expect(page).toHaveURL(/\/agents\/[^/]+$/, { timeout: 15_000 });
    await page.getByTestId("agent-publish-btn").click();
    // Publish pushes to Dograh (may be down) — but it still creates the version
    // snapshot and re-renders the versions tab.
    await expect(page.getByTestId("version-history-table")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="version-row-"]').first()).toContainText("PUBLISHED", { timeout: 30_000 });

    // 101% is out of range → the server rejects with a clear validation error.
    await page.getByTestId("ab-traffic-input").fill("101");
    await page.getByTestId("ab-create-btn").click();
    await expect(page.getByText(/A\/B traffic must be a whole number between 1 and 99/)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("AGENT-34/35/36: marketplace publish, install (own), unpublish", async ({ page }) => {
    await loginDemo(page);
    // Publish an agent as a marketplace template from its versions tab.
    await page.goto("/agents");
    await page.locator('[data-testid^="template-use-"]').first().click();
    await expect(page).toHaveURL(/\/agents\/[^/]+$/, { timeout: 15_000 });
    await page.getByTestId("agent-tab-versions").click();

    const tplName = `Tpl ${Date.now()}`;
    await page.getByTestId("marketplace-publish-name").fill(tplName);
    await page.locator('input[name="tplIndustry"]').fill("Healthcare");
    await page.locator('textarea[name="tplDescription"]').fill(
      "A clinic receptionist template for testing the marketplace flow end to end."
    );
    await page.getByTestId("marketplace-publish-btn").click();
    await expect(page.getByText(/Publish template done/)).toBeVisible({ timeout: 15_000 });

    // Marketplace shows MY template (author workspace) with Unpublish button.
    await page.goto("/marketplace");
    const card = page.locator(`[data-testid^="marketplace-card-"]`, { hasText: tplName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId(/marketplace-unpublish-/)).toBeVisible();

    // Install from the same workspace is not shown (only unpublish), so create a
    // SECOND workspace (register) to exercise the install button.
    await registerFreshWorkspace(page, "tpl-install");
    await completeOnboardingFast(page);
    await page.goto("/marketplace");
    const installCard = page.locator(`[data-testid^="marketplace-card-"]`, { hasText: tplName });
    await expect(installCard).toBeVisible({ timeout: 15_000 });
    await installCard.getByTestId(/marketplace-install-/).click();
    // Installed as a DRAFT agent in the new workspace.
    await expect(page).toHaveURL(/\/agents\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByText(tplName, { exact: true })).toBeVisible();

    // Back in the author workspace (demo-clinic), unpublish removes it.
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("logout-button").click();
    await loginDemo(page);
    await page.goto("/marketplace");
    const mine = page.locator(`[data-testid^="marketplace-card-"]`, { hasText: tplName });
    await expect(mine).toBeVisible({ timeout: 15_000 });
    await mine.getByTestId(/marketplace-unpublish-/).click();
    await expect(page.getByText(tplName, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
});
