import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";

const db = new PrismaClient();

async function main() {
  // --- Plans (with feature gates) ---
  const starter = await db.plan.upsert({
    where: { code: "starter" },
    update: { concurrentLines: 2, whiteLabel: false, premiumVoices: false, dedicatedInfra: false },
    create: {
      code: "starter",
      name: "Starter",
      monthlyPricePaise: 299900, // ₹2,999/mo
      includedMinutes: 500,
      maxAgents: 2,
      maxSeats: 2,
      concurrentLines: 2,
      whiteLabel: false,
      premiumVoices: false,
      dedicatedInfra: false,
      featureGates: { qa_scoring: false, api_access: false },
      markupPercent: 40,
    },
  });
  await db.plan.upsert({
    where: { code: "growth" },
    update: { concurrentLines: 10, whiteLabel: false, premiumVoices: true, dedicatedInfra: false },
    create: {
      code: "growth",
      name: "Growth",
      monthlyPricePaise: 799900, // ₹7,999/mo
      includedMinutes: 2500,
      maxAgents: 10,
      maxSeats: 10,
      concurrentLines: 10,
      whiteLabel: false,
      premiumVoices: true,
      dedicatedInfra: false,
      featureGates: { qa_scoring: true, api_access: true },
      markupPercent: 45,
    },
  });
  await db.plan.upsert({
    where: { code: "enterprise" },
    update: { concurrentLines: 100, whiteLabel: true, premiumVoices: true, dedicatedInfra: true },
    create: {
      code: "enterprise",
      name: "Enterprise",
      monthlyPricePaise: 2499900, // ₹24,999/mo
      includedMinutes: 12000,
      maxAgents: 100,
      maxSeats: 50,
      concurrentLines: 100,
      whiteLabel: true,
      premiumVoices: true,
      dedicatedInfra: true,
      featureGates: { qa_scoring: true, api_access: true, saml_sso: true, reseller_panel: true },
      markupPercent: 50,
    },
  });

  // --- Demo workspace + user (login: demo@vaani.ai / demo1234) ---
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const user = await db.user.upsert({
    where: { email: "demo@vaani.ai" },
    update: {},
    create: { email: "demo@vaani.ai", passwordHash, fullName: "Demo Owner" },
  });

  const workspace = await db.workspace.upsert({
    where: { slug: "demo-clinic" },
    update: {},
    create: {
      name: "Demo Dental Clinic",
      slug: "demo-clinic",
      industry: "healthcare",
      primaryColor: "#7c3aed",
      recordingDisclosureText:
        "This call may be recorded for quality and training purposes.",
    },
  });

  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });

  await db.wallet.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: { workspaceId: workspace.id, balancePaise: 100000 }, // ₹1,000 trial credit
  });

  await db.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      planId: starter.id,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // --- Auth & tenancy extras: API key, invite, TOTP (pending), SSO identity ---
  await db.apiKey.upsert({
    where: { keyHash: createHash("sha256").update("demo-api-key-do-not-use").digest("hex") },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "Demo read-only key",
      keyPrefix: "vaani_de",
      keyHash: createHash("sha256").update("demo-api-key-do-not-use").digest("hex"),
      scopes: ["calls:read", "contacts:read"],
      ipAllowlist: [],
      createdByUserId: user.id,
    },
  });

  await db.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      email: "receptionist@democlinic.example",
      role: "AGENT",
      token: "demo-invite-token-001",
      status: "PENDING",
      invitedByUserId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await db.totpSecret.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, secret: "JBSWY3DPEHPK3PXP", status: "PENDING" },
  });

  await db.ssoIdentity.create({
    data: {
      userId: user.id,
      provider: "GOOGLE",
      externalSubjectId: "google-sub-demo-0001",
      email: "demo@vaani.ai",
    },
  });

  // --- Demo agent (template: clinic receptionist) ---
  const agent = await db.agent.create({
    data: {
      workspaceId: workspace.id,
      name: "Front Desk — Priya",
      template: "clinic-receptionist",
      greeting:
        "Namaste! Thank you for calling Demo Dental Clinic. Main aapki kya madad kar sakti hoon?",
      systemPrompt: `You are Priya, the AI receptionist of Demo Dental Clinic, Bengaluru.
You speak Hindi, English, and Hinglish, matching the caller's language.
Your jobs: (1) answer FAQs — timings 10am-8pm Mon-Sat, address MG Road, (2) book,
reschedule or cancel appointments, (3) take a message for the doctor.
Rules: be warm and concise, never give medical advice, confirm name + phone number
before booking, and if the caller is upset or asks for a human, say you will have the
clinic manager call back. End every call by summarizing what was agreed.`,
      languageMode: "auto",
      voiceId: "anushka",
      status: "DRAFT",
    },
  });

  // --- Agent builder: version, knowledge doc, tool configs, marketplace template ---
  await db.agentVersion.create({
    data: {
      agentId: agent.id,
      workspaceId: workspace.id,
      version: 1,
      status: "DRAFT",
      label: "v1 — initial from clinic-receptionist template",
      systemPrompt: agent.systemPrompt,
      greeting: agent.greeting,
      config: { voiceId: "anushka", llmModel: "meta-llama/llama-3.1-70b-instruct", languageMode: "auto" },
      createdByUserId: user.id,
    },
  });

  await db.knowledgeDocument.create({
    data: {
      workspaceId: workspace.id,
      agentId: agent.id,
      type: "FAQ",
      title: "Clinic FAQ — timings, pricing, location",
      contentText:
        "Q: What are your timings? A: 10am-8pm, Monday to Saturday.\nQ: How much is teeth cleaning? A: ₹1,500.\nQ: Where are you located? A: MG Road, Bengaluru.",
      status: "INDEXED",
      lastIndexedAt: new Date(),
      reindexIntervalHours: 24,
      nextReindexAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await db.agentToolConfig.createMany({
    data: [
      {
        agentId: agent.id,
        tool: "CALENDAR_BOOKING",
        enabled: true,
        config: { provider: "google", calendarId: "primary", slotMinutes: 30 },
      },
      {
        agentId: agent.id,
        tool: "HUMAN_TRANSFER",
        enabled: true,
        config: { queue: "clinic-front-desk", skill: "hindi", whisperSummary: true },
      },
      {
        agentId: agent.id,
        tool: "VOICEMAIL",
        enabled: true,
        config: { transcribe: true, notifyEmail: "frontdesk@democlinic.example" },
      },
    ],
  });

  await db.marketplaceTemplate.create({
    data: {
      authorWorkspaceId: workspace.id,
      name: "Dental Clinic Receptionist",
      industry: "healthcare",
      description: "Answers FAQs, books appointments, takes messages for dental clinics.",
      systemPrompt: agent.systemPrompt,
      greeting: agent.greeting,
      config: { voiceId: "anushka", tools: ["CALENDAR_BOOKING", "VOICEMAIL"] },
      installs: 0,
      published: true,
    },
  });

  // --- Telephony: number pool + two DIDs with caps + a rental ---
  const pool = await db.numberPool.create({
    data: { workspaceId: workspace.id, name: "Outbound pool — Bengaluru" },
  });

  const phone1 = await db.phoneNumber.create({
    data: {
      workspaceId: workspace.id,
      number: "+918040001234",
      label: "Front desk (inbound)",
      numberType: "LOCAL",
      agentId: agent.id,
      monthlyRentPaise: 25000, // ₹250/mo
    },
  });

  const phone2 = await db.phoneNumber.create({
    data: {
      workspaceId: workspace.id,
      number: "+911400001234",
      label: "Promotional 140 series",
      numberType: "SERIES_140",
      poolId: pool.id,
      monthlyRentPaise: 35000, // ₹350/mo
      dailyCallCap: 200,
      lifetimeCallCap: 10000,
    },
  });

  await db.numberRental.create({
    data: {
      workspaceId: workspace.id,
      phoneNumberId: phone1.id,
      monthlyPricePaise: 25000,
      marginPercent: 25,
      status: "ACTIVE",
    },
  });

  // --- Contacts & DNC ---
  const list = await db.contactList.create({
    data: { workspaceId: workspace.id, name: "Appointment reminders — July" },
  });
  await db.contact.createMany({
    data: [
      { workspaceId: workspace.id, listId: list.id, phone: "+919900000001", name: "Ravi Kumar", attributes: { city: "Bengaluru" }, timezone: "Asia/Kolkata", consentAt: new Date(), consentSource: "web-form" },
      { workspaceId: workspace.id, listId: list.id, phone: "+919900000002", name: "Sunita Sharma", attributes: { city: "Mysuru" }, timezone: "Asia/Kolkata", consentAt: new Date(), consentSource: "csv-upload", crmExternalId: "hs-88321" },
      { workspaceId: workspace.id, listId: list.id, phone: "+919900000003", name: "Amit Patel", attributes: { city: "Hubballi" }, dnc: true, optOutAt: new Date() },
    ],
  });

  await db.dncEntry.upsert({
    where: { workspaceId_phone: { workspaceId: workspace.id, phone: "+919900000003" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      phone: "+919900000003",
      source: "OPT_OUT",
      reason: "Caller said 'stop calling me' on 2024-07-02",
    },
  });

  // --- Demo campaign with full outbound config ---
  const campaign = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      name: "July checkup reminders",
      type: "APPOINTMENT_REMINDER",
      agentId: agent.id,
      listId: list.id,
      status: "DRAFT",
      callsPerMinute: 5,
      concurrency: 2,
      retryPolicy: { busy: { attempts: 3, delayMin: 30 }, "no-answer": { attempts: 2, delayMin: 120 } },
      timezoneWindows: { timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5, 6], windows: [["10:00", "19:00"]] },
      openingHook: "Namaste, this is Priya calling from Demo Dental Clinic about your upcoming checkup.",
      objectionPlaybook: "If the caller says they are busy, offer two alternative slots. If they say cost is an issue, mention the ₹999 first-visit offer.",
      amdPolicy: "LEAVE_MESSAGE",
      poolId: pool.id,
    },
  });

  const ravi = await db.contact.findUnique({
    where: { workspaceId_phone: { workspaceId: workspace.id, phone: "+919900000001" } },
  });
  if (ravi) {
    await db.campaignContact.create({
      data: { campaignId: campaign.id, contactId: ravi.id, status: "PENDING" },
    });
  }

  // --- Calls: one completed inbound (with intelligence fields) + one live call ---
  const call = await db.call.create({
    data: {
      workspaceId: workspace.id,
      direction: "INBOUND",
      status: "COMPLETED",
      fromNumber: "+919812345678",
      toNumber: phone1.number,
      agentId: agent.id,
      durationSec: 184,
      summary:
        "Caller Ramesh asked about teeth-cleaning pricing (₹1,500) and booked a slot for Saturday 11am. Confirmed phone number. Sent no SMS (demo).",
      sentiment: "positive",
      outcome: "booked",
      extractedEntities: { name: "Ramesh", service: "teeth cleaning", slot: "Saturday 11am", price_inr: 1500 },
      interestScore: "HOT",
      interestReason: "Caller asked for price and completed a booking in the same call.",
      deadAirSeconds: 2,
      scriptAdherenceScore: 94,
      transcript:
        "AI: Namaste! Thank you for calling Demo Dental Clinic...\nCaller: Kitna charge hai cleaning ka?\nAI: Cleaning ka charge ₹1,500 hai...",
      costTelephonyPaise: 92,
      costSttPaise: 55,
      costLlmPaise: 38,
      costTtsPaise: 74,
      billedPaise: 362,
    },
  });

  await db.transcriptEntry.createMany({
    data: [
      { callId: call.id, speaker: "AGENT", text: "Namaste! Thank you for calling Demo Dental Clinic. Main aapki kya madad kar sakti hoon?", timestampMs: 0 },
      { callId: call.id, speaker: "CALLER", text: "Kitna charge hai cleaning ka?", timestampMs: 4200 },
      { callId: call.id, speaker: "AGENT", text: "Cleaning ka charge ₹1,500 hai. Kya main aapke liye slot book kar doon?", timestampMs: 7100 },
    ],
  });

  await db.qaScore.create({
    data: {
      workspaceId: workspace.id,
      callId: call.id,
      rubricName: "receptionist-default",
      scores: { greeting: 10, compliance_lines: 10, faq_accuracy: 9, closing: 8 },
      totalScore: 37,
      maxScore: 40,
      scorerModel: "meta-llama/llama-3.1-70b-instruct",
      notes: "Greeting and disclosure perfect; closing summary slightly rushed.",
    },
  });

  const liveCall = await db.call.create({
    data: {
      workspaceId: workspace.id,
      direction: "INBOUND",
      status: "IN_PROGRESS",
      fromNumber: "+919876500001",
      toNumber: phone1.number,
      agentId: agent.id,
      answeredAt: new Date(),
    },
  });

  await db.liveCallState.create({
    data: {
      workspaceId: workspace.id,
      callId: liveCall.id,
      status: "IN_PROGRESS",
      mode: "NONE",
      liveTranscript: "AI: Namaste! ... Caller: Mujhe appointment chahiye tha",
    },
  });

  await db.transferRequest.create({
    data: {
      workspaceId: workspace.id,
      callId: liveCall.id,
      queue: "clinic-front-desk",
      skill: "hindi",
      status: "QUEUED",
      reason: "Caller explicitly asked for a human",
      contextSnapshot: { summary: "Caller wants to reschedule a root-canal appointment.", sentiment: "neutral" },
    },
  });

  await db.voicemailMessage.create({
    data: {
      workspaceId: workspace.id,
      callId: call.id,
      phoneNumberId: phone1.id,
      fromNumber: "+919812345678",
      transcript: "Hello, this is Ramesh. Please confirm my Saturday appointment. Thank you.",
      status: "NEW",
    },
  });

  await db.callbackTask.create({
    data: {
      workspaceId: workspace.id,
      contactId: ravi?.id,
      campaignId: campaign.id,
      phone: "+919900000001",
      note: "Caller said: call me tomorrow at 5 about the cleaning offer",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: "PENDING",
      assignedToUserId: user.id,
    },
  });

  // --- WhatsApp ---
  const waTemplate = await db.whatsAppTemplate.create({
    data: {
      workspaceId: workspace.id,
      name: "appointment_confirmation",
      language: "en",
      body: "Hi {{1}}, your appointment at Demo Dental Clinic is confirmed for {{2}}. Reply C to cancel.",
      dltTemplateId: "DLT-TPL-DEMO-001",
      status: "APPROVED",
    },
  });

  await db.whatsAppCampaign.create({
    data: {
      workspaceId: workspace.id,
      name: "July appointment confirmations",
      templateId: waTemplate.id,
      listId: list.id,
      status: "DRAFT",
    },
  });

  // --- Integrations: calendar, CRM, webhook + a delivery ---
  await db.calendarConnection.upsert({
    where: { workspaceId_provider: { workspaceId: workspace.id, provider: "GOOGLE" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      provider: "GOOGLE",
      accountEmail: "democlinic@example.com",
      accessToken: "demo-access-token",
      refreshToken: "demo-refresh-token",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      primaryCalendarId: "primary",
      active: true,
    },
  });

  await db.crmConnection.upsert({
    where: { workspaceId_provider: { workspaceId: workspace.id, provider: "HUBSPOT" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      provider: "HUBSPOT",
      accessToken: "demo-hubspot-token",
      fieldMapping: { "contact.name": "firstname", "contact.phone": "phone", "call.outcome": "hs_lead_status" },
      twoWaySyncEnabled: true,
      active: true,
    },
  });

  const webhook = await db.webhookSubscription.create({
    data: {
      workspaceId: workspace.id,
      url: "https://democlinic.example/hooks/vaani",
      events: ["call.started", "call.completed", "lead.qualified"],
      secret: "whsec_demo_0123456789abcdef",
      active: true,
    },
  });

  await db.webhookDelivery.create({
    data: {
      subscriptionId: webhook.id,
      event: "call.completed",
      payload: { callId: call.id, outcome: "booked", durationSec: 184 },
      status: "SUCCESS",
      attempts: 1,
      responseCode: 200,
      deliveredAt: new Date(),
    },
  });

  // --- Analytics: saved report + scheduled digest ---
  const report = await db.savedReport.create({
    data: {
      workspaceId: workspace.id,
      name: "Weekly inbound summary",
      reportType: "calls",
      config: { direction: "INBOUND", groupBy: "day", metrics: ["count", "avg_duration", "cost"] },
    },
  });

  await db.scheduledDigest.create({
    data: {
      workspaceId: workspace.id,
      reportId: report.id,
      frequency: "WEEKLY",
      recipients: ["owner@democlinic.example"],
      active: true,
    },
  });

  // --- Billing: payment order, auto top-up, GST invoice ---
  await db.paymentOrder.create({
    data: {
      workspaceId: workspace.id,
      provider: "RAZORPAY",
      providerOrderId: "order_DemoSeed0001",
      amountPaise: 100000,
      currency: "INR",
      status: "paid",
    },
  });

  await db.autoTopUp.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      thresholdPaise: 20000, // ₹200
      amountPaise: 100000,   // ₹1,000
      active: false,
      paymentMethodRef: null,
    },
  });

  await db.invoice.create({
    data: {
      workspaceId: workspace.id,
      razorpayPaymentId: "pay_DemoSeed0001",
      razorpayOrderId: "order_DemoSeed0001",
      amountPaise: 100000,
      gstPaise: 18000,
      gstin: "29ABCDE1234F1Z5",
      placeOfSupply: "Karnataka (29)",
      hsnSac: "998314",
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
      status: "paid",
    },
  });

  // --- Reseller: demo workspace parents a child client workspace ---
  await db.resellerAccount.upsert({
    where: { parentWorkspaceId: workspace.id },
    update: {},
    create: {
      parentWorkspaceId: workspace.id,
      wholesaleRateCard: { telephony_per_min_paise: 45, stt_per_min_paise: 30, llm_per_1k_tokens_paise: 2, tts_per_min_paise: 40 },
      active: true,
    },
  });
  const resellerAccount = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId: workspace.id },
  });
  const childWorkspace = await db.workspace.upsert({
    where: { slug: "demo-agency-client" },
    update: {},
    create: {
      name: "Demo Agency Client — Smile Dental",
      slug: "demo-agency-client",
      industry: "healthcare",
      resellerId: resellerAccount?.id,
    },
  });
  await db.wallet.upsert({
    where: { workspaceId: childWorkspace.id },
    update: {},
    create: { workspaceId: childWorkspace.id, balancePaise: 0 },
  });

  // --- Trial, KYC, compliance, onboarding ---
  await db.trialState.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      trialMinutesUsed: 3,
      trialMinutesLimit: 30,
      kycStatus: "VERIFIED",
      sandboxNumberId: phone1.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  await db.kycRecord.create({
    data: {
      workspaceId: workspace.id,
      documentType: "GST",
      documentRef: "29ABCDE1234F1Z5",
      status: "VERIFIED",
      reviewedAt: new Date(),
    },
  });

  await db.retentionPolicy.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      recordingsDays: 90,
      transcriptsDays: 365,
      autoDelete: true,
    },
  });

  await db.gdprRequest.create({
    data: {
      workspaceId: workspace.id,
      type: "EXPORT",
      subjectPhone: "+919812345678",
      status: "PENDING",
    },
  });

  await db.onboardingState.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      currentStep: 3,
      checklist: { industry: true, template: true, knowledge: true, test_call: false, number: false },
      sampleDataEnabled: true,
    },
  });

  // --- Audit log sample ---
  await db.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "workspace.seeded",
      entity: "Workspace",
      entityId: workspace.id,
      metadata: { seed: true },
    },
  });

  console.log("Seed complete:");
  console.log("  login:     demo@vaani.ai / demo1234");
  console.log("  workspace: Demo Dental Clinic (demo-clinic)");
  console.log("  plans:     starter, growth, enterprise (with feature gates)");
  console.log("  demo rows: agent+version, knowledge doc, tool configs, pool+2 numbers,");
  console.log("             contacts+DNC, campaign, 2 calls (1 completed+QA, 1 live+transfer),");
  console.log("             voicemail, callback, WhatsApp, calendar/CRM, webhook+delivery,");
  console.log("             report+digest, payment order, invoice, reseller+child, trial/KYC,");
  console.log("             retention, GDPR, onboarding");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
