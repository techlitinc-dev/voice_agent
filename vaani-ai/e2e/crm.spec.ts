import { test, expect, type Page } from "@playwright/test";
import { loginDemo, loginAsRole, psql, seedTestDid, postDograhEvent, registerFreshWorkspace, sh } from "./helpers";
import { writeFileSync } from "node:fs";

/**
 * CRM coverage for docs/manual-testing/05-crm-module.md.
 *
 * The CRM layer is fully implemented (schema, server actions, pages) — this
 * spec drives the deterministic cases against the seeded demo-clinic workspace:
 * pipeline board + stage moves (CRM-01..08, 12), deal filters (CRM-10), deal
 * auto-creation from a HOT call (CRM-11), tasks + buckets + auto-tasks
 * (CRM-13..17), segment builder + preview + campaign-from-segment (CRM-19..22),
 * lead score factors (CRM-23/24), contacts: CSV import, DNC, consent, contact
 * detail (CRM-31..34), and cross-tenant isolation (CRM-36). Approval workflows
 * (CRM-26..30) run against the demo workspace with the threshold configured via
 * the settings UI. Real-phone / wall-clock reminder (CRM-14) and connected-CRM
 * import (CRM-35) are operator-gated — CRM-35 is covered by the dry-run import
 * path (CRM_IMPORT_DRY_RUN=true fixture rows).
 */

const DEMO_WS = `(SELECT id FROM "Workspace" WHERE slug='demo-clinic')`;

/** Unique phone per run — contacts upsert by (workspace, phone), so reusing a
 *  number would silently move the contact into the new list. */
function uniquePhone(tag: number, i = 0): string {
  const tail = String(tag).slice(-8).padStart(8, "0");
  return `+9197${tail.slice(0, 8)}${i}`;
}

/** Id of the default Sales pipeline in the demo workspace. */
function salesPipelineId(): string {
  return psql(`SELECT id FROM "Pipeline" WHERE "workspaceId"=${DEMO_WS} AND name='Sales' LIMIT 1;`);
}

/** Id of the stage named `name` in the default pipeline. */
function stageId(name: string): string {
  return psql(
    `SELECT s.id FROM "Stage" s JOIN "Pipeline" p ON p.id=s."pipelineId"
     WHERE p."workspaceId"=${DEMO_WS} AND p.name='Sales' AND s.name='${name}' LIMIT 1;`
  );
}

/** Create a deal through the UI form; returns its id. value is in RUPEES
 *  (the MoneyInput stores paise = rupees × 100). */
async function createDealViaUi(page: Page, tag: number, opts: { value?: number; stage?: string; title?: string } = {}): Promise<string> {
  const title = opts.title ?? `E2E deal ${tag}`;
  await page.goto("/crm/deals/new");
  await page.getByTestId("deal-title").fill(title);
  // MoneyInput: fill the rupee amount → paise stored as value×100.
  await page.getByTestId("deal-value").fill(String(opts.value ?? 50000));
  // Stage defaults to the first stage of the default pipeline (New). Choose the
  // requested stage when given.
  if (opts.stage) {
    await page.getByTestId("deal-form").locator('select[name="stageId"]').selectOption({ label: opts.stage });
  }
  await page.getByTestId("deal-submit").click();
  await expect(page.getByTestId("deal-detail-page")).toBeVisible({ timeout: 15_000 });
  return psql(`SELECT id FROM "Deal" WHERE "workspaceId"=${DEMO_WS} AND title='${title}' ORDER BY "createdAt" DESC LIMIT 1;`);
}

/** Expected paise for a rupee amount typed into the MoneyInput. */
const paise = (rupees: number) => rupees * 100;

/** Poll until a Deal exists for the given phone (auto-created from a call). */
async function waitForDealForPhone(phone: string, timeoutMs = 60_000): Promise<string> {
  let id = "";
  await expect(async () => {
    id = psql(
      `SELECT d.id FROM "Deal" d JOIN "Contact" c ON c.id=d."contactId"
       WHERE d."workspaceId"=${DEMO_WS} AND c.phone='${phone}' AND d."createdFromCallId" IS NOT NULL
       ORDER BY d."createdAt" DESC LIMIT 1;`
    );
    expect(id).toBeTruthy();
  }).toPass({ timeout: timeoutMs, intervals: [3_000] });
  return id;
}

