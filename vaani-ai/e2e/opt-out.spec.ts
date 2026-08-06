import { test, expect } from "@playwright/test";
import { loginDemo, postDograhEvent, psql, seedTestDid } from "./helpers";

test.describe("opt-out cascade (readme §11, guides 06/07)", () => {
  test('"stop calling me" on a call flips Contact.dnc + creates DncEntry + UI badge', async ({ page }) => {
    const phone = "+919800009999";
    seedTestDid(); // the webhook handler needs the DID mapped (else it 200-ignores)
    psql(
      `INSERT INTO "Contact" (id, "workspaceId", phone, name)
       SELECT 'e2e_optout_c', id, '${phone}', 'E2E OptOut' FROM "Workspace" WHERE slug='demo-clinic'
       ON CONFLICT DO NOTHING;`
    );

    await loginDemo(page);
    const callId = `e2e_optout_${Date.now()}`;
    const started = await postDograhEvent(page, {
      event: "call.started",
      data: { call_id: callId, from_number: phone, to_number: "+918040001234" },
    });
    expect(started.status).toBe(200);
    const ended = await postDograhEvent(page, {
      event: "call.ended",
      data: {
        call_id: callId,
        duration_seconds: 42,
        summary: "Caller asked to never be called again.",
        transcript: "AI: Hello!\nCaller: Stop calling me! Mujhe dobara call mat karna.",
      },
    });
    expect(ended.status).toBe(200);

    // Post-call pipeline is async — poll the DB, then check the UI badge.
    await expect(async () => {
      const dnc = psql(
        `SELECT count(*) FROM "Contact" c JOIN "Workspace" w ON w.id=c."workspaceId"
         WHERE w.slug='demo-clinic' AND c.phone='${phone}' AND c.dnc=true;`
      );
      expect(dnc).toBe("1");
      const entry = psql(
        `SELECT count(*) FROM "DncEntry" d JOIN "Workspace" w ON w.id=d."workspaceId"
         WHERE w.slug='demo-clinic' AND d.phone='${phone}';`
      );
      expect(Number(entry)).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    await page.goto("/contacts");
    await expect(page.getByTestId("dnc-badge").first()).toBeVisible({ timeout: 15_000 });
  });
});
