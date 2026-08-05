/**
 * Campaign type presets (readme §6.1 "campaign types").
 * templateCode references AGENT_TEMPLATES in src/lib/templates.ts (guide 05).
 * openingHook / objectionPlaybook are injected into the Dograh call's
 * initial_context at dial time (Step 9) so the workflow prompt can use them.
 */

export type CampaignPreset = {
  type: string; // CampaignType enum value
  label: string;
  description: string;
  templateCode: string; // guide 05 AGENT_TEMPLATES code (agent starting point)
  retryPolicy: Record<string, { attempts: number; delayMin: number }>;
  windowStart: string;
  windowEnd: string;
  days: number[]; // 0=Sun
  openingHook: string;
  objectionPlaybook: string;
};

const IDENTITY =
  "Namaste, this is an automated call from {{business_name}}. " +
  "You are speaking with Vaani, our AI assistant, and this call may be recorded.";

export const CAMPAIGN_PRESETS: Record<string, CampaignPreset> = {
  LEAD_QUALIFICATION: {
    type: "LEAD_QUALIFICATION",
    label: "Lead qualification",
    description: "Call fresh leads, qualify interest, book the next step.",
    templateCode: "real-estate-qualifier",
    retryPolicy: { "no-answer": { attempts: 3, delayMin: 240 }, busy: { attempts: 3, delayMin: 60 }, voicemail: { attempts: 1, delayMin: 1440 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6],
    openingHook: `${IDENTITY} I'm calling about the enquiry you made — this takes under two minutes and could save you real money. Is now an okay time?`,
    objectionPlaybook:
      "If 'not interested': acknowledge, give ONE concrete benefit tied to their enquiry, ask a softer question. " +
      "If 'busy': offer to schedule a callback at their preferred time. " +
      "Never argue; two objections maximum, then close politely.",
  },
  APPOINTMENT_REMINDER: {
    type: "APPOINTMENT_REMINDER",
    label: "Appointment reminder",
    description: "Remind customers of upcoming appointments; offer reschedule.",
    templateCode: "clinic-receptionist",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 180 }, busy: { attempts: 2, delayMin: 45 } },
    windowStart: "09:00",
    windowEnd: "20:00",
    days: [1, 2, 3, 4, 5, 6, 0],
    openingHook: `${IDENTITY} This is a friendly reminder about your appointment on {{appointment_time}}. Are you able to make it?`,
    objectionPlaybook:
      "If they can't make it: offer the two nearest alternative slots. " +
      "If unsure: confirm you'll send a WhatsApp reminder with details. Keep it under 60 seconds.",
  },
  PAYMENT_REMINDER: {
    type: "PAYMENT_REMINDER",
    label: "Payment / EMI reminder",
    description: "Remind about due payments; share the payment link.",
    templateCode: "emi-reminder",
    retryPolicy: { "no-answer": { attempts: 3, delayMin: 360 }, busy: { attempts: 3, delayMin: 90 }, failed: { attempts: 2, delayMin: 240 } },
    windowStart: "09:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5],
    openingHook: `${IDENTITY} This is a courtesy reminder that your payment of {{amount_due}} is due on {{due_date}}. Would you like the payment link on WhatsApp?`,
    objectionPlaybook:
      "If 'already paid': apologize, confirm we'll verify and update records. " +
      "If financial difficulty: express understanding, note it, and offer a callback from the accounts team. " +
      "Never threaten; stay courteous per fair-practice norms.",
  },
  FEEDBACK_SURVEY: {
    type: "FEEDBACK_SURVEY",
    label: "Feedback / NPS survey",
    description: "Post-service feedback and NPS score collection.",
    templateCode: "nps-survey",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 480 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6],
    openingHook: `${IDENTITY} You recently used our service — could I take 60 seconds for two quick feedback questions? It genuinely improves our service.`,
    objectionPlaybook:
      "If rushed: ask for just the 0–10 score and skip the rest. " +
      "If unhappy: thank them sincerely, capture the reason verbatim, and flag for a human follow-up.",
  },
  ORDER_CONFIRMATION: {
    type: "ORDER_CONFIRMATION",
    label: "Order / delivery confirmation",
    description: "Confirm orders, COD verification, delivery preferences.",
    templateCode: "delivery-confirmation",
    retryPolicy: { "no-answer": { attempts: 3, delayMin: 240 }, busy: { attempts: 3, delayMin: 60 }, failed: { attempts: 2, delayMin: 120 } },
    windowStart: "09:00",
    windowEnd: "20:00",
    days: [1, 2, 3, 4, 5, 6, 0],
    openingHook: `${IDENTITY} I'm calling to confirm your order {{order_id}} before we ship it. Can you confirm your delivery address?`,
    objectionPlaybook:
      "If they didn't order: apologize, cancel the order flag, and note possible fraud. " +
      "If address confusion: read it back slowly, confirm pincode.",
  },
  REACTIVATION: {
    type: "REACTIVATION",
    label: "Reactivation / win-back",
    description: "Win back lapsed customers with an offer.",
    templateCode: "real-estate-qualifier",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 720 }, busy: { attempts: 2, delayMin: 240 } },
    windowStart: "11:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6],
    openingHook: `${IDENTITY} It's been a while since we served you, and we'd love to have you back — I have a special returning-customer offer. Got a minute?`,
    objectionPlaybook:
      "If 'why did I leave': acknowledge past issues honestly, state what's improved. " +
      "One offer only; if declined, ask if they'd like to stay on the list for future offers — a 'no' here is an opt-out, honor it.",
  },
  EVENT_INVITE: {
    type: "EVENT_INVITE",
    label: "Event invite",
    description: "Invite customers/prospects to events, webinars, launches.",
    templateCode: "restaurant-reservations",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 480 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5],
    openingHook: `${IDENTITY} You're invited to {{event_name}} on {{event_date}} — I can reserve your spot in 30 seconds. Interested?`,
    objectionPlaybook:
      "If tentative: offer to WhatsApp the invite link so they can decide later. " +
      "If declined: one gentle benefit line, then close warmly.",
  },
  POLITICAL_SURVEY: {
    type: "POLITICAL_SURVEY",
    label: "Political / survey campaign",
    description: "Opinion polls and survey outreach.",
    templateCode: "nps-survey",
    retryPolicy: { "no-answer": { attempts: 2, delayMin: 720 } },
    windowStart: "10:00",
    windowEnd: "19:00",
    days: [1, 2, 3, 4, 5, 6, 0],
    openingHook: `${IDENTITY} We're running a short public opinion survey in your area — three questions, two minutes, fully anonymous. Willing to participate?`,
    objectionPlaybook:
      "Neutrality is mandatory: never argue politics, never advocate. " +
      "If they decline: thank them and end immediately — surveys are always voluntary.",
  },
};

export const CAMPAIGN_TYPES = Object.keys(CAMPAIGN_PRESETS);

export function getPreset(type: string): CampaignPreset | null {
  return CAMPAIGN_PRESETS[type] ?? null;
}
