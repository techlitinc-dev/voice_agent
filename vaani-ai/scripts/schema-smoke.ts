import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const db = new PrismaClient();
let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  // clean previous runs
  await db.workspace.deleteMany({ where: { slug: { in: ["smoke-test-ws", "smoke-child-ws"] } } });
  await db.user.deleteMany({ where: { email: "smoke@vaani.dev" } });
  await db.plan.deleteMany({ where: { code: "smoke-plan" } });

  const ws = await db.workspace.create({
    data: {
      name: "Smoke WS",
      slug: "smoke-test-ws",
      logoUrl: "https://example.com/logo.png",
      primaryColor: "#112233",
      customDomain: "smoke.example.com",
      whiteLabelEnabled: true,
      recordingDisclosureText: "This call is recorded.",
    },
  });
  assert(ws.customDomain === "smoke.example.com" && ws.whiteLabelEnabled, "white-label fields");
  ok("workspace + white-label fields");

  const user = await db.user.create({
    data: { email: "smoke@vaani.dev", passwordHash: "smoke", fullName: "Smoke User" },
  });
  const m = await db.membership.create({
    data: {
      userId: user.id,
      workspaceId: ws.id,
      role: "MANAGER",
      grantedPermissions: ["campaigns:write"],
      revokedPermissions: ["billing:read"],
    },
  });
  assert(m.grantedPermissions.includes("campaigns:write") && m.revokedPermissions.includes("billing:read"), "permissions arrays");
  ok("membership granular permissions");

  const totp = await db.totpSecret.create({ data: { userId: user.id, secret: "SMOKEBASE32", status: "PENDING" } });
  assert(totp.status === "PENDING", "totp status");
  ok("totpSecret enroll state");

  const sso = await db.ssoIdentity.create({
    data: { userId: user.id, workspaceId: ws.id, provider: "SAML", externalSubjectId: "saml-sub-1", email: "smoke@vaani.dev" },
  });
  assert(sso.provider === "SAML", "sso provider");
  ok("ssoIdentity (SAML)");

  const apiKey = await db.apiKey.create({
    data: {
      workspaceId: ws.id,
      name: "smoke key",
      keyPrefix: "vaani_sm",
      keyHash: createHash("sha256").update("smoke-api-key").digest("hex"),
      scopes: ["calls:read"],
      ipAllowlist: ["10.0.0.0/8"],
      createdByUserId: user.id,
    },
  });
  assert(apiKey.ipAllowlist.length === 1, "api key ip allowlist");
  ok("apiKey scopes + ipAllowlist");

  const invite = await db.workspaceInvite.create({
    data: {
      workspaceId: ws.id,
      email: "invitee@vaani.dev",
      role: "VIEWER",
      token: "smoke-invite-token",
      invitedByUserId: user.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  assert(invite.status === "PENDING", "invite status");
  ok("workspaceInvite");

  const session = await db.session.create({
    data: {
      token: "smoke-session-token",
      userId: user.id,
      activeWorkspaceId: ws.id,
      deviceName: "Chrome / Linux",
      ipAddress: "203.0.113.10",
      userAgent: "smoke-test",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  const sessionAfter = await db.session.findUnique({ where: { id: session.id } });
  assert(sessionAfter?.revokedAt !== null, "session revoke");
  ok("session device info + forced logout");

  const agent = await db.agent.create({
    data: { workspaceId: ws.id, name: "Smoke Agent", systemPrompt: "sp", greeting: "hi", recordingDisclosureText: "rec" },
  });
  const v1 = await db.agentVersion.create({
    data: { agentId: agent.id, workspaceId: ws.id, version: 1, status: "PUBLISHED", systemPrompt: "sp", greeting: "hi", dograhWorkflowId: "dg-wf-1", publishedAt: new Date() },
  });
  const v2 = await db.agentVersion.create({
    data: { agentId: agent.id, workspaceId: ws.id, version: 2, status: "DRAFT", systemPrompt: "sp2", greeting: "hi2", isAbVariant: true, abTrafficPercent: 20 },
  });
  assert(v1.dograhWorkflowId === "dg-wf-1" && v2.isAbVariant && v2.abTrafficPercent === 20, "agent versions");
  ok("agentVersion draft/published + A/B fields");

  const kd = await db.knowledgeDocument.create({
    data: { workspaceId: ws.id, agentId: agent.id, type: "URL", title: "site", sourceUrl: "https://example.com", status: "INDEXED", reindexIntervalHours: 24, nextReindexAt: new Date(Date.now() + 86400000) },
  });
  assert(kd.status === "INDEXED", "knowledge doc status");
  ok("knowledgeDocument (URL, re-index schedule)");

  const tc = await db.agentToolConfig.upsert({
    where: { agentId_tool: { agentId: agent.id, tool: "CUSTOM_WEBHOOK" } },
    update: { enabled: false },
    create: { agentId: agent.id, tool: "CUSTOM_WEBHOOK", config: { url: "https://example.com/hook", method: "POST" } },
  });
  assert(tc.tool === "CUSTOM_WEBHOOK", "tool config");
  ok("agentToolConfig upsert");

  const tpl = await db.marketplaceTemplate.create({
    data: { authorWorkspaceId: ws.id, name: "Smoke Template", industry: "testing", description: "d", systemPrompt: "sp", greeting: "hi", published: true },
  });
  await db.marketplaceTemplate.update({ where: { id: tpl.id }, data: { installs: { increment: 1 } } });
  ok("marketplaceTemplate + installs counter");

  const pool = await db.numberPool.create({ data: { workspaceId: ws.id, name: "smoke pool" } });
  const phone = await db.phoneNumber.create({
    data: { workspaceId: ws.id, number: "+911600009999", numberType: "SERIES_1600", agentId: agent.id, poolId: pool.id, monthlyRentPaise: 40000, dailyCallCap: 100, lifetimeCallCap: 5000 },
  });
  assert(phone.numberType === "SERIES_1600" && phone.dailyCallCap === 100, "phone number fields");
  ok("numberPool + phoneNumber (type, caps, rent)");

  const rental = await db.numberRental.create({
    data: { workspaceId: ws.id, phoneNumberId: phone.id, monthlyPricePaise: 40000, marginPercent: 25 },
  });
  assert(rental.status === "ACTIVE", "rental status");
  ok("numberRental (price + margin)");

  const list = await db.contactList.create({ data: { workspaceId: ws.id, name: "smoke list" } });
  const contact = await db.contact.create({
    data: { workspaceId: ws.id, listId: list.id, phone: "+919999999999", name: "Smoke Contact", timezone: "Asia/Kolkata", consentAt: new Date(), consentSource: "web-form", crmExternalId: "crm-1" },
  });
  const dnc = await db.dncEntry.create({ data: { workspaceId: ws.id, phone: "+919999999998", source: "REGISTRY", reason: "TRAI DND scrub" } });
  assert(contact.consentSource === "web-form" && dnc.source === "REGISTRY", "contact consent + dnc");
  ok("contact consent fields + dncEntry");

  const campaign = await db.campaign.create({
    data: {
      workspaceId: ws.id,
      name: "smoke campaign",
      type: "PAYMENT_REMINDER",
      agentId: agent.id,
      listId: list.id,
      concurrency: 3,
      retryPolicy: { busy: { attempts: 3, delayMin: 30 } },
      timezoneWindows: { timezone: "Asia/Kolkata", days: [1, 2, 3], windows: [["09:00", "13:00"]] },
      openingHook: "hook",
      objectionPlaybook: "playbook",
      amdPolicy: "LEAVE_MESSAGE",
      predictiveDialing: true,
      poolId: pool.id,
    },
  });
  assert(campaign.type === "PAYMENT_REMINDER" && campaign.amdPolicy === "LEAVE_MESSAGE" && campaign.predictiveDialing, "campaign fields");
  ok("campaign (type, retryPolicy, timezoneWindows, AMD, predictive)");

  const cc = await db.campaignContact.create({ data: { campaignId: campaign.id, contactId: contact.id } });
  const cb = await db.callbackTask.create({
    data: { workspaceId: ws.id, contactId: contact.id, campaignId: campaign.id, phone: contact.phone, note: "call me tomorrow at 5", dueAt: new Date(Date.now() + 86400000), assignedToUserId: user.id },
  });
  assert(cc.status === "PENDING" && cb.status === "PENDING", "campaign contact + callback");
  ok("campaignContact + callbackTask");

  const call = await db.call.create({
    data: {
      workspaceId: ws.id,
      direction: "OUTBOUND",
      status: "COMPLETED",
      fromNumber: phone.number,
      toNumber: contact.phone,
      agentId: agent.id,
      campaignId: campaign.id,
      amdResult: "HUMAN",
      interestScore: "WARM",
      interestReason: "asked for callback",
      extractedEntities: { amount_due: 1200 },
      hallucinationFlag: false,
      deadAirSeconds: 1,
      scriptAdherenceScore: 88,
      piiRedacted: true,
      transcript: "smoke transcript",
      costTelephonyPaise: 10,
      costSttPaise: 5,
      costLlmPaise: 4,
      costTtsPaise: 6,
      billedPaise: 35,
    },
  });
  await db.transcriptEntry.createMany({
    data: [
      { callId: call.id, speaker: "AGENT", text: "hello", timestampMs: 0 },
      { callId: call.id, speaker: "CALLER", text: "hi", timestampMs: 900 },
    ],
  });
  const entries = await db.transcriptEntry.count({ where: { callId: call.id } });
  assert(call.interestScore === "WARM" && entries === 2, "call intelligence + transcript entries");
  ok("call (AMD, interest, entities, hallucination, dead-air, PII) + transcriptEntry");

  const qa = await db.qaScore.create({
    data: { workspaceId: ws.id, callId: call.id, rubricName: "smoke-rubric", scores: { greeting: 9, closing: 8 }, totalScore: 17, maxScore: 20, scorerModel: "meta-llama/llama-3.1-70b-instruct" },
  });
  assert(qa.totalScore === 17, "qa score");
  ok("qaScore");

  const live = await db.liveCallState.create({
    data: { workspaceId: ws.id, callId: call.id, mode: "WHISPER", liveTranscript: "tail...", supervisorUserId: user.id, whisperContext: "offer 10% discount" },
  });
  assert(live.mode === "WHISPER", "live call state");
  ok("liveCallState (whisper mode)");

  const tr = await db.transferRequest.create({
    data: { workspaceId: ws.id, callId: call.id, queue: "support", skill: "hindi", reason: "explicit request", contextSnapshot: { summary: "s" }, acceptedByUserId: user.id, status: "ACCEPTED", acceptedAt: new Date() },
  });
  assert(tr.status === "ACCEPTED", "transfer request");
  ok("transferRequest (queue/skill/context)");

  const vm = await db.voicemailMessage.create({
    data: { workspaceId: ws.id, callId: call.id, phoneNumberId: phone.id, fromNumber: contact.phone, transcript: "vm text" },
  });
  assert(vm.status === "NEW", "voicemail");
  ok("voicemailMessage");

  const waT = await db.whatsAppTemplate.create({
    data: { workspaceId: ws.id, name: "smoke_tpl", body: "Hi {{1}}", dltTemplateId: "DLT-SMOKE", status: "APPROVED" },
  });
  const waC = await db.whatsAppCampaign.create({ data: { workspaceId: ws.id, name: "smoke wa", templateId: waT.id, listId: list.id } });
  assert(waT.status === "APPROVED" && waC.status === "DRAFT", "whatsapp");
  ok("whatsAppTemplate + whatsAppCampaign");

  const cal = await db.calendarConnection.create({
    data: { workspaceId: ws.id, provider: "CALCOM", accessToken: "tok", primaryCalendarId: "cal-1" },
  });
  assert(cal.provider === "CALCOM", "calendar");
  ok("calendarConnection");

  const crm = await db.crmConnection.create({
    data: { workspaceId: ws.id, provider: "ZOHO", accessToken: "tok", fieldMapping: { "contact.name": "Last_Name" }, twoWaySyncEnabled: true },
  });
  assert(crm.twoWaySyncEnabled, "crm");
  ok("crmConnection (two-way sync, field mapping)");

  const sub = await db.webhookSubscription.create({
    data: { workspaceId: ws.id, url: "https://example.com/hook", events: ["call.completed"], secret: "whsec_smoke" },
  });
  const del = await db.webhookDelivery.create({
    data: { subscriptionId: sub.id, event: "call.completed", payload: { callId: call.id }, attempts: 2, responseCode: 500, nextRetryAt: new Date(Date.now() + 60000) },
  });
  assert(del.status === "PENDING" && del.attempts === 2, "webhook delivery retry state");
  ok("webhookSubscription + webhookDelivery (retry state)");

  const rep = await db.savedReport.create({ data: { workspaceId: ws.id, name: "smoke report", reportType: "calls", config: { groupBy: "day" } } });
  const dig = await db.scheduledDigest.create({
    data: { workspaceId: ws.id, reportId: rep.id, frequency: "DAILY", recipients: ["a@b.c"], lastSentAt: new Date() },
  });
  assert(dig.frequency === "DAILY" && dig.recipients.length === 1, "digest");
  ok("savedReport + scheduledDigest");

  const plan = await db.plan.create({
    data: { code: "smoke-plan", name: "Smoke", monthlyPricePaise: 100, includedMinutes: 1, maxAgents: 1, maxSeats: 1, concurrentLines: 5, whiteLabel: true, premiumVoices: true, dedicatedInfra: false, featureGates: { api_access: true } },
  });
  const subscription = await db.subscription.create({
    data: { workspaceId: ws.id, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 86400000) },
  });
  assert(plan.concurrentLines === 5 && subscription.status === "active", "plan gates + subscription");
  ok("plan feature gates + subscription");

  const wallet = await db.wallet.create({ data: { workspaceId: ws.id, balancePaise: 5000 } });
  const txn = await db.walletTransaction.create({
    data: { walletId: wallet.id, type: "CALL_DEBIT", amountPaise: -35, balanceAfterPaise: 4965, reference: call.id },
  });
  assert(txn.balanceAfterPaise === 4965, "wallet txn");
  ok("wallet + walletTransaction");

  const po = await db.paymentOrder.create({
    data: { workspaceId: ws.id, provider: "STRIPE", providerOrderId: "pi_smoke_1", providerSessionId: "cs_smoke_1", amountPaise: 5000, status: "paid" },
  });
  const inv = await db.invoice.create({
    data: { workspaceId: ws.id, amountPaise: 5000, gstPaise: 900, gstin: "29SMOKE1234F1Z5", placeOfSupply: "Karnataka (29)", hsnSac: "998314", cgstPaise: 450, sgstPaise: 450, igstPaise: 0, pdfKey: "invoices/smoke.pdf", status: "paid" },
  });
  const atu = await db.autoTopUp.create({ data: { workspaceId: ws.id, thresholdPaise: 1000, amountPaise: 5000 } });
  assert(po.provider === "STRIPE" && inv.cgstPaise + inv.sgstPaise === inv.gstPaise && atu.active, "payment/invoice/autotopup");
  ok("paymentOrder (Stripe) + invoice GST fields + autoTopUp");

  const reseller = await db.resellerAccount.create({
    data: { parentWorkspaceId: ws.id, wholesaleRateCard: { telephony_per_min_paise: 45 } },
  });
  const child = await db.workspace.create({
    data: { name: "Smoke Child", slug: "smoke-child-ws", resellerId: reseller.id },
  });
  const children = await db.workspace.count({ where: { resellerId: reseller.id } });
  assert(children === 1 && child.resellerId === reseller.id, "reseller children");
  ok("resellerAccount + child workspace");

  const trial = await db.trialState.create({ data: { workspaceId: ws.id, trialMinutesUsed: 5, kycStatus: "PENDING", sandboxNumberId: phone.id } });
  const kyc = await db.kycRecord.create({ data: { workspaceId: ws.id, documentType: "PAN", documentRef: "SMOKE1234A" } });
  assert(trial.kycStatus === "PENDING" && kyc.status === "PENDING", "trial + kyc");
  ok("trialState + kycRecord");

  const rp = await db.retentionPolicy.create({ data: { workspaceId: ws.id, recordingsDays: 30, transcriptsDays: 90 } });
  const gdpr = await db.gdprRequest.create({ data: { workspaceId: ws.id, type: "ERASURE", subjectPhone: contact.phone } });
  const ob = await db.onboardingState.create({ data: { workspaceId: ws.id, currentStep: 2, checklist: { industry: true }, sampleDataEnabled: true } });
  assert(rp.autoDelete && gdpr.type === "ERASURE" && ob.sampleDataEnabled, "compliance + onboarding");
  ok("retentionPolicy + gdprRequest + onboardingState");

  // cascade cleanup: deleting the parent workspace must remove all tenant rows
  await db.workspace.delete({ where: { id: child.id } });
  await db.workspace.delete({ where: { id: ws.id } });
  const leftoverCalls = await db.call.count({ where: { workspaceId: ws.id } });
  const leftoverKeys = await db.apiKey.count({ where: { workspaceId: ws.id } });
  assert(leftoverCalls === 0 && leftoverKeys === 0, "cascade delete");
  await db.user.delete({ where: { id: user.id } });
  await db.plan.delete({ where: { id: plan.id } });
  ok("cascade delete removes all tenant rows");

  console.log(`SMOKE OK: ${checks} checks passed, cleanup done`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
