/**
 * Sample data mode (readme §13): believable demo calls/campaigns/contacts so a new
 * workspace never looks empty. Pure builders here; DB writes live in
 * src/server/actions/onboarding.ts.
 *
 * Identification convention (NO schema change): every sample row is marked by
 *  - phone numbers in the reserved range +917777000001..+917777000099, and
 *  - names/campaign/list titles prefixed with SAMPLE_PREFIX.
 * clearSampleData deletes by BOTH markers, always workspace-scoped.
 */

export const SAMPLE_PREFIX = "Sample — ";
export const SAMPLE_PHONE_PREFIX = "+9177770000";

export type SampleContactRow = {
  workspaceId: string;
  phone: string;
  name: string;
  attributes: { city: string; sample: true };
  timezone: string;
};

export function buildSampleContacts(workspaceId: string): SampleContactRow[] {
  const people: Array<[string, string, string]> = [
    ["+917777000001", "Sample — Anita Desai", "Pune"],
    ["+917777000002", "Sample — Vikram Mehta", "Mumbai"],
    ["+917777000003", "Sample — Lakshmi Nair", "Chennai"],
    ["+917777000004", "Sample — Rohan Gupta", "Delhi"],
    ["+917777000005", "Sample — Farah Khan", "Hyderabad"],
  ];
  return people.map(([phone, name, city]) => ({
    workspaceId,
    phone,
    name,
    attributes: { city, sample: true },
    timezone: "Asia/Kolkata",
  }));
}

export type SampleCallRow = {
  workspaceId: string;
  agentId: string | null;
  campaignId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  status: "COMPLETED";
  fromNumber: string;
  toNumber: string;
  durationSec: number;
  summary: string;
  sentiment: string;
  outcome: string;
  transcript: string;
  costTelephonyPaise: number;
  costSttPaise: number;
  costLlmPaise: number;
  costTtsPaise: number;
  billedPaise: number;
};

export function buildSampleCalls(args: {
  workspaceId: string;
  agentId: string | null;
  campaignId: string | null;
  businessNumber: string;
}): SampleCallRow[] {
  const { workspaceId, agentId, campaignId, businessNumber } = args;
  const base = {
    workspaceId,
    agentId,
    status: "COMPLETED" as const,
    toNumber: businessNumber,
    costTelephonyPaise: 45,
    costSttPaise: 30,
    costLlmPaise: 20,
    costTtsPaise: 37,
  };
  return [
    {
      ...base,
      campaignId: null,
      direction: "INBOUND",
      fromNumber: "+917777000001",
      durationSec: 142,
      summary: "Sample — caller asked for pricing and booked a Saturday slot.",
      sentiment: "positive",
      outcome: "booked",
      transcript: "AI: Namaste! How may I help you?\nCaller: What is the price for a consultation?\nAI: It is ₹500. Shall I book a slot for you?",
      billedPaise: 185,
    },
    {
      ...base,
      campaignId: null,
      direction: "INBOUND",
      fromNumber: "+917777000002",
      durationSec: 68,
      summary: "Sample — caller asked for opening hours; no booking.",
      sentiment: "neutral",
      outcome: "faq-answered",
      transcript: "AI: Namaste! How may I help you?\nCaller: What time do you open?\nAI: We are open 10am to 8pm, Monday to Saturday.",
      billedPaise: 88,
    },
    {
      ...base,
      campaignId,
      direction: "OUTBOUND",
      fromNumber: businessNumber,
      toNumber: "+917777000003",
      durationSec: 95,
      summary: "Sample — appointment reminder delivered; caller confirmed.",
      sentiment: "positive",
      outcome: "confirmed",
      transcript: "AI: Namaste, this is a reminder about your appointment tomorrow at 11am.\nCaller: Yes, I will be there.",
      billedPaise: 126,
    },
    {
      ...base,
      campaignId,
      direction: "OUTBOUND",
      fromNumber: businessNumber,
      toNumber: "+917777000004",
      durationSec: 0,
      summary: "Sample — no answer after 45s; retry scheduled by policy.",
      sentiment: "neutral",
      outcome: "no-answer",
      transcript: "",
      billedPaise: 0,
    },
    {
      ...base,
      campaignId,
      direction: "OUTBOUND",
      fromNumber: businessNumber,
      toNumber: "+917777000005",
      durationSec: 130,
      summary: "Sample — feedback survey completed; NPS 9.",
      sentiment: "positive",
      outcome: "survey-completed",
      transcript: "AI: On a scale of 0 to 10, how likely are you to recommend us?\nCaller: Nine.\nAI: Thank you! Have a great day.",
      billedPaise: 169,
    },
  ];
}

/** Prisma `where` fragments used by clearSampleData — always add workspaceId. */
export function sampleCallWhere(workspaceId: string) {
  return {
    workspaceId,
    OR: [
      { fromNumber: { startsWith: SAMPLE_PHONE_PREFIX } },
      { toNumber: { startsWith: SAMPLE_PHONE_PREFIX } },
      { summary: { startsWith: SAMPLE_PREFIX } },
    ],
  };
}

export function sampleContactWhere(workspaceId: string) {
  return { workspaceId, phone: { startsWith: SAMPLE_PHONE_PREFIX } };
}