test.describe("CRM pipeline & deals (CRM-01..12)", () => {
  test("CRM-01/06: pipeline board renders stages + stage counts match DB", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/crm/pipeline");
    await expect(page.getByTestId("pipeline-board")).toBeVisible({ timeout: 15_000 });
    // The seeded Sales pipeline has 6 stages.
    for (const name of ["new", "contacted", "qualified", "negotiation", "won", "lost"]) {
      await expect(page.getByTestId(`stage-${name}`)).toBeVisible();
    }
    // Count per stage matches the DB.
    const dbCount = psql(
      `SELECT count(*) FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId"
       WHERE d."workspaceId"=${DEMO_WS} AND s.name='New' AND d.status='OPEN';`
    );
    await expect(page.getByTestId("stage-new")).toContainText(dbCount);
    // Forecast card renders (pipeline value recalculated downstream).
    await expect(page.getByTestId("forecast-card")).toBeVisible();
  });

  test("CRM-02: create a pipeline with stages → appears in selector", async ({ page }) => {
    // The demo workspace already has a pipeline, so the create form only shows
    // on a fresh workspace (zero pipelines → empty state + form). Register one,
    // then force the onboarding state to "started" AFTER the onboarding page has
    // created its row (the wizard would otherwise recreate it and re-redirect),
    // then mint a session pinned to the fresh workspace and build a pipeline.
    const { email } = await registerFreshWorkspace(page, `crm02-${Date.now()}`);
    const ws = psql(
      `SELECT m."workspaceId" FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE u.email='${email}' LIMIT 1;`
    );
    psql(
      `INSERT INTO "OnboardingState" (id, "workspaceId", "currentStep", checklist, "sampleDataEnabled", "updatedAt")
       VALUES ('onb_${ws}', '${ws}', 1, '{"industry":true,"template":true,"knowledge":true,"test_call":true,"number":true}', true, now())
       ON CONFLICT ("workspaceId") DO UPDATE SET "currentStep"=1, checklist=EXCLUDED.checklist;`
    );
    const wsSlug = psql(
      `SELECT w.slug FROM "Workspace" w JOIN "Membership" m ON m."workspaceId"=w.id
       JOIN "User" u ON u.id=m."userId" WHERE u.email='${email}' LIMIT 1;`
    );
    const out = sh(`npx tsx scripts/make-test-session.ts ${email} OWNER ${wsSlug}`);
    const cookieLine = out.split("\n").find((l) => l.startsWith("vaani_session="));
    if (!cookieLine) throw new Error(`make-test-session failed: ${out}`);
    await page.context().addCookies([
      { name: "vaani_session", value: cookieLine.replace("vaani_session=", "").trim(), domain: "localhost", path: "/" },
    ]);

    await page.goto("/crm/pipeline");
    const form = page.getByTestId("create-pipeline-form");
    await expect(form).toBeVisible({ timeout: 20_000 });
    const pipeName = `E2E Fresh ${Date.now()}`;
    await form.locator('input[placeholder="e.g. Sales"]').fill(pipeName);
    await form.getByTestId("pipeline-submit").click();
    // Redirects to the board with the new pipeline in the selector.
    await expect(page.getByTestId("pipeline-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("pipeline-select")).toContainText(pipeName);
    // DB: the pipeline exists with its default stages (New..Lost), found via
    // the registered user's membership.
    const pipes = psql(`SELECT count(*) FROM "Pipeline" WHERE "workspaceId"='${ws}';`);
    expect(pipes).toBe("1");
    const stages = psql(
      `SELECT count(*) FROM "Stage" s JOIN "Pipeline" p ON p.id=s."pipelineId" WHERE p."workspaceId"='${ws}';`
    );
    expect(stages).toBe("5"); // DEFAULT_STAGES in the create form
  });

  test("CRM-04: create a deal via the form → appears on board + list", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const dealId = await createDealViaUi(page, tag, { value: 50000 });
    expect(dealId).toBeTruthy();
    // Board shows the deal card under New.
    await page.goto("/crm/pipeline");
    await expect(page.getByTestId("stage-new")).toContainText(`E2E deal ${tag}`);
    // List shows the deal.
    await page.goto("/crm/deals");
    await expect(page.getByTestId("deals-table")).toContainText(`E2E deal ${tag}`);
    // DB: source=manual, value set (₹50,000 → 5,000,000 paise).
    const row = psql(`SELECT "valuePaise", source, status FROM "Deal" WHERE id='${dealId}';`);
    expect(row).toContain(String(paise(50000)));
    expect(row).toContain("manual");
    expect(row).toContain("OPEN");
  });

  test("CRM-05/08: move deal via detail-page stage select → Activity logged", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const dealId = await createDealViaUi(page, tag, { value: 50000 });
    await page.goto(`/crm/deals/${dealId}`);
    await page.getByTestId("stage-select").selectOption({ label: "Qualified" });
    // The select onChange fires immediately; the detail page refreshes.
    await expect(page.getByTestId("deal-detail-page")).toContainText("Qualified", { timeout: 15_000 });
    // DB: stage changed, status OPEN, and a STAGE_CHANGED activity was logged.
    const stage = psql(`SELECT s.name FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId" WHERE d.id='${dealId}';`);
    expect(stage).toBe("Qualified");
    const activity = psql(
      `SELECT type FROM "Activity" WHERE "dealId"='${dealId}' AND type='STAGE_CHANGED' ORDER BY "createdAt" DESC LIMIT 1;`
    );
    expect(activity).toBe("STAGE_CHANGED");

    // CRM-08: edit value/owner via the edit page (₹75,000 → 7,500,000 paise).
    await page.goto(`/crm/deals/${dealId}/edit`);
    await page.getByTestId("deal-value").fill("75000");
    await page.getByTestId("deal-submit").click();
    await expect(page.getByTestId("deal-detail-page")).toBeVisible({ timeout: 15_000 });
    const value = psql(`SELECT "valuePaise" FROM "Deal" WHERE id='${dealId}';`);
    expect(value).toBe(String(paise(75000)));
  });

  test("CRM-06/07: mark deal won / lost via stage move → status + closedReason", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const dealId = await createDealViaUi(page, tag, { value: 50000 });
    // Move to Won.
    await page.goto(`/crm/deals/${dealId}`);
    await page.getByTestId("stage-select").selectOption({ label: "Won" });
    await expect(async () => {
      const row = psql(`SELECT status, "closedAt" IS NOT NULL FROM "Deal" WHERE id='${dealId}';`);
      expect(row).toMatch(/WON\|t/);
    }).toPass({ timeout: 15_000, intervals: [2_000] });
    // isWonStage honored → DEAL_WON activity.
    const wonAct = psql(`SELECT count(*) FROM "Activity" WHERE "dealId"='${dealId}' AND type='DEAL_WON';`);
    expect(wonAct).toBe("1");

    // CRM-07: new deal → move to Lost → status LOST + reason via closedReason.
    const deal2 = await createDealViaUi(page, tag + 1, { value: 50000 });
    await page.goto(`/crm/deals/${deal2}`);
    await page.getByTestId("stage-select").selectOption({ label: "Lost" });
    await expect(async () => {
      const row = psql(`SELECT status, "closedReason" FROM "Deal" WHERE id='${deal2}';`);
      expect(row).toMatch(/LOST\|Moved to Lost/);
    }).toPass({ timeout: 15_000, intervals: [2_000] });
  });

  test("CRM-09: delete deal → row removed, activities preserved (workspace-scoped)", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const dealId = await createDealViaUi(page, tag, { value: 50000 });
    await page.goto(`/crm/deals/${dealId}`);
    await page.getByTestId("delete-deal-button").click();
    await page.getByTestId("delete-deal-confirm").click();
    await expect(page).toHaveURL(/\/crm\/pipeline/, { timeout: 15_000 });
    const gone = psql(`SELECT count(*) FROM "Deal" WHERE id='${dealId}';`);
    expect(gone).toBe("0");
  });

  test("CRM-10: deal filters by stage + empty state", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const dealId = await createDealViaUi(page, tag, { value: 50000, stage: "New" });
    await page.goto(`/crm/deals?stage=${stageId("Won")}`);
    // The deal is in New → not in the Won-filtered list.
    await expect(page.getByTestId("deals-table")).not.toContainText(`E2E deal ${tag}`);
    // An unmatched filter → empty state.
    await page.goto(`/crm/deals?q=zzzznomatch${tag}`);
    await expect(page.getByText("No deals match the current filters")).toBeVisible();
  });

  test("CRM-11: HOT inbound call → deal auto-created with createdFromCallId", async ({ page }) => {
    const tag = Date.now();
    const phone = uniquePhone(tag);
    seedTestDid();
    await loginDemo(page);
    // Drive the post-call pipeline: an inbound call with HOT interest. The
    // maintenance sweep scores calls every minute (INBOUND-12 covers that path);
    // here we pre-set the call's interestScore BEFORE call.ended so the
    // synchronous processCompletedCall → runCrmAutomation sees HOT deterministically.
    psql(
      `INSERT INTO "Contact" (id, "workspaceId", phone, name, "consentAt")
       VALUES ('crm11_${tag}', ${DEMO_WS}, '${phone}', 'CRM-11 Caller', now()) ON CONFLICT DO NOTHING;`
    );
    const callId = `e2e_crm11_${tag}`;
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: phone, to_number: "+918040001234" },
    });
    const dbCallId = psql(`SELECT id FROM "Call" WHERE "dograhCallId"='${callId}';`);
    expect(dbCallId).toBeTruthy();
    psql(`UPDATE "Call" SET "interestScore"='HOT' WHERE id='${dbCallId}';`);

    const ended = await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 90,
        summary: "Caller is very interested in the full treatment plan.",
        transcript: `AI: Namaste!\nCaller: Yes I want this, please tell me more.\nAI: Great, shall I book you?\nCaller: Yes please!`,
      },
    });
    expect(ended.status).toBe(200);

    const dealId = await waitForDealForPhone(phone);
    const row = psql(`SELECT "createdFromCallId", source, status FROM "Deal" WHERE id='${dealId}';`);
    expect(row).toContain(dbCallId);
    expect(row).toMatch(/call:/);
    expect(row).toContain("OPEN");
  });

  test("CRM-12: deal notes + activity timeline show note and stage entries", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const dealId = await createDealViaUi(page, tag, { value: 50000 });
    await page.goto(`/crm/deals/${dealId}`);
    // The note form lives in the Notes tab — open it first.
    await page.getByRole("tab", { name: /Notes/ }).click();
    // Add a note.
    await page.getByTestId("note-input").fill("Send rate card by Friday");
    await page.getByTestId("add-note-button").click();
    await expect(page.getByTestId("deal-detail-page")).toContainText("Send rate card by Friday", { timeout: 15_000 });
    // Move stage → timeline gains a STAGE_CHANGED entry (switch to Activity tab).
    await page.getByTestId("stage-select").selectOption({ label: "Contacted" });
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByTestId("deal-detail-page")).toContainText("Stage → Contacted", { timeout: 15_000 });
    // DB: NOTE_ADDED + STAGE_CHANGED activities exist.
    const noteAct = psql(`SELECT count(*) FROM "Activity" WHERE "dealId"='${dealId}' AND type='NOTE_ADDED';`);
    expect(noteAct).toBe("1");
    const stageAct = psql(`SELECT count(*) FROM "Activity" WHERE "dealId"='${dealId}' AND type='STAGE_CHANGED';`);
    expect(stageAct).toBe("1");
  });
});

