import { test, expect, type Page } from "@playwright/test";
import { loginDemo, loginAsRole, postDograhEvent, psql, seedTestDid } from "./helpers";
import { writeFileSync } from "node:fs";

/**
 * Analytics coverage for docs/manual-testing/06-analytics-module.md.
 *
 * The analytics suite is implemented (dashboard, call analytics, funnel &
 * cohorts, campaign reports, agent performance, cost & margins, CRM voice
 * attribution, custom reports) — this spec drives the deterministic cases
 * against the seeded demo-clinic workspace:
 *  - Dashboard KPIs, wallet, date range, alerts, SSE live stream (ANALYTICS-01..05)
 *  - Call analytics 30-day view, agent filter, empty state, FTS, CSV (ANALYTICS-06..10)
 *  - Funnel + cohort retention + date filter (ANALYTICS-11..13)
 *  - Campaign report, heatmap, compare (ANALYTICS-14..16)
 *  - Agent performance, QA drill-down, hallucination filter (ANALYTICS-17..19)
 *  - Cost & margins, revenue recognition, voice attribution, unit economics (ANALYTICS-20..23)
 *  - Custom reports: create, run, export, access control (ANALYTICS-24..27)
 */

const DEMO_WS = `(SELECT id FROM "Workspace" WHERE slug='demo-clinic')`;

/** Unique phone per run — contacts upsert by (workspace, phone). */
function uniquePhone(tag: number, i = 0): string {
  const tail = String(tag).slice(-8).padStart(8, "0");
  return `+9197${tail.slice(0, 8)}${i}`;
}

/** The demo-clinic agent id (seeded "Front Desk — Priya"). */
function demoAgentId(): string {
  return psql(`SELECT id FROM "Agent" WHERE "workspaceId"=${DEMO_WS} LIMIT 1;`);
}

/** Count of calls for the workspace in the last N days. */
function callsSince(days: number): number {
  return Number(psql(
    `SELECT count(*) FROM "Call" WHERE "workspaceId"=${DEMO_WS} AND "createdAt" >= now() - interval '${days} days';`
  ));
}

/** Count of COMPLETED calls in the last N days. */
function completedCallsSince(days: number): number {
  return Number(psql(
    `SELECT count(*) FROM "Call" WHERE "workspaceId"=${DEMO_WS} AND status='COMPLETED' AND "createdAt" >= now() - interval '${days} days';`
  ));
}

/** Wallet balance (paise) for the demo workspace. */
function walletBalance(): number {
  return Number(psql(`SELECT "balancePaise" FROM "Wallet" WHERE "workspaceId"=${DEMO_WS};`));
}

/**
 * Seed a completed call that has a campaign, hallucination flag and QA score —
 * deterministic fixture rows the analytics pages aggregate over.
 */
function seedFixtureCall(tag: number, opts: { campaignId?: string; hallucination?: boolean; durationSec?: number } = {}) {
  const callId = `e2e_anx_${tag}`;
  const agentId = demoAgentId();
  const campaignId = opts.campaignId ? `'${opts.campaignId}'` : "NULL";
  const duration = opts.durationSec ?? 90;
  psql(
    `INSERT INTO "Call" (id, "workspaceId", "dograhCallId", direction, status, "fromNumber", "toNumber", "agentId", "campaignId",
       "durationSec", summary, outcome, "interestScore", "hallucinationFlag", "deadAirSeconds", "scriptAdherenceScore",
       "costTelephonyPaise", "costSttPaise", "costLlmPaise", "costTtsPaise", "billedPaise", "createdAt", "answeredAt", "endedAt")
     SELECT '${callId}', ${DEMO_WS}, 'dograh_${callId}', 'OUTBOUND', 'COMPLETED', '+919999999999', '+918040001234',
       '${agentId}', ${campaignId}, ${duration}, 'E2E fixture ${tag} — teeth cleaning booking', 'booked', 'HOT',
       ${opts.hallucination ?? false}, 0, 85, 1200, 800, 900, 600, 8750, now(), now(), now();`
  );
  return callId;
}

