"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";

/** Map requirePermission's FORBIDDEN throw onto the action error shape. */
function actionError(label: string, e: unknown, fallback: string) {
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false as const, error: "Forbidden — your role lacks the webhooks:write permission" };
  }
  console.error(label, e);
  return { ok: false as const, error: fallback };
}

const createSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith("https://") || u.startsWith("http://localhost") || u.startsWith("http://127.0.0.1"),
      { message: "HTTPS URL required (http://localhost allowed in dev only)" },
    ),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
});

export async function createWebhookSubscription(formData: FormData) {
  try {
    const ctx = await requirePermission("webhooks:write");
    const events = formData.getAll("events").map(String);
    const parsed = createSchema.safeParse({ url: String(formData.get("url") ?? ""), events });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

    const secret = `whsec_${crypto.randomBytes(16).toString("hex")}`;
    const sub = await db.webhookSubscription.create({
      data: { workspaceId: ctx.workspaceId, url: parsed.data.url, events: parsed.data.events, secret },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "webhook.created", entity: "WebhookSubscription", entityId: sub.id, metadata: { url: sub.url } },
    });
    revalidatePath("/settings/webhooks");
    return { ok: true as const, secret };
  } catch (e) {
    return actionError("createWebhookSubscription", e, "Could not create subscription");
  }
}

export async function deleteWebhookSubscription(id: string) {
  try {
    const ctx = await requirePermission("webhooks:write");
    const sub = await db.webhookSubscription.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!sub) return { ok: false as const, error: "Not found" };
    await db.webhookSubscription.delete({ where: { id: sub.id } });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "webhook.deleted", entity: "WebhookSubscription", entityId: id },
    });
    revalidatePath("/settings/webhooks");
    return { ok: true as const };
  } catch (e) {
    return actionError("deleteWebhookSubscription", e, "Could not delete subscription");
  }
}

/** Enqueue a test.ping delivery for ONE subscription (delivered by the Step-16 worker). */
export async function sendTestWebhook(id: string) {
  try {
    const ctx = await requirePermission("webhooks:write");
    const sub = await db.webhookSubscription.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!sub) return { ok: false as const, error: "Not found" };
    await db.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        event: "test.ping",
        payload: { event: "test.ping", workspaceId: ctx.workspaceId, message: "Vaani AI webhook test", emittedAt: new Date().toISOString() },
        nextRetryAt: new Date(),
      },
    });
    revalidatePath("/settings/webhooks");
    return { ok: true as const };
  } catch (e) {
    return actionError("sendTestWebhook", e, "Could not enqueue test event");
  }
}
