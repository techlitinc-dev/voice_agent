import { db } from "./db";

/**
 * Fan out a tenant event to webhook subscribers (spec §9 event subscriptions).
 * Returns the number of deliveries enqueued. Never throws — webhook fan-out must
 * not break call processing.
 *
 * Events emitted in this guide: "call.completed", "call.missed", "voicemail.received",
 * "transfer.requested". (Guide 08 delivers them; guide 07 emits campaign events.)
 */
export async function emitWebhookEvent(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<number> {
  try {
    const subs = await db.webhookSubscription.findMany({
      where: { workspaceId, active: true, events: { has: event } },
      select: { id: true },
    });
    if (subs.length === 0) return 0;
    await db.webhookDelivery.createMany({
      data: subs.map((s) => ({
        subscriptionId: s.id,
        event,
        payload: { ...payload, event, workspaceId, emittedAt: new Date().toISOString() },
        nextRetryAt: new Date(),
      })),
    });
    return subs.length;
  } catch (e) {
    console.error("emitWebhookEvent failed", event, e);
    return 0;
  }
}