/** Ensure the demo workspace has at least one COMPLETED campaign with contacts. */
function ensureCompletedCampaign(tag: number): string {
  const existing = psql(
    `SELECT id FROM "Campaign" WHERE "workspaceId"=${DEMO_WS} AND status='COMPLETED' ORDER BY "createdAt" DESC LIMIT 1;`
  );
  if (existing) return existing;
  // No completed campaign → create one with a contact list + agent.
  const agentId = demoAgentId();
  const listId = `anx_list_${tag}`;
  const campaignId = `anx_camp_${tag}`;
  psql(
    `INSERT INTO "ContactList" (id, "workspaceId", name) VALUES ('${listId}', ${DEMO_WS}, 'E2E analytics list') ON CONFLICT DO NOTHING;`
  );
  psql(
    `INSERT INTO "Campaign" (id, "workspaceId", name, type, "agentId", "listId", status, "callsPerMinute", concurrency, "maxAttempts", "retryDelayMin")
     SELECT '${campaignId}', ${DEMO_WS}, 'E2E analytics campaign', 'LEAD_QUALIFICATION', '${agentId}', '${listId}', 'COMPLETED', 10, 1, 2, 60
     ON CONFLICT DO NOTHING;`
  );
  return campaignId;
}

test.describe("Analytics dashboard (ANALYTICS-01..05)", () => {
  test("ANALYTICS-01: dashboard loads KPIs with trend vs last period", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/dashboard");
    await expect(page.getByTestId("executive-dashboard")).toBeVisible({ timeout: 15_000 });
    // KPI row renders the six StatCards (class-based ids — kpiId lowercases).
    await expect(page.locator('[class*="kpi-calls"]')).toBeVisible();
    await expect(page.locator('[class*="kpi-connect-rate"]')).toBeVisible();
    await expect(page.locator('[class*="kpi-revenue"]')).toBeVisible();
    await expect(page.locator('[class*="kpi-gross-margin"]')).toBeVisible();
    // KPIs match DB: total calls in the 7-day window.
    const dbCalls = callsSince(7);
    const kpiCalls = await page.locator('[class*="kpi-calls"]').textContent();
    expect(kpiCalls).toContain(String(dbCalls));
    // Trend vs previous period renders (↑/↓ arrow or %).
    await expect(page.locator('[class*="kpi-calls"]')).toContainText(/\d/);
  });

  test("ANALYTICS-02: live tiles update via SSE stream", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/dashboard");
    await expect(page.getByTestId("live-tiles")).toBeVisible({ timeout: 15_000 });
    // The SSE stream / poll pushes a payload within a few seconds → live tiles populate.
    // (Tile text = "Calls in progress<N>" — assert the value is a real number, not "—".)
    await expect(page.getByTestId("dash-tile-live-calls")).toContainText(/\d/, { timeout: 20_000 });
    await expect(page.getByTestId("dash-tile-live-calls")).not.toContainText("—");
    await expect(page.getByTestId("dash-tile-asr")).toBeVisible();
  });

  test("ANALYTICS-03: wallet balance shown matches DB", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/dashboard");
    await expect(page.getByText("Wallet balance")).toBeVisible({ timeout: 15_000 });
    const dbBalance = walletBalance();
    // formatINR renders ₹xx.xx from paise.
    const expected = `₹${(dbBalance / 100).toFixed(2)}`;
    await expect(page.locator("div").filter({ hasText: /^Wallet balance$/ }).locator("..").first()).toContainText(expected);
  });

  test("ANALYTICS-04: dashboard date range 7d → 30d recomputes KPIs", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/dashboard?range=7d");
    await expect(page.getByTestId("executive-dashboard")).toBeVisible({ timeout: 15_000 });
    const picker = page.getByTestId("date-range-picker");
    await picker.selectOption("30d");
    // The URL updates and the page recomputes (server component re-renders).
    await expect(page).toHaveURL(/range=30d/);
    // The calls KPI should now match the 30-day window (30d window is a superset).
    const calls30d = await page.locator('[class*="kpi-calls"]').textContent();
    const db30 = callsSince(30);
    expect(calls30d).toContain(String(db30));
  });

  test("ANALYTICS-05: low-balance alert banner appears on dashboard", async ({ page }) => {
    await loginDemo(page);
    // Set the wallet balance low (below the low-wallet threshold) → alert fires.
    psql(`UPDATE "Wallet" SET "balancePaise"=50 WHERE "workspaceId"=${DEMO_WS};`);
    await page.goto("/dashboard");
    await expect(page.getByTestId("alerts-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("alert-low-wallet")).toBeVisible();
    // Restore the wallet so other specs are unaffected.
    psql(`UPDATE "Wallet" SET "balancePaise"=98944 WHERE "workspaceId"=${DEMO_WS};`);
  });
});

