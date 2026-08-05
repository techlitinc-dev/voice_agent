/** Canonical tenant event names for webhook subscriptions (spec §9). */
export const WEBHOOK_EVENTS = [
  "call.started",
  "call.completed",
  "call.missed",
  "lead.qualified",
  "campaign.finished",
  "contact.opted-out",
  "voicemail.received",
  "transfer.requested",
  "wallet.low_balance",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];