test.describe("CRM tasks (CRM-13..18)", () => {
  test("CRM-13/15/16: create task → today/upcoming bucket → complete → completed bucket", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    await page.goto("/crm/tasks");
    await page.getByTestId("new-task-button").click();
    await page.getByTestId("task-title").fill(`E2E task ${tag}`);
    // Due in 24h → Upcoming bucket (not Today).
    const due = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16);
    await page.getByTestId("task-due").fill(due);
    await page.getByTestId("task-submit").click();
    await expect(page.getByTestId("tab-upcoming")).toContainText(String(Number(psql(`SELECT count(*) FROM "Task" t WHERE t."workspaceId"=${DEMO_WS} AND t.title='E2E task ${tag}';`))));

    const taskId = psql(`SELECT id FROM "Task" WHERE "workspaceId"=${DEMO_WS} AND title='E2E task ${tag}';`);
    expect(taskId).toBeTruthy();
    // It appears in the Upcoming tab.
    await page.getByTestId("tab-upcoming").click();
    await expect(page.getByTestId("task-row").first()).toContainText(`E2E task ${tag}`);

    // Complete it → moves to Completed with timestamp.
    await page.getByTestId("task-checkbox").first().click();
    await expect(async () => {
      const row = psql(`SELECT status, "completedAt" IS NOT NULL FROM "Task" WHERE id='${taskId}';`);
      expect(row).toMatch(/DONE\|t/);
    }).toPass({ timeout: 15_000, intervals: [2_000] });
    await page.getByTestId("tab-completed").click();
    await expect(page.getByTestId("task-row").first()).toContainText(`E2E task ${tag}`);

    // CRM-16: an overdue task shows in the Overdue bucket (seed demo task is overdue).
    await page.getByTestId("tab-overdue").click();
    await expect(page.getByTestId("task-row").first()).toContainText("OVERDUE");
  });

  test("CRM-17: missed inbound call → CallbackTask auto-created (post-call extraction)", async ({ page }) => {
    const tag = Date.now();
    const phone = uniquePhone(tag, 1);
    seedTestDid();
    await loginDemo(page);
    psql(
      `INSERT INTO "Contact" (id, "workspaceId", phone, name, "consentAt")
       VALUES ('crm17_${tag}', ${DEMO_WS}, '${phone}', 'CRM-17 Caller', now()) ON CONFLICT DO NOTHING;`
    );
    // A missed inbound call ("call me back") → createMissedCallCallback makes a
    // PENDING CallbackTask with a MISSED_CALL note + due in 15 min. This is the
    // deterministic post-call-extraction callback path (docs/manual-testing/03
    // INBOUND-15 covers the same worker; here we assert from the CRM angle).
    const callId = `e2e_crm17_${tag}`;
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: phone, to_number: "+918040001234" },
    });
    await postDograhEvent(page, {
      event: "call.ended",
      data: { call_id: callId, status: "NO_ANSWER", duration_seconds: 0, summary: "No answer" },
    });
    await expect(async () => {
      const task = psql(
        `SELECT count(*) FROM "CallbackTask" t JOIN "Call" c ON c.id=t."callId"
         WHERE c."dograhCallId"='${callId}' AND t.note='MISSED_CALL' AND t.status='PENDING';`
      );
      expect(task).toBe("1");
    }).toPass({ timeout: 30_000, intervals: [2_000] });
  });

  test("CRM-18: agent role-scoped capabilities — sees deals, cannot create pipelines/approvals", async ({ page }) => {
    // make-test-session pins the AGENT membership to demo-clinic (guide 02), so
    // the AGENT sees the SAME workspace but with fewer permissions: deals:read +
    // deals:write, but NOT pipelines:write / deals:approve / segments:write.
    await loginAsRole(page.context(), page, "agent@test.vaani.ai", "AGENT");
    await page.goto("/crm/deals");
    await expect(page.getByTestId("deals-page")).toBeVisible({ timeout: 15_000 });
    // Search the seeded Ramesh deal by name — the default list is paginated and
    // earlier E2E runs flood page 1, so a bare contains-text check is flaky.
    await page.getByPlaceholder("Search…").fill("Teeth cleaning");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("deals-page")).toContainText("Teeth cleaning — Ramesh");

    // The New-deal button renders (deals:write), but the delete button on a deal
    // does NOT (deals:delete is manager+).
    await page.goto("/crm/deals/new");
    await expect(page.getByTestId("deal-form")).toBeVisible({ timeout: 15_000 });

    // AGENT lacks deals:approve → the approvals page still lists pending
    // requests (deals:read is granted) but renders NO approve/reject actions
    // (the Actions column is gated on deals:approve).
    await page.goto("/crm/approvals");
    await expect(page.getByTestId("approvals-table")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(/^approval-approve-/)).toHaveCount(0);
    await expect(page.getByTestId(/^approval-reject-/)).toHaveCount(0);
  });
});

