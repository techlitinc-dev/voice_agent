import { test, expect, type Page } from "@playwright/test";
import { loginDemo, psql, postDograhEvent } from "./helpers";
import { writeFileSync } from "node:fs";

/**
 * Outbound campaign coverage for docs/manual-testing/04-outbound-campaigns.md.
 *
 * Deterministic CAMP cases driven against the seeded demo-clinic workspace with
 * the dry-run worker (CAMPAIGN_DRY_RUN=true). Outcome pinning uses
 * Contact.attributes.e2eOutcome (src/worker/dial.ts) so retry/DNC tests don't
 * depend on random dry-run results.
 *
 * Real-phone / wall-clock / redis-queue cases (CAMP-08/09/11/12/13/15/21/26)
 * are operator-gated — covered by manual testing + unit suites.
 */

const DEMO_WS = `(SELECT id FROM "Workspace" WHERE slug='demo-clinic')`;

/** Publish the demo agent (seed leaves it DRAFT) so campaign creation works. */
function publishAgent(): void {
  psql(
    `UPDATE "Agent" SET status='PUBLISHED', "dograhWorkflowId"='wf_e2e_outbound'
     WHERE id=(SELECT a.id FROM "Agent" a JOIN "Workspace" w ON w.id=a."workspaceId" WHERE w.slug='demo-clinic' LIMIT 1);`
  );
}

/**
 * Unique contact phone per (tag, index): +91 + 7 + 9 digits derived from the
 * tag's low digits. Contacts upsert by workspaceId_phone, so reruns MUST NOT
 * reuse numbers — a reused number is moved into the new list (and DNC'd ones
 * are scrubbed at import), which silently breaks listPhone()/CAMP-19.
 */
function contactPhone(tag: number, i: number): string {
  const tail = String(tag).slice(-9).padStart(9, "0"); // 9 digits, stable per run
  return `+917${tail.slice(0, 8)}${i}`; // +917 + 8 tag digits + index = +91[7] + 9 digits
}

/** Create a contact list with `n` contacts via the CSV uploader. Returns list name. */
async function createList(page: Page, tag: number, n = 3): Promise<string> {
  const name = `E2E outbound list ${tag}`;
  const csvPath = `/tmp/e2e-outbound-${tag}.csv`;
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    // Valid E.164 Indian mobile: +91[6-9] + 9 digits.
    rows.push(`${contactPhone(tag, i)},E2E Out ${i}`);
  }
  writeFileSync(csvPath, `phone,name\n${rows.join("\n")}\n`);
  await page.goto("/contacts");
  await page.getByTestId("list-name-input").fill(name);
  await page.getByTestId("csv-file-input").setInputFiles(csvPath);
  await page.getByTestId("csv-import-submit").click();
  await expect(page.getByTestId("csv-import-result")).toContainText("Imported", { timeout: 15_000 });
  return name;
}

/** First phone in the most recent list matching `name`. */
function listPhone(listName: string, index = 0): string {
  return psql(
    `SELECT c.phone FROM "Contact" c JOIN "ContactList" l ON l.id=c."listId"
     WHERE l.name='${listName}' AND c."workspaceId"=${DEMO_WS}
     ORDER BY c."createdAt" ASC LIMIT 1 OFFSET ${index};`
  );
}

/** Id of the list matching `name` in the demo workspace. */
function listId(listName: string): string {
  return psql(
    `SELECT l.id FROM "ContactList" l WHERE l.name='${listName}' AND l."workspaceId"=${DEMO_WS} LIMIT 1;`
  );
}

