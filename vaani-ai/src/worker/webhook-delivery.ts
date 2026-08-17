/**
 * Webhook delivery worker (spec §9). Deliberately INTERVAL-BASED (not a BullMQ
 * queue) — guide 07 owns the BullMQ queues `campaign-scheduler`, `campaign-dialer`,
 * `whatsapp-send`; this sweep runs in the same worker process but shares no queue.
 * Drains PENDING WebhookDelivery rows whose
 * nextRetryAt has passed: POSTs the payload with an X-Vaani-Signature HMAC header,
 * records responseCode, and retries with exponential backoff (max 8 attempts).
 * Idempotent: a delivered row is marked SUCCESS and never resent; receivers can
 * dedupe on the delivery id inside the payload.
 */
import { PrismaClient } from "@prisma/client";
import { nextBackoffMs, signWebhookPayload, WEBHOOK_MAX_ATTEMPTS } from "../lib/webhook-sign";
import { appendAttemptLog } from "../lib/webhook-delivery-log";
import { webhooksDelivered } from "../lib/metrics";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export async function deliverWebhooks(take = 10): Promise<number> {
  const due = await db.webhookDelivery.findMany({
    where: { status: "PENDING", OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] },
    include: { subscription: true },
    orderBy: { createdAt: "asc" },
    take,
  });

  let done = 0;
  for (const delivery of due) {
    const sub = delivery.subscription;
    if (!sub.active) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "FAILED",
          attemptLog: appendAttemptLog(delivery.attemptLog, {
            attempt: delivery.attempts + 1,
            at: new Date().toISOString(),
            responseCode: null,
            error: "subscription inactive",
          }),
        },
      });
      continue;
    }
    const rawBody = JSON.stringify({ id: delivery.id, ...delivery.payload as Record<string, unknown> });
    const attempts = delivery.attempts + 1;
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Vaani-Event": delivery.event,
          "X-Vaani-Signature": signWebhookPayload(sub.secret, rawBody),
          "X-Vaani-Delivery": delivery.id,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "SUCCESS",
            attempts,
            responseCode: res.status,
            deliveredAt: new Date(),
            attemptLog: appendAttemptLog(delivery.attemptLog, {
              attempt: attempts,
              at: new Date().toISOString(),
              responseCode: res.status,
              error: null,
            }),
          },
        });
        webhooksDelivered.labels("success", sub.workspaceId).inc();
        log(`[webhooks] delivered ${delivery.id} event=${delivery.event} -> ${res.status}`);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      const statusCode = /^HTTP (\d+)$/.exec((e as Error).message ?? "")?.[1];
      const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
      webhooksDelivered.labels(exhausted ? "failed" : "retry", sub.workspaceId).inc();
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          responseCode: statusCode ? Number(statusCode) : null,
          nextRetryAt: exhausted ? null : new Date(Date.now() + nextBackoffMs(attempts)),
          attemptLog: appendAttemptLog(delivery.attemptLog, {
            attempt: attempts,
            at: new Date().toISOString(),
            responseCode: statusCode ? Number(statusCode) : null,
            error: (e as Error).message ?? "network error",
          }),
        },
      });
      log(`[webhooks] attempt ${attempts}/${WEBHOOK_MAX_ATTEMPTS} failed for ${delivery.id}${exhausted ? " — giving up" : ""}`);
    }
    done += 1;
  }
  return done;
}