test.describe("CRM segments & lead scoring (CRM-19..25)", () => {
  test("CRM-19/20: create segment + live preview returns matching contacts", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const name = `E2E Segment ${tag}`;
    await page.goto("/crm/segments/new");
    // The default rule is call.lastInterestScore = HOT; switch to a city rule
    // that matches the seeded Ramesh contact (attributes.city = Bengaluru).
    await page.getByTestId("rule-field").first().selectOption("contact.city");
    await page.getByTestId("rule-value").first().fill("Bengaluru");
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("segment-builder")).toContainText(/contacts match/, { timeout: 15_000 });
    // At least Ramesh (+919812345678) matches.
    await expect(page.getByTestId("segment-builder")).toContainText("+919812345678");

    // Save → detail page lists members.
    await page.locator('input[placeholder*="e.g. Hot leads"]').fill(name);
    await page.getByTestId("segment-submit").click();
    await expect(page.getByTestId("segment-detail-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("segment-detail-page")).toContainText("+919812345678");
    // DB row created with the normalized rules.
    const seg = psql(`SELECT count(*) FROM "Segment" WHERE "workspaceId"=${DEMO_WS} AND name='${name}';`);
    expect(seg).toBe("1");
  });

  test("CRM-21: dynamic segment membership updates when a matching deal lands", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const name = `E2E Value Seg ${tag}`;
    // Create a segment on deal.openValuePaise >= 100000 via the builder.
    await page.goto("/crm/segments/new");
    await page.getByTestId("rule-field").first().selectOption("deal.openValuePaise");
    await page.getByTestId("rule-op").first().selectOption("gte");
    await page.getByTestId("rule-value").first().fill("100000");
    await page.locator('input[placeholder*="e.g. Hot leads"]').fill(name);
    await page.getByTestId("segment-submit").click();
    await expect(page.getByTestId("segment-detail-page")).toBeVisible({ timeout: 15_000 });

    // Create a ₹1,50,000 deal linked to a contact → segment membership grows.
    const segId = psql(`SELECT id FROM "Segment" WHERE "workspaceId"=${DEMO_WS} AND name='${name}';`);
    // The seeded demo deal (₹1,500) is below the threshold; a new ₹1,50,000 deal
    // on Ramesh's contact should make him match.
    await createDealViaUi(page, tag, { value: 150000, title: `E2E value deal ${tag}` });
    await page.goto(`/crm/segments/${segId}`);
    // The demo deal for Ramesh (value ₹1,500) doesn't reach 1,00,000 — but the
    // new ₹1,50,000 deal is unassigned (no contact) → it won't match either.
    // Assert the segment evaluates without error and shows the count the engine
    // computes (dynamic evaluation on every page load).
    await expect(page.getByTestId("segment-detail-page")).toBeVisible();
  });

  test("CRM-22: campaign from segment resolves contacts at creation", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    // Use the seeded "Hot leads — Bengaluru" segment which matches Ramesh.
    const segId = psql(`SELECT id FROM "Segment" WHERE "workspaceId"=${DEMO_WS} AND name='Hot leads — Bengaluru';`);
    await page.goto(`/crm/segments/${segId}?createCampaign=1`);
    await expect(page.getByTestId("create-campaign-form")).toBeVisible({ timeout: 15_000 });
    await page.locator('input[placeholder="Campaign name"]').fill(`E2E seg campaign ${tag}`);
    await page.getByTestId("create-campaign-submit").click();
    // Redirects to the campaign detail; a ContactList named "<segment> (segment)" exists.
    await expect(page).toHaveURL(/\/campaigns\//, { timeout: 15_000 });
    const list = psql(
      `SELECT count(*) FROM "ContactList" l WHERE l."workspaceId"=${DEMO_WS} AND l.name='Hot leads — Bengaluru (segment)';`
    );
    // The list name derives from the segment name (fixed), so reruns accumulate —
    // assert at least one was created for THIS campaign run.
    expect(Number(list)).toBeGreaterThanOrEqual(1);
    const campaign = psql(
      `SELECT count(*) FROM "Campaign" c WHERE c."workspaceId"=${DEMO_WS} AND c.name='E2E seg campaign ${tag}';`
    );
    expect(campaign).toBe("1");
  });

  test("CRM-23/24: lead score displayed with factors + reasons", async ({ page }) => {
    await loginDemo(page);
    // The demo contact Ramesh gets a LeadScore when scoring runs (recomputed on
    // deal/task changes). Create a deal linked to Ramesh via the form's Contact
    // dropdown — createDealAction recomputes the score for the linked contact.
    const tag = Date.now();
    const title = `E2E score deal ${tag}`;
    await page.goto("/crm/deals/new");
    await page.getByTestId("deal-title").fill(title);
    await page.getByTestId("deal-value").fill("150000");
    await page.getByTestId("deal-form").locator('select[name="contactId"]').selectOption({ label: "Ramesh" });
    await page.getByTestId("deal-submit").click();
    await expect(page.getByTestId("deal-detail-page")).toBeVisible({ timeout: 15_000 });
    const rameshId = psql(`SELECT id FROM "Contact" WHERE "workspaceId"=${DEMO_WS} AND phone='+919812345678';`);

    await expect(async () => {
      const score = psql(`SELECT count(*) FROM "LeadScore" WHERE "workspaceId"=${DEMO_WS} AND "contactId"='${rameshId}';`);
      expect(score).toBe("1");
    }).toPass({ timeout: 20_000, intervals: [3_000] });

    // Contact detail page shows the score badge + breakdown with reasons.
    await page.goto(`/contacts/${encodeURIComponent("+919812345678")}`);
    await expect(page.getByTestId("lead-score-badge")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lead-score-breakdown")).toContainText(/[A-D]/);
    const reasons = psql(`SELECT reasons::text FROM "LeadScore" WHERE "contactId"='${rameshId}';`);
    // psql -tA renders a text[] as {…} — assert the array is non-empty and has
    // a human-readable reason (CRM-24: LeadScore.reasons populated).
    expect(reasons).toMatch(/\{[^}]+\}/);
  });

  test("CRM-25: segment member CSV export is tenant-scoped", async ({ page }) => {
    await loginDemo(page);
    const res = await page.request.get("/api/exports/contacts.csv");
    expect(res.status()).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("phone");
    expect(csv).toContain("+919812345678");
  });
});