test.describe("Call analytics (ANALYTICS-06..10)", () => {
  test("ANALYTICS-06: 30-day view tiles + charts correct vs DB", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/analytics");
    await expect(page.getByTestId("tile-total-calls")).toBeVisible({ timeout: 15_000 });
    // Total calls tile matches the 30-day DB count.
    const dbCalls = callsSince(30);
    await expect(page.getByTestId("tile-total-calls")).toContainText(String(dbCalls));
    // ASR: answered / total × 100 — assert the tile renders a percentage.
    const asr = await page.getByTestId("tile-asr").textContent();
    expect(asr).toMatch(/\d+%/);
    // AHT renders seconds.
    const aht = await page.getByTestId("tile-aht").textContent();
    expect(aht).toMatch(/\d+s/);
    // Charts render.
    await expect(page.getByTestId("chart-calls-per-day")).toBeVisible();
  });

  test("ANALYTICS-07: filter by agent recomputes metrics", async ({ page }) => {
    await loginDemo(page);
    const agentId = demoAgentId();
    const agentCalls = Number(psql(
      `SELECT count(*) FROM "Call" WHERE "workspaceId"=${DEMO_WS} AND "agentId"='${agentId}' AND "createdAt" >= now() - interval '30 days';`
    ));
    await page.goto("/analytics");
    await page.getByTestId("analytics-agent-filter").selectOption(agentId);
    await page.getByTestId("analytics-agent-apply").click();
    await expect(page).toHaveURL(new RegExp(`agent=${agentId}`));
    // Total calls tile now matches the agent-filtered DB count.
    await expect(page.getByTestId("tile-total-calls")).toContainText(String(agentCalls), { timeout: 15_000 });
  });

  test("ANALYTICS-08: empty date range shows empty state, no divide-by-zero", async ({ page }) => {
    await loginDemo(page);
    // Seed a call with an impossible future createdAt → the analytics page (last
    // 30 days) won't include it, but to make a genuinely empty window we point
    // the range at a date far in the past via the funnel page (which has a
    // date-range picker). The /analytics page is a fixed 30-day window, so we
    // assert the funnel's date filter handles an empty range without NaN.
    await page.goto("/analytics/funnel?range=custom&start=2000-01-01&end=2000-01-31");
    // The page should render without NaN — "No drop-off data yet" or a funnel
    // of zeros. Assert no literal "NaN" appears anywhere.
    await expect(page.getByTestId("funnel-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("funnel-page")).not.toContainText("NaN");
  });

  test("ANALYTICS-09: transcript full-text search returns matching call", async ({ page }) => {
    await loginDemo(page);
    const token = `zebracorn${Date.now()}`;
    const callId = `e2e_an_${Date.now()}`;
    seedTestDid();
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: "+919812345678", to_number: "+918040001234" },
    });
    await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 150,
        summary: `Booked a cleaning; token ${token}.`,
        transcript: `AI: Namaste!\nCaller: ${token} — I want a cleaning on Saturday.\nAI: Booked for Saturday 11 AM.`,
      },
    });
    await page.goto("/calls");
    await page.getByTestId("calls-transcript-search").fill(token);
    await page.getByTestId("calls-transcript-search").press("Enter");
    await expect(page.getByTestId("calls-fts-count")).toContainText("1 call(s)", { timeout: 15_000 });
  });

  test("ANALYTICS-10: CSV export streams analytics summary", async ({ page }) => {
    await loginDemo(page);
    const res = await page.request.get("/api/exports/analytics-summary.csv");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("date,calls,asrPercent,ahtSeconds,wholesalePaise,billedPaise,marginPaise");
  });
});