/** Create a DRAFT campaign on the given list via the UI; returns its id. */
async function createCampaign(
  page: Page,
  tag: number,
  listName: string,
  opts: { poolName?: string; windowStart?: string; windowEnd?: string; cpm?: number; maxAttempts?: number } = {}
): Promise<string> {
  await page.goto("/campaigns");
  await page.waitForLoadState("networkidle");
  console.log(`[createCampaign] url after goto: ${page.url()}`);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  console.log(`[createCampaign] body head: ${bodyText.slice(0, 600).replace(/\n/g, " ")}`);
  await expect(page.getByTestId("campaign-list")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("new-campaign-button")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("new-campaign-button").click();
  await page.getByTestId("campaign-name-input").fill(`E2E outbound ${tag}`);
  await page.getByTestId("agent-select").selectOption({ index: 0 });
  await page.getByTestId("list-select").selectOption({ label: listName });
  if (opts.poolName) {
    await page.getByTestId("pool-select").selectOption({ label: opts.poolName });
  }
  await page.getByTestId("window-start-input").fill(opts.windowStart ?? "00:00");
  await page.getByTestId("window-end-input").fill(opts.windowEnd ?? "23:59");
  await page.getByTestId("cpm-input").fill(String(opts.cpm ?? 60));
  if (opts.maxAttempts !== undefined) {
    await page.locator('input[name="maxAttempts"]').fill(String(opts.maxAttempts));
  }
  await page.getByTestId("create-campaign-submit").click();
  await expect(page.getByTestId("campaign-detail")).toBeVisible({ timeout: 15_000 });
  return psql(`SELECT id FROM "Campaign" WHERE name='E2E outbound ${tag}' ORDER BY "createdAt" DESC LIMIT 1;`);
}

/** Start a campaign and wait for the status pill to flip to RUNNING. */
async function startCampaign(page: Page): Promise<void> {
  await page.getByTestId("resume-button").click();
  await expect(page.getByTestId("campaign-status-pill")).toHaveText("RUNNING", { timeout: 15_000 });
}

/** Pin a contact's dry-run dial outcome via attributes.e2eOutcome. */
function pinOutcome(phone: string, outcome: "completed" | "no-answer" | "busy" | "voicemail" | "failed"): void {
  psql(
    `UPDATE "Contact" SET attributes = COALESCE(attributes,'{}'::jsonb) || '{"e2eOutcome":"${outcome}"}'::jsonb
     WHERE "workspaceId"=${DEMO_WS} AND phone='${phone}';`
  );
}

/** Poll until a CampaignContact for `phone` leaves PENDING/DIALING. */
async function waitForContactResult(campaignId: string, phone: string, timeoutMs = 120_000): Promise<void> {
  await expect(async () => {
    const row = psql(
      `SELECT status FROM "CampaignContact" cc JOIN "Contact" c ON c.id=cc."contactId"
       WHERE cc."campaignId"='${campaignId}' AND c.phone='${phone}';`
    );
    expect(row).toBeTruthy();
    expect(row).not.toMatch(/PENDING|DIALING/);
  }).toPass({ timeout: timeoutMs, intervals: [3_000] });
}

test.describe("outbound campaigns (CAMP-02..29, deterministic)", () => {
  test.beforeAll(() => {
    publishAgent();
  });

  test("CAMP-02: preset prefills retry policy + opening hook", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/campaigns/new");
    await page.getByTestId("preset-card-APPOINTMENT_REMINDER").click();
    await expect(page.getByTestId("retry-policy-editor")).not.toHaveValue("{}");
    await expect(page.getByTestId("opening-hook-input")).not.toHaveValue("");
    await expect(page.getByTestId("window-start-input")).toHaveValue(/^\d{2}:\d{2}$/);
  });

  test("CAMP-03: missing required fields block submission", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    await page.goto("/campaigns/new");
    // The name text input has no default; the agent/list selects default to
    // their first (valid) option once the seeded demo agent is published, so
    // name is the field that genuinely blocks. HTML5 required stops the submit
    // before the server action runs.
    await page.getByTestId("create-campaign-submit").click();
    // Still on the form — no campaign created.
    expect(page.url()).toContain("/campaigns/new");
    const created = psql(`SELECT count(*) FROM "Campaign" WHERE name LIKE 'E2E invalid ${tag}%';`);
    expect(created).toBe("0");
    // Filling the name lets the submit through → DRAFT campaign created.
    await page.getByTestId("campaign-name-input").fill(`E2E invalid ${tag}`);
    await page.getByTestId("create-campaign-submit").click();
    await expect(page.getByTestId("campaign-detail")).toBeVisible({ timeout: 15_000 });
    const made = psql(`SELECT count(*) FROM "Campaign" WHERE name='E2E invalid ${tag}';`);
    expect(made).toBe("1");
  });

  test("CAMP-05: duplicate CSV into the same campaign dedupes", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const csvPath = `/tmp/e2e-dup-${tag}.csv`;
    // Unique phones per run (upsert-by-phone would otherwise collide with prior runs).
    const dupA = `+9198${String(tag).slice(-8).padStart(8, "0")}1`;
    const dupB = `+9198${String(tag).slice(-8).padStart(8, "0")}2`;
    writeFileSync(csvPath, `phone,name\n${dupA},Dup One\n${dupB},Dup Two\n`);

    // First import → list1 with 2 contacts.
    await page.goto("/contacts");
    await page.getByTestId("list-name-input").fill(`E2E dup list ${tag}`);
    await page.getByTestId("csv-file-input").setInputFiles(csvPath);
    await page.getByTestId("csv-import-submit").click();
    await expect(page.getByTestId("csv-import-result")).toContainText("Imported 2", { timeout: 15_000 });

    // Second import (same phones) → list2; the upsert-by-phone means the SAME
    // Contact rows exist. Create a campaign on list2 → 2 CampaignContact rows.
    const listName2 = `E2E dup list2 ${tag}`;
    await page.getByTestId("list-name-input").fill(listName2);
    await page.getByTestId("csv-file-input").setInputFiles(csvPath);
    await page.getByTestId("csv-import-submit").click();
    await expect(page.getByTestId("csv-import-result")).toContainText("Imported 2", { timeout: 15_000 });

    const campaignId = await createCampaign(page, tag, listName2);
    const before = psql(`SELECT count(*) FROM "CampaignContact" WHERE "campaignId"='${campaignId}';`);
    expect(before).toBe("2");

    // Re-import the same file INTO the campaign (list3) → skipDuplicates keeps it at 2.
    await page.goto(`/campaigns/${campaignId}`);
    await page.getByTestId("list-name-input").fill(`E2E dup list3 ${tag}`);
    await page.getByTestId("csv-file-input").setInputFiles(csvPath);
    await page.getByTestId("csv-import-submit").click();
    await expect(page.getByTestId("csv-import-result")).toContainText("Added to the campaign", { timeout: 15_000 });
    const after = psql(`SELECT count(*) FROM "CampaignContact" WHERE "campaignId"='${campaignId}';`);
    expect(after).toBe("2");
  });

  test("CAMP-10: cancel marks remaining contacts cancelled + no further dials", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const listName = await createList(page, tag, 2);
    const campaignId = await createCampaign(page, tag, listName);
    await startCampaign(page);
    // Let the tick dial, then cancel.
    await page.waitForTimeout(35_000);
    await page.getByTestId("cancel-button").click();
    await expect(page.getByTestId("campaign-status-pill")).toHaveText("CANCELLED", { timeout: 15_000 });
    const remaining = psql(`SELECT count(*) FROM "CampaignContact" WHERE "campaignId"='${campaignId}' AND status IN ('PENDING','DIALING');`);
    expect(remaining).toBe("0");
  });

  test("CAMP-14/16: no-answer retried per policy, max attempts → FAILED", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const listName = await createList(page, tag, 1);
    const campaignId = await createCampaign(page, tag, listName, { cpm: 60 });
    const phone = listPhone(listName);
    pinOutcome(phone, "no-answer");
    await startCampaign(page);
    await waitForContactResult(campaignId, phone);
    const retryRow = psql(
      `SELECT status, attempts, "nextAttemptAt" IS NOT NULL FROM "CampaignContact" cc JOIN "Contact" c ON c.id=cc."contactId"
       WHERE cc."campaignId"='${campaignId}' AND c.phone='${phone}';`
    );
    expect(retryRow).toContain("RETRY_SCHEDULED");
    expect(retryRow).toContain("1|t"); // attempts=1, nextAttemptAt set

    // Second campaign with maxAttempts=1 → FAILED on first no-answer.
    const tag2 = tag + 1;
    const listName2 = await createList(page, tag2, 1);
    const campaign2 = await createCampaign(page, tag2, listName2, { cpm: 60, maxAttempts: 1 });
    const phone2 = listPhone(listName2);
    pinOutcome(phone2, "no-answer");
    await startCampaign(page);
    await waitForContactResult(campaign2, phone2);
    const failedRow = psql(
      `SELECT status, attempts, "nextAttemptAt" IS NULL FROM "CampaignContact" cc JOIN "Contact" c ON c.id=cc."contactId"
       WHERE cc."campaignId"='${campaign2}' AND c.phone='${phone2}';`
    );
    expect(failedRow).toContain("FAILED");
    expect(failedRow).toContain("1|t");
  });

  test("CAMP-19: DNC scrub on launch → contact SKIPPED_DNC, not dialed", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const listName = await createList(page, tag, 2);
    const dncPhone = listPhone(listName, 0);
    // Raw SQL insert — DncEntry.id is a client-side cuid (no DB default), so an
    // explicit id is required (Prisma's toggleDncAction supplies it).
    psql(
      `INSERT INTO "DncEntry" (id, "workspaceId", phone, source, reason)
       SELECT 'dnc_e2e_${tag}', id, '${dncPhone}', 'MANUAL', 'e2e scrub' FROM "Workspace" WHERE slug='demo-clinic'
       ON CONFLICT DO NOTHING;`
    );
    const campaignId = await createCampaign(page, tag, listName);
    await startCampaign(page);
    await expect(async () => {
      const row = psql(
        `SELECT status, "lastResult" FROM "CampaignContact" cc JOIN "Contact" c ON c.id=cc."contactId"
         WHERE cc."campaignId"='${campaignId}' AND c.phone='${dncPhone}';`
      );
      expect(row).toContain("SKIPPED_DNC");
      expect(row).toContain("skipped:dnc");
    }).toPass({ timeout: 45_000, intervals: [3_000] });
  });

  test("CAMP-20: opt-out during call → DncEntry + contact removed from queue", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const listName = await createList(page, tag, 1);
    const campaignId = await createCampaign(page, tag, listName);
    await startCampaign(page);
    const phone = listPhone(listName);

    // Drive the post-call opt-out path with a webhook: the dry-run worker will have
    // dialed the contact; post-call sees "stop calling" → DncEntry + SKIPPED_DNC.
    const callId = `e2e_optout_${tag}`;
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: phone, to_number: "+918040001234" },
    });
    await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 30,
        summary: "Caller said stop calling me.",
        transcript: "AI: Namaste! Caller: Please stop calling me, remove my number.",
      },
    });

    await expect(async () => {
      const dnc = psql(`SELECT count(*) FROM "DncEntry" WHERE "workspaceId"=${DEMO_WS} AND phone='${phone}';`);
      expect(dnc).toBe("1");
    }).toPass({ timeout: 30_000, intervals: [3_000] });

    // The campaign contact ends SKIPPED_DNC (opt-out) whether or not it was dialed.
    await expect(async () => {
      const row = psql(
        `SELECT status, "lastResult" FROM "CampaignContact" cc JOIN "Contact" c ON c.id=cc."contactId"
         WHERE cc."campaignId"='${campaignId}' AND c.phone='${phone}';`
      );
      expect(row).toMatch(/SKIPPED_DNC/);
    }).toPass({ timeout: 60_000, intervals: [3_000] });
  });

  test("CAMP-22: record consent on the contact", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const listName = await createList(page, tag, 1);
    const phone = listPhone(listName);
    await page.goto("/contacts");
    await page.getByTestId("record-consent-btn").first().click();
    await expect(async () => {
      const cell = psql(`SELECT "consentSource" FROM "Contact" WHERE "workspaceId"=${DEMO_WS} AND phone='${phone}';`);
      expect(cell).toBe("manual");
    }).toPass({ timeout: 15_000, intervals: [2_000] });
  });

  test("CAMP-23/24: pool rotation + per-number cap", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const poolName = `E2E pool ${tag}`;
    await page.goto("/campaigns/pools");
    await page.getByTestId("pool-name-input").fill(poolName);
    await page.getByTestId("pool-create-submit").click();
    await expect(page.getByTestId("pool-card").first()).toBeVisible();

    // Two SERIES_140 DIDs (promo series, allowed for LEAD_QUALIFICATION).
    // Unique per run: PhoneNumber upserts by workspaceId_number, so reusing
    // fixed DIDs carries over accumulated dailyCallsUsed from earlier runs.
    const didTail = String(tag).slice(-7).padStart(7, "0");
    const didA = `+91140${didTail.slice(0, 6)}1`;
    const didB = `+91140${didTail.slice(0, 6)}2`;
    for (const num of [didA, didB]) {
      await page.getByTestId("pool-number-input").first().fill(num);
      await page.getByTestId("pool-number-type-select").first().selectOption("SERIES_140");
      await page.getByTestId("pool-add-number-submit").first().click();
    }
    // Cap the first number at 1 dial/day.
    const firstPn = psql(`SELECT id FROM "PhoneNumber" WHERE number='${didA}' AND "workspaceId"=${DEMO_WS};`);
    psql(`UPDATE "PhoneNumber" SET "dailyCallCap"=1 WHERE id='${firstPn}';`);

    // Campaign on the pool with 3 contacts → dials rotate across the 2 DIDs.
    const listName = await createList(page, tag, 3);
    const campaignId = await createCampaign(page, tag, listName, { poolName: `${poolName} (2 numbers)` });
    await startCampaign(page);
    // Dry-run dials never write Call rows (dial.ts only creates them on the real
    // Dograh path) — rotation is visible in the pool numbers' dailyCallsUsed, which
    // the scheduler increments per claimed dial.
    const secondPn = psql(`SELECT id FROM "PhoneNumber" WHERE number='${didB}' AND "workspaceId"=${DEMO_WS};`);
    await expect(async () => {
      const [usedA, usedB] = [
        psql(`SELECT "dailyCallsUsed" FROM "PhoneNumber" WHERE id='${firstPn}';`),
        psql(`SELECT "dailyCallsUsed" FROM "PhoneNumber" WHERE id='${secondPn}';`),
      ];
      // Both DIDs were picked at least once → rotation happened.
      expect(Number(usedA)).toBeGreaterThan(0);
      expect(Number(usedB)).toBeGreaterThan(0);
    }).toPass({ timeout: 120_000, intervals: [5_000] });
    // Cap honored: the capped number used exactly 1 call.
    const capped = psql(`SELECT "dailyCallsUsed" FROM "PhoneNumber" WHERE id='${firstPn}';`);
    expect(capped).toBe("1");
  });

  test("CAMP-25: manual dial creates an OUTBOUND call", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    await page.goto("/dialer");
    const toNumber = `+9170${String(tag).slice(-8)}`; // +91[7] + 9 digits, valid E.164
    await page.getByTestId("dialer-number-input").fill(toNumber);
    await page.getByTestId("dialer-call-btn").click();
    await expect(page.getByTestId("dialer-message")).toContainText("Call initiated", { timeout: 10_000 });
    const row = psql(
      `SELECT status, direction FROM "Call" WHERE "toNumber"='${toNumber}' AND "workspaceId"=${DEMO_WS} ORDER BY "createdAt" DESC LIMIT 1;`
    );
    expect(row).toContain("RINGING");
    expect(row).toContain("OUTBOUND");
  });

  test("CAMP-27/28: WhatsApp template approval + campaign send", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const listName = await createList(page, tag, 2);
    await page.goto("/campaigns/whatsapp");
    const tplName = `e2e_tpl_${tag}`;
    await page.getByTestId("template-name-input").fill(tplName);
    await page.getByTestId("template-body-input").fill("Hi {{1}}, this is a test message.");
    await page.locator('input[name="dltTemplateId"]').fill("DLTTEST123456");
    await page.getByTestId("template-create-submit").click();
    await expect(page.getByTestId("template-row").first()).toContainText("DRAFT", { timeout: 10_000 });

    // Record approval.
    const row = page.getByTestId("template-row").first();
    await row.locator('select[name="status"]').selectOption("APPROVED");
    await row.locator('button[type="submit"]').click();
    await expect(page.getByTestId("template-row").first()).toContainText("APPROVED", { timeout: 10_000 });

    // Create + start a WhatsApp campaign on the list.
    await page.getByTestId("wa-campaign-name-input").fill(`E2E WA ${tag}`);
    await page.getByTestId("wa-list-select").selectOption({ value: listId(listName) });
    await page.getByTestId("wa-campaign-create-submit").click();
    await expect(page.getByTestId("wa-campaign-row").first()).toContainText("DRAFT", { timeout: 10_000 });
    await page.getByTestId("whatsapp-campaign-start").first().click();
    // The dry-run send is fast — the row may flip DRAFT → RUNNING → COMPLETED
    // faster than a page refresh. Assert it left DRAFT and the DB reaches
    // RUNNING/COMPLETED (the durable state transitions).
    await expect(page.getByTestId("wa-campaign-row").first()).not.toContainText("DRAFT", { timeout: 10_000 });
    // Dry-run send completes the campaign.
    await expect(async () => {
      const status = psql(`SELECT status FROM "WhatsAppCampaign" WHERE name='E2E WA ${tag}' ORDER BY "createdAt" DESC LIMIT 1;`);
      expect(status).toMatch(/RUNNING|COMPLETED/);
    }).toPass({ timeout: 60_000, intervals: [5_000] });
  });

  test("CAMP-29: invalid DLT id rejected", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    await page.goto("/campaigns/whatsapp");
    const tplName = `e2e_baddlt_${tag}`;
    await page.getByTestId("template-name-input").fill(tplName);
    await page.getByTestId("template-body-input").fill("Hi {{1}}, test body.");
    await page.locator('input[name="dltTemplateId"]').fill("bad id!");
    await page.getByTestId("template-create-submit").click();
    await expect(page.getByTestId("whatsapp-page")).toContainText("Check the template fields", { timeout: 10_000 });
    // No template row created.
    await expect(page.getByTestId("template-row").first()).not.toContainText(tplName);
  });
});