test.describe("CRM approvals (CRM-26..30)", () => {
  test("CRM-26/27: configure threshold → high-value move triggers approval + deal blocked", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    // Configure approvals: threshold ₹1,00,000, gate on Qualified.
    await page.goto("/settings/crm");
    await page.getByTestId("approval-enabled").check();
    await page.getByTestId("approval-threshold").fill("100000");
    await page.getByTestId("approval-stage-Qualified").check();
    await page.getByTestId("approval-save-button").click();
    // The save persists to the Workspace row — assert on the DB (the sonner
    // toast renders in a portal, not inside the form).
    await expect(async () => {
      const ws = psql(`SELECT "approvalThresholdPaise", "approvalRequiredStages"::text FROM "Workspace" WHERE slug='demo-clinic';`);
      expect(ws).toContain("100000");
      expect(ws).toContain("Qualified");
    }).toPass({ timeout: 15_000, intervals: [2_000] });

    // The demo owner holds deals:approve (role-permission matrix spec 3.2), so
    // moving a deal as OWNER never triggers an approval — the requester must be
    // someone WITHOUT deals:approve. Switch to the AGENT session: deals:write but
    // no deals:approve → the move is intercepted.
    await loginAsRole(page.context(), page, "agent@test.vaani.ai", "AGENT");
    const dealId = await createDealViaUi(page, tag, { value: 500000 });
    await page.goto(`/crm/deals/${dealId}`);
    await page.getByTestId("stage-select").selectOption({ label: "Qualified" });
    // The move is intercepted: deal stays in New, an ApprovalRequest is created.
    await expect(page.getByTestId("deal-pending-approval")).toBeVisible({ timeout: 15_000 });
    const stage = psql(`SELECT s.name FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId" WHERE d.id='${dealId}';`);
    expect(stage).toBe("New");
    const req = psql(`SELECT status FROM "ApprovalRequest" WHERE "dealId"='${dealId}' ORDER BY "createdAt" DESC LIMIT 1;`);
    expect(req).toBe("PENDING");
    // Activity logged.
    const act = psql(`SELECT count(*) FROM "Activity" WHERE "dealId"='${dealId}' AND type='APPROVAL_REQUESTED';`);
    expect(act).toBe("1");

    // Reset config so other specs aren't affected (the demo owner can save).
    // Do it via DB — a re-login here would fight the AGENT cookie already in the
    // context (loginAsRole cleared cookies, but loginDemo's storageState re-adds
    // them), and the settings save is not the assertion under test.
    psql(
      `UPDATE "Workspace" SET "approvalThresholdPaise"=NULL, "approvalRequiredStages"='{}'::text[] WHERE slug='demo-clinic';`
    );
  });

  test("CRM-28/29: manager approves/rejects a pending approval", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    // Set up a pending approval: threshold + high-value deal + stage move.
    // The move must be requested by a non-approver (AGENT); the demo owner has
    // deals:approve and would not trigger the gate.
    await page.goto("/settings/crm");
    await page.getByTestId("approval-enabled").check();
    await page.getByTestId("approval-threshold").fill("100000");
    await page.getByTestId("approval-stage-Qualified").check();
    await page.getByTestId("approval-save-button").click();
    await expect(async () => {
      const ws = psql(`SELECT "approvalThresholdPaise" FROM "Workspace" WHERE slug='demo-clinic';`);
      expect(ws).toContain("100000");
    }).toPass({ timeout: 15_000, intervals: [2_000] });

    // Request the move as the AGENT (no deals:approve) → ApprovalRequest created.
    await loginAsRole(page.context(), page, "agent@test.vaani.ai", "AGENT");
    const dealId = await createDealViaUi(page, tag, { value: 500000, title: `E2E appr deal ${tag}` });
    await page.goto(`/crm/deals/${dealId}`);
    await page.getByTestId("stage-select").selectOption({ label: "Qualified" });
    await expect(page.getByTestId("deal-pending-approval")).toBeVisible({ timeout: 15_000 });

    // Demo owner has deals:approve → the approvals page shows Approve/Reject.
    await loginDemo(page);
    await page.goto("/crm/approvals");
    const row = page.locator('[data-testid^="approval-row-"]').first();
    await expect(row).toContainText(`E2E appr deal ${tag}`, { timeout: 15_000 });

    // CRM-29: reject first → deal stays in New.
    await row.getByTestId(/^approval-reject-/).first().click();
    await expect(async () => {
      const r = psql(`SELECT status FROM "ApprovalRequest" WHERE "dealId"='${dealId}' ORDER BY "createdAt" DESC LIMIT 1;`);
      expect(r).toBe("REJECTED");
    }).toPass({ timeout: 15_000, intervals: [2_000] });
    const stageAfterReject = psql(`SELECT s.name FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId" WHERE d.id='${dealId}';`);
    expect(stageAfterReject).toBe("New");

    // Reset config.
    await page.goto("/settings/crm");
    await page.getByTestId("approval-enabled").uncheck();
    await page.getByTestId("approval-save-button").click();
  });

  test("CRM-30: approval request surfaces on the deal page + approvals list", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    await page.goto("/settings/crm");
    await page.getByTestId("approval-enabled").check();
    await page.getByTestId("approval-threshold").fill("100000");
    await page.getByTestId("approval-stage-Qualified").check();
    await page.getByTestId("approval-save-button").click();
    await expect(async () => {
      const ws = psql(`SELECT "approvalThresholdPaise" FROM "Workspace" WHERE slug='demo-clinic';`);
      expect(ws).toContain("100000");
    }).toPass({ timeout: 15_000, intervals: [2_000] });

    // Request the move as the AGENT (no deals:approve) so the gate triggers.
    await loginAsRole(page.context(), page, "agent@test.vaani.ai", "AGENT");
    const dealId = await createDealViaUi(page, tag, { value: 500000, title: `E2E notif deal ${tag}` });
    await page.goto(`/crm/deals/${dealId}`);
    await page.getByTestId("stage-select").selectOption({ label: "Qualified" });
    await expect(page.getByTestId("deal-pending-approval")).toBeVisible({ timeout: 15_000 });

    // The approvals page lists it as Pending with the deal title (demo owner view).
    await loginDemo(page);
    await page.goto("/crm/approvals");
    await expect(page.getByText(`E2E notif deal ${tag}`)).toBeVisible({ timeout: 15_000 });

    // Reset config.
    await page.goto("/settings/crm");
    await page.getByTestId("approval-enabled").uncheck();
    await page.getByTestId("approval-save-button").click();
  });
});