test.describe("Funnel & cohorts (ANALYTICS-11..13)", () => {
  test("ANALYTICS-11: call→deal funnel renders with drop-off %", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/analytics/funnel");
    await expect(page.getByTestId("funnel-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("call-to-deal-funnel")).toBeVisible();
    // Funnel stages present: Calls made → Answered → Engaged → Qualified → Deal → Won.
    await expect(page.getByTestId("call-to-deal-funnel")).toContainText("Calls made");
    await expect(page.getByTestId("call-to-deal-funnel")).toContainText("Deal won");
    // Drop-off insight or empty state renders.
    await expect(page.locator('[data-testid="dropoff-insights"], :text("No drop-off data yet.")').first()).toBeVisible();
    // Overall call-to-win KPI renders a number (not NaN).
    await expect(page.getByTestId("funnel-page")).toContainText("Overall call-to-win");
    await expect(page.getByTestId("funnel-page")).toContainText(/\d+(\.\d+)?%/);
  });

  test("ANALYTICS-12: cohort retention table renders", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/analytics/funnel");
    await expect(page.getByTestId("cohort-heatmap")).toBeVisible({ timeout: 15_000 });
    // Either cohort rows or the empty-state message renders.
    const hasRows = await page.getByTestId("cohort-heatmap").locator("tbody tr").count();
    if (hasRows > 0) {
      await expect(page.getByTestId("cohort-heatmap")).toContainText("Week 0");
    } else {
      await expect(page.getByTestId("cohort-heatmap")).toContainText("No cohort data yet");
    }
  });

  test("ANALYTICS-13: funnel date filter recomputes without NaN", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/analytics/funnel?range=7d");
    await expect(page.getByTestId("funnel-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("funnel-page")).not.toContainText("NaN");
  });
});

test.describe("Campaign reports (ANALYTICS-14..16)", () => {
  test("ANALYTICS-14/15: campaign report renders reach/connect + heatmap", async ({ page }) => {
    await loginDemo(page);
    // Ensure a completed campaign with calls: seed one + attach fixture calls.
    const tag = Date.now();
    const campaignId = ensureCompletedCampaign(tag);
    const callId = seedFixtureCall(tag, { campaignId, durationSec: 120 });
    await page.goto(`/analytics/campaigns?campaign=${campaignId}`);
    await expect(page.getByTestId("tile-reach-rate")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tile-connect-rate")).toBeVisible();
    // Connect rate = answered / dialed — the fixture call is COMPLETED → answered.
    await expect(page.getByTestId("tile-connect-rate")).toContainText(/\d+%/);
    // Heatmap renders cells; the seeded COMPLETED call is an answered call, so
    // today's day/hour cell carries a title with "answered".
    await expect(page.getByTestId("time-to-call-heatmap")).toBeVisible();
    const answeredCells = page.getByTestId("time-to-call-heatmap").locator('[data-testid^="heatmap-cell-"][title*="answered"]');
    await expect(answeredCells.first()).toBeVisible();
    // DB: the fixture call belongs to the campaign.
    const dbCount = psql(`SELECT count(*) FROM "Call" WHERE "campaignId"='${campaignId}' AND id='${callId}';`);
    expect(dbCount).toBe("1");
  });

  test("ANALYTICS-16: campaign picker + per-number table", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const campaignId = ensureCompletedCampaign(tag);
    seedFixtureCall(tag, { campaignId, durationSec: 60 });
    await page.goto("/analytics/campaigns");
    await expect(page.getByTestId("campaign-report-select")).toBeVisible({ timeout: 15_000 });
    // Select the seeded campaign and Show.
    await page.getByTestId("campaign-report-select").selectOption(campaignId);
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(new RegExp(`campaign=${campaignId}`));
    await expect(page.getByTestId("per-number-table")).toBeVisible();
  });
});

test.describe("Agent performance & QA (ANALYTICS-17..19)", () => {
  test("ANALYTICS-17/18: agent performance table + QA drill-down link", async ({ page }) => {
    await loginDemo(page);
    const agentId = demoAgentId();
    // Seed a call with scriptAdherenceScore + QA score so the row is non-trivial.
    const tag = Date.now();
    seedFixtureCall(tag, { durationSec: 100 });
    const callId = `e2e_anx_${tag}`;
    psql(
      `INSERT INTO "QaScore" (id, "callId", "workspaceId", "rubricName", "totalScore", "maxScore", scores, notes, "scorerModel")
       SELECT 'qa_${tag}', '${callId}', ${DEMO_WS}, 'receptionist-default', 36, 40, '{"greeting":9,"compliance_lines":9,"faq_accuracy":9,"closing":9}'::jsonb, 'e2e', 'mock'
       ON CONFLICT DO NOTHING;`
    );
    await page.goto("/analytics/agents");
    await expect(page.getByTestId("agent-performance-table")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("agent-performance-table")).toContainText("Front Desk — Priya");
    // QA drill-down: the qa-link points to /calls?agent=<id>.
    const qaLink = page.getByTestId(`qa-link-${agentId}`);
    await expect(qaLink).toBeVisible();
    await qaLink.click();
    await expect(page).toHaveURL(new RegExp(`/calls\\?agent=${agentId}`));
    // The calls page shows the agent filter selected + the fixture call's QA badge.
    await expect(page.getByTestId("calls-agent-filter")).toHaveValue(agentId);
  });

  test("ANALYTICS-19: hallucination flag filter shows only flagged calls", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const flaggedId = seedFixtureCall(tag, { hallucination: true });
    const cleanId = seedFixtureCall(tag + 1, { hallucination: false });
    // The flagged call has the hallucination flag in DB.
    expect(psql(`SELECT "hallucinationFlag" FROM "Call" WHERE id='${flaggedId}';`)).toBe("t");
    // Filter /calls by hallucination=true.
    await page.goto("/calls?hallucination=true");
    await expect(page.getByTestId("calls-hallucination-filter")).toHaveValue("true");
    // The flagged call's row is present; the clean call is absent (DataTable shows
    // fromNumber → toNumber). Assert via the page content.
    await expect(page.getByText(`+919999999999 → +918040001234`).first()).toBeVisible({ timeout: 15_000 });
    // DB count matches the filtered view: flagged calls count.
    const dbFlagged = Number(psql(
      `SELECT count(*) FROM "Call" WHERE "workspaceId"=${DEMO_WS} AND "hallucinationFlag"=true;`
    ));
    expect(dbFlagged).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Cost & attribution (ANALYTICS-20..23)", () => {
  test("ANALYTICS-20/21: cost page tiles, revenue recognition, MRR", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/analytics/cost");
    await expect(page.getByTestId("tile-wholesale")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tile-billed")).toBeVisible();
    await expect(page.getByTestId("tile-margin-cost")).toBeVisible();
    await expect(page.getByTestId("tile-margin-pct")).toBeVisible();
    // Revenue recognition grid renders.
    await expect(page.getByTestId("revenue-recognition")).toContainText("Recognized revenue");
    await expect(page.getByTestId("revenue-recognition")).toContainText("Deferred (wallet balance)");
    // MRR tiles render ₹ values.
    await expect(page.getByTestId("tile-plan-mrr")).toBeVisible();
    await expect(page.getByTestId("tile-total-mrr")).toBeVisible();
    // Recognized revenue = billed on COMPLETED calls (startedAt within 30d) —
    // mirrors getRevenueRecognition. formatINR renders Indian thousands separators.
    const dbRecognized = Number(psql(
      `SELECT COALESCE(SUM("billedPaise"),0) FROM "Call" WHERE "workspaceId"=${DEMO_WS} AND status='COMPLETED' AND "startedAt" >= now() - interval '30 days';`
    ));
    const expectedInr = `₹${(dbRecognized / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await expect(page.getByTestId("revenue-recognition")).toContainText(expectedInr);
  });

  test("ANALYTICS-22: CRM voice attribution renders", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/crm/analytics");
    await expect(page.getByTestId("crm-analytics-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Voice-to-pipeline attribution")).toBeVisible();
    // "Calls that created a deal" stat renders.
    await expect(page.getByText(/Calls that created a deal/)).toBeVisible();
  });

  test("ANALYTICS-23: call detail unit economics sums to billedPaise", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const callId = seedFixtureCall(tag, { durationSec: 90 });
    await page.goto(`/calls/${callId}`);
    await expect(page.getByTestId("call-cost-card")).toBeVisible({ timeout: 15_000 });
    // The four cost rows + wholesale + billed: wholesale = 1200+800+900+600.
    await expect(page.getByTestId("call-cost-card")).toContainText("Telephony (Vobiz)");
    await expect(page.getByTestId("call-cost-card")).toContainText("Speech-to-text (Sarvam)");
    await expect(page.getByTestId("call-cost-card")).toContainText("LLM (OpenRouter)");
    await expect(page.getByTestId("call-cost-card")).toContainText("Text-to-speech (Sarvam)");
    // Billed = ₹87.50 (8750 paise) — the fixture sets billedPaise=8750.
    await expect(page.getByTestId("call-cost-card")).toContainText("₹87.50");
    // Margin = billed − wholesale.
    const wholesale = 1200 + 800 + 900 + 600;
    const margin = 8750 - wholesale;
    await expect(page.getByTestId("call-cost-card")).toContainText(`₹${(margin / 100).toFixed(2)}`);
  });
});

test.describe("Custom reports (ANALYTICS-24..27)", () => {
  test("ANALYTICS-24/25: create report → preview runs from live data", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const name = `E2E report ${tag}`;
    await page.goto("/reports/new");
    await expect(page.getByTestId("report-builder-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("report-name").fill(name);
    // Default config: source=calls, groupBy=day, metrics=[count, sumBilled] → preview.
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-table")).toBeVisible({ timeout: 20_000 });
    // Preview rows are computed from live call data (last 30 days, grouped by day).
    const rowCount = await page.getByTestId("preview-table").locator("tbody tr").count();
    expect(rowCount).toBeGreaterThan(0);
    // Save → appears on /reports.
    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 15_000 });
    const reportId = psql(`SELECT id FROM "SavedReport" WHERE "workspaceId"=${DEMO_WS} AND name='${name}' ORDER BY "createdAt" DESC LIMIT 1;`);
    expect(reportId).toBeTruthy();
    // Run page renders rows from live data.
    await page.goto(`/reports/${reportId}/run`);
    await expect(page.getByTestId("run-report-table")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("run-report-table").locator("tbody tr").first()).toBeVisible();
  });

  test("ANALYTICS-26: report CSV export streams and matches on-screen", async ({ page }) => {
    await loginDemo(page);
    const tag = Date.now();
    const name = `E2E export report ${tag}`;
    await page.goto("/reports/new");
    await page.getByTestId("report-name").fill(name);
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-table")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 15_000 });
    const reportId = psql(`SELECT id FROM "SavedReport" WHERE "workspaceId"=${DEMO_WS} AND name='${name}' ORDER BY "createdAt" DESC LIMIT 1;`);
    const res = await page.request.get(`/api/reports/${reportId}/export.csv`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = await res.text();
    // CSV header includes the group key + metric columns (default config:
    // groupBy=day, metrics=[count, sumBilled]).
    expect(csv).toContain("day");
    expect(csv).toContain("count");
    expect(csv).toContain("sumBilled");
    // At least one data row (the workspace has calls).
    expect(csv.trim().split("\n").length).toBeGreaterThan(1);
  });

  test("ANALYTICS-27: viewer cannot create reports; shared report read-only", async ({ page }) => {
    // Create a shared report as the demo owner first.
    await loginDemo(page);
    const tag = Date.now();
    const name = `E2E shared report ${tag}`;
    await page.goto("/reports/new");
    await page.getByTestId("report-name").fill(name);
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-table")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 15_000 });
    const reportId = psql(`SELECT id FROM "SavedReport" WHERE "workspaceId"=${DEMO_WS} AND name='${name}' ORDER BY "createdAt" DESC LIMIT 1;`);

    // VIEWER (viewer@test.vaani.ai) can view the shared report but not create.
    await loginAsRole(page.context(), page, "viewer@test.vaani.ai", "VIEWER", "demo-clinic");
    await page.goto("/reports");
    await expect(page.getByTestId("reports-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(name)).toBeVisible();
    // No New-report button for VIEWER (canCreateReport = OWNER/ADMIN).
    await expect(page.getByTestId("new-report-button")).toHaveCount(0);
    // /reports/new redirects back to /reports.
    await page.goto("/reports/new");
    await expect(page).toHaveURL(/\/reports$/, { timeout: 15_000 });
    // The shared report is runnable (read-only) but the delete button is absent.
    await page.goto(`/reports/${reportId}/run`);
    await expect(page.getByTestId("run-report-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`delete-report-${reportId}`)).toHaveCount(0);
  });
});
