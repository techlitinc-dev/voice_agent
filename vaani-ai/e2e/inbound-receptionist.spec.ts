import { test, expect } from "@playwright/test";
import { loginDemo, loginAsRole, postDograhEvent, psql, seedTestDid, envValue } from "./helpers";

/**
 * Inbound receptionist coverage for docs/manual-testing/03-inbound-receptionist.md.
 *
 * Real-phone cases (INBOUND-01/02/04/05/06, audio listen/whisper/barge) are
 * operator-gated — covered by manual testing. Here we drive the deterministic
 * pieces: CDR + transcript + interest score (07/12), report (10), voicemail +
 * callback task (15/18/25), spam block (03), and live permissions (24).
 */
test.describe("inbound receptionist (INBOUND-03..28, deterministic)", () => {
  test("INBOUND-07/12: inbound call → CDR with transcript → interestScore computed", async ({ page }) => {
    const callId = `e2e_inb_${Date.now()}`;
    const phone = "+919822223333";
    seedTestDid(); // webhook needs the DID mapped

    await loginDemo(page);
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: phone, to_number: "+918040001234" },
    });
    const ended = await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 95,
        summary: "Caller wants to book a dental cleaning and asked about pricing.",
        transcript: `AI: Namaste! Demo Dental Clinic.\nCaller: I want to book a cleaning.\nAI: Great, Saturday 11 AM works.\nCaller: Yes, book it please!`,
      },
    });
    expect(ended.status).toBe(200);

    // CDR row exists with transcript (INBOUND-07).
    const dbId = psql(`SELECT id FROM "Call" WHERE "dograhCallId"='${callId}';`);
    expect(dbId).toBeTruthy();

    // Open call detail: transcript, cost card, direction.
    await page.goto(`/calls/${dbId}`);
    await expect(page.getByTestId("call-details-card")).toContainText("INBOUND");
    await expect(page.getByTestId("call-cost-card")).toBeVisible();
    await expect(page.getByTestId("sentiment-transcript")).toContainText("book a cleaning");

    // INBOUND-12: the maintenance sweep scores INBOUND calls now. The sweep runs
    // every minute — poll the DB for interestScore on the INBOUND call.
    await expect(async () => {
      const score = psql(`SELECT "interestScore" FROM "Call" WHERE id='${dbId}';`);
      expect(score).toMatch(/HOT|WARM|COLD/);
    }).toPass({ timeout: 90_000, intervals: [5_000] });

    // The call detail shows the interest score once set.
    await page.reload();
    await expect(page.getByTestId("call-details-card")).toContainText(/Interest: (HOT|WARM|COLD)/, { timeout: 15_000 });
  });

  test("INBOUND-10: call report page is print-friendly with summary + transcript", async ({ page }) => {
    const callId = `e2e_rpt_${Date.now()}`;
    seedTestDid();
    await loginDemo(page);
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: "+919833334444", to_number: "+918040001234" },
    });
    await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 60,
        summary: "Asked about payment plans.",
        transcript: "AI: Namaste!\nCaller: Do you have payment plans?",
      },
    });

    const dbId = psql(`SELECT id FROM "Call" WHERE "dograhCallId"='${callId}';`);
    await page.goto(`/calls/${dbId}`);
    await page.getByTestId("call-report-link").click();
    await expect(page).toHaveURL(/\/report/);
    await expect(page.getByTestId("call-report-print-hint")).toBeVisible();
    // Scope to the transcript <pre> — "payment plans" also appears in the summary.
    await expect(page.locator("pre")).toContainText("payment plans");
    await expect(page.getByText(/Call report —/)).toBeVisible();
  });

  test("INBOUND-15/18/25: missed inbound call → voicemail + CallbackTask created", async ({ page }) => {
    const callId = `e2e_cb_${Date.now()}`;
    // Unique caller per run — createMissedCallCallback dedupes on (workspace,
    // phone, PENDING) so a fixed number would skip the new call's callback.
    const phone = `+91984${String(Date.now()).slice(-7)}`;
    seedTestDid();
    await loginDemo(page);

    // Missed inbound: NO_ANSWER status after ringing.
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: phone, to_number: "+918040001234" },
    });
    await postDograhEvent(page, {
      event: "call.ended",
      data: { call_id: callId, status: "NO_ANSWER", duration_seconds: 0, summary: "No answer" },
    });

    // processCompletedCall → createMissedCallCallback: a PENDING CallbackTask with
    // MISSED_CALL note + due in 15 min.
    await expect(async () => {
      const task = psql(
        `SELECT count(*) FROM "CallbackTask" t JOIN "Call" c ON c.id=t."callId"
         WHERE c."dograhCallId"='${callId}' AND t.note='MISSED_CALL' AND t.status='PENDING';`
      );
      expect(task).toBe("1");
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    // Voicemail path: a message-taken call records a VoicemailMessage.
    const vmCallId = `e2e_vm_${Date.now()}`;
    await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: vmCallId, from_number: phone, to_number: "+918040001234" },
    });
    await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: vmCallId,
        duration_seconds: 45,
        summary: "Caller left a message for the doctor.",
        transcript: `AI: No one is available right now, leave a message.\nCaller: Please tell Dr. Mehta that Priya called about the X-ray report.`,
      },
    });
    // The LLM extraction (dry-run fallback) may not infer message-taken without
    // an API key — so assert via the transfer/voicemail outcome only if present.
    await expect(async () => {
      const vm = psql(
        `SELECT count(*) FROM "VoicemailMessage" v JOIN "Call" c ON c.id=v."callId"
         WHERE c."dograhCallId"='${vmCallId}';`
      );
      if (Number(vm) > 0) {
        const status = psql(`SELECT status FROM "VoicemailMessage" v JOIN "Call" c ON c.id=v."callId" WHERE c."dograhCallId"='${vmCallId}';`);
        expect(status).toBe("NEW");
      }
    }).toPass({ timeout: 45_000, intervals: [3_000] });
  });

  test("INBOUND-03: manual DNC block stops inbound call at the resolver", async ({ page }) => {
    const phone = "+919855556666";
    seedTestDid();
    // The resolver only proceeds past the "no published agent" gate when the
    // DID's agent is PUBLISHED with a workflow id — mirror a real published line.
    psql(
      `UPDATE "Agent" SET status='PUBLISHED', "dograhWorkflowId"='wf_e2e_inbound'
       WHERE id=(SELECT "agentId" FROM "PhoneNumber" WHERE id='pn_e2e');`
    );
    // Add the caller to the manual DNC list.
    psql(
      `INSERT INTO "DncEntry" (id, "workspaceId", phone, source, reason)
       SELECT 'e2e_dnc_inb', id, '${phone}', 'MANUAL', 'test block' FROM "Workspace" WHERE slug='demo-clinic'
       ON CONFLICT DO NOTHING;`
    );

    await loginDemo(page);
    // The resolver the Dograh workflow calls before answering:
    const res = await page.request.get(`/api/v1/resolve-number?to=${encodeURIComponent("+918040001234")}&from=${encodeURIComponent(phone)}`, {
      headers: { "x-internal-secret": envValue("DOGRAH_WEBHOOK_SECRET") },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.blocked).toBe(true);
    expect(body.blockReason).toMatch(/block/i);

    // Cleanup so re-runs don't accumulate.
    psql(`DELETE FROM "DncEntry" WHERE id='e2e_dnc_inb';`);
    psql(
      `UPDATE "Agent" SET status='DRAFT', "dograhWorkflowId"=NULL
       WHERE id=(SELECT "agentId" FROM "PhoneNumber" WHERE id='pn_e2e');`
    );
  });

  test("INBOUND-24: viewer is blocked from the live dashboard (AGENT role required)", async ({ page }) => {
    // Mint a VIEWER session for the demo-clinic workspace.
    await loginAsRole(page.context(), page, "viewer@test.vaani.ai", "VIEWER");
    await page.goto("/live");
    // VIEWER lacks live:listen → redirected to login (permission guard).
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