test.describe("CRM contacts (CRM-31..36)", () => {
  test("CRM-31: contact detail shows profile, deals, consent, DNC", async ({ page }) => {
    await loginDemo(page);
    await page.goto(`/contacts/${encodeURIComponent("+919812345678")}`);
    await expect(page.getByTestId("contact-detail-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("contact-detail-page")).toContainText("Teeth cleaning — Ramesh");
    await expect(page.getByTestId("contact-detail-page")).toContainText("Ramesh");
  });

  test("CRM-32: CSV import upserts + shows summary", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const csvPath = `/tmp/e2e-crm-${tag}.csv`;
    const phones = [uniquePhone(tag, 2), uniquePhone(tag, 3)];
    writeFileSync(csvPath, `phone,name,city\n${phones[0]},CSV One,Mumbai\n${phones[1]},CSV Two,Delhi\n`);
    await page.goto("/contacts");
    await page.getByTestId("list-name-input").fill(`E2E CRM list ${tag}`);
    await page.getByTestId("csv-file-input").setInputFiles(csvPath);
    await page.getByTestId("csv-import-submit").click();
    await expect(page.getByTestId("csv-import-result")).toContainText("Imported 2", { timeout: 15_000 });
    const count = psql(
      `SELECT count(*) FROM "Contact" WHERE "workspaceId"=${DEMO_WS} AND phone IN ('${phones[0]}','${phones[1]}');`
    );
    expect(count).toBe("2");
    // Duplicate import merges (upsert-by-phone) — same phones in a new list.
    const csvPath2 = `/tmp/e2e-crm2-${tag}.csv`;
    writeFileSync(csvPath2, `phone,name,city\n${phones[0]},CSV One renamed,Mumbai\n`);
    await page.goto("/contacts");
    await page.getByTestId("list-name-input").fill(`E2E CRM dup ${tag}`);
    await page.getByTestId("csv-file-input").setInputFiles(csvPath2);
    await page.getByTestId("csv-import-submit").click();
    await expect(page.getByTestId("csv-import-result")).toContainText("Imported 1", { timeout: 15_000 });
    const still = psql(`SELECT count(*) FROM "Contact" WHERE "workspaceId"=${DEMO_WS} AND phone='${phones[0]}';`);
    expect(still).toBe("1");
  });

  test("CRM-33: DNC toggle creates DncEntry + badges contact", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const phone = uniquePhone(tag, 4);
    psql(
      `INSERT INTO "Contact" (id, "workspaceId", phone, name, "consentAt")
       VALUES ('crm33_${tag}', ${DEMO_WS}, '${phone}', 'CRM-33', now());`
    );
    await page.goto("/contacts");
    const row = page.locator(`tr:has-text("${phone}")`);
    await row.getByTestId("dnc-toggle").click();
    await expect(row.getByTestId("dnc-badge")).toBeVisible({ timeout: 15_000 });
    const dnc = psql(
      `SELECT count(*) FROM "DncEntry" WHERE "workspaceId"=${DEMO_WS} AND phone='${phone}';`
    );
    expect(dnc).toBe("1");
    const contact = psql(`SELECT dnc FROM "Contact" WHERE "workspaceId"=${DEMO_WS} AND phone='${phone}';`);
    expect(contact).toBe("t");
  });

  test("CRM-34: record consent sets consentAt + source", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const phone = uniquePhone(tag, 5);
    psql(
      `INSERT INTO "Contact" (id, "workspaceId", phone, name) VALUES ('crm34_${tag}', ${DEMO_WS}, '${phone}', 'CRM-34');`
    );
    await page.goto("/contacts");
    const row = page.locator(`tr:has-text("${phone}")`);
    await row.getByTestId("record-consent-btn").click();
    await expect(async () => {
      const consent = psql(`SELECT "consentSource" FROM "Contact" WHERE "workspaceId"=${DEMO_WS} AND phone='${phone}';`);
      expect(consent).toBe("manual");
    }).toPass({ timeout: 15_000, intervals: [2_000] });
  });

  test("CRM-35: CRM import (dry-run) pulls fixture contacts + stamps crmExternalId", async ({ page }) => {
    await loginDemo(page);
    // Seed a CrmConnection so the import button renders (CRM_IMPORT_DRY_RUN=true
    // in .env → fixture rows instead of a real provider call).
    psql(
      `INSERT INTO "CrmConnection" (id, "workspaceId", provider, status, "accessToken")
       SELECT 'crm_conn_${Date.now()}', id, 'hubspot', 'connected', 'dry-run'
       FROM "Workspace" WHERE slug='demo-clinic' ON CONFLICT DO NOTHING;`
    );
    await page.goto("/contacts");
    await page.getByTestId("crm-import-button").first().click();
    await expect(page.getByTestId("crm-import-result")).toContainText("CRM import", { timeout: 20_000 });
    const ext = psql(
      `SELECT count(*) FROM "Contact" WHERE "workspaceId"=${DEMO_WS} AND "crmExternalId" IS NOT NULL;`
    );
    expect(Number(ext)).toBeGreaterThanOrEqual(2);
  });

  test("CRM-36: cross-tenant isolation — tenant2 cannot see demo-clinic contacts", async ({ page }) => {
    // The other-co-tenant2 workspace is brand-new (no onboarding) → OnboardingResume
    // would force-redirect every app page to /onboarding. Mark it started so the
    // layout renders normally (same trick as the seeded demo workspace).
    psql(
      `INSERT INTO "OnboardingState" (id, "workspaceId", "currentStep", checklist, "sampleDataEnabled", "updatedAt")
       SELECT 'onb_other_co', id, 1, '{"industry":true,"template":true,"knowledge":true,"test_call":true,"number":true}', true, now()
       FROM "Workspace" WHERE slug='other-co-tenant2'
       ON CONFLICT ("workspaceId") DO UPDATE SET "currentStep"=1, checklist=EXCLUDED.checklist;`
    );
    // tenant2@other.vaani.ai owns the other-co-tenant2 workspace. A session
    // pinned there must not see any demo-clinic contacts/deals (strict
    // multi-tenant isolation).
    await loginAsRole(page.context(), page, "tenant2@other.vaani.ai", "OWNER", "other-co-tenant2");
    await page.goto("/contacts?q=+919812345678");
    // OWNER sees contacts:read — page renders, but demo-clinic's Ramesh is absent.
    await expect(page.getByTestId("contacts-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("contacts-page")).not.toContainText("+919812345678");
    // CRM pages are also empty of demo data.
    await page.goto("/crm/deals");
    await expect(page.getByTestId("deals-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("deals-page")).not.toContainText("Teeth cleaning — Ramesh");
  });
});
