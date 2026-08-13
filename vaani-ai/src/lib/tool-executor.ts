/**
 * Tool executor — runs agent tools with validated config + workspace-scoped data.
 * Called by /api/tools/execute (Dograh HTTP API tools, live calls) and by
 * testToolAction (dry-run button). Every branch honours VAANI_DRY_RUN.
 */
import { db } from "@/lib/db";
import { sendSms, sendWhatsAppTemplate } from "@/lib/vobiz";
import { getAvailability, bookSlot } from "@/lib/calendar";
import { createPaymentLink } from "@/lib/payments";
import { getCrmProvider } from "@/lib/integrations/crm";
import { applyResponseMapping } from "@/lib/tool-configs";
import type { AgentToolType, ActivityType, Prisma } from "@prisma/client";

export type ToolExecResult = { ok: boolean; error?: string; data?: unknown };

/** Dry-run guard: VAANI_DRY_RUN=true (default) simulates SMS/WhatsApp sends —
 *  nothing is dispatched, no money spent. The Vobiz library itself (guide 04) always
 *  tells the truth; simulation lives HERE, at the tool boundary. */
const DRY_RUN = () => process.env.VAANI_DRY_RUN !== "false";

function simulated(channel: string, payload: Record<string, unknown>) {
  return { simulated: true, channel, ...payload };
}

/** WhatsApp body parameters in the WhatsApp Business Cloud API component shape. */
function waComponents(params: string[]): Array<Record<string, unknown>> {
  return params.length
    ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
    : [];
}

/** Normalize E.164-ish caller input: strip spaces/dashes; keep as-is otherwise. */
function toE164(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const digits = t.replace(/[^+\d]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Default pipeline for a workspace (first by isDefault, then oldest). */
async function findDefaultPipeline(workspaceId: string) {
  return db.pipeline.findFirst({
    where: { workspaceId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

/** Resolve a stage by name (case-insensitive) within a pipeline. */
async function findStageByName(pipelineId: string, name?: string) {
  if (!name) return null;
  return db.stage.findFirst({
    where: { pipelineId, name: { equals: name, mode: "insensitive" } },
  });
}

/** Log one Activity row (system/AI actor unless a userId is given). */
async function logCrmActivity(input: {
  workspaceId: string;
  type: ActivityType;
  title: string;
  description?: string | null;
  dealId?: string | null;
  contactId?: string | null;
  callId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return db.activity.create({
    data: {
      workspaceId: input.workspaceId,
      dealId: input.dealId ?? null,
      contactId: input.contactId ?? null,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      userId: input.userId ?? null,
      callId: input.callId ?? null,
    },
  });
}

/** Find or create a Contact by E.164 phone (unique per workspace). */
async function findOrCreateContact(workspaceId: string, phone: string) {
  return db.contact.upsert({
    where: { workspaceId_phone: { workspaceId, phone } },
    update: {},
    create: { workspaceId, phone },
  });
}

/** Resolve a contact id by phone (best-effort; null when the contact is unknown). */
async function contactIdByPhone(workspaceId: string, phone: string): Promise<string | null> {
  const c = await db.contact.findFirst({ where: { workspaceId, phone }, select: { id: true } });
  return c?.id ?? null;
}

/** Open deal for a contact (used to link outbound-message activities). */
async function openDealIdForContact(workspaceId: string, contactId: string): Promise<string | null> {
  const d = await db.deal.findFirst({ where: { workspaceId, contactId, status: "OPEN" }, select: { id: true } });
  return d?.id ?? null;
}

/** Native CRM_WRITE actions (guide crm/01 §4): create_deal, update_deal_stage,
 *  add_note, schedule_task. Runs even without an external CRM connection. */
async function executeCrmWrite(
  params: Record<string, unknown>,
  ctx: { workspaceId: string; userId?: string | null; callId?: string | null },
): Promise<ToolExecResult> {
  const action = String(params.action ?? "");
  switch (action) {
    case "create_deal": {
      const phone = toE164(params.contact_phone);
      if (!phone) return { ok: false, error: "create_deal needs contact_phone (E.164, e.g. +919876543210)." };
      const title = String(params.title ?? "").trim();
      if (!title) return { ok: false, error: "create_deal needs title." };

      const pipeline = await findDefaultPipeline(ctx.workspaceId);
      if (!pipeline) return { ok: false, error: "No pipeline exists yet — create one in CRM settings first." };
      const stage = await findStageByName(pipeline.id, params.stage_name ? String(params.stage_name) : undefined);
      if (params.stage_name && !stage) {
        return { ok: false, error: `Stage "${params.stage_name}" not found in pipeline "${pipeline.name}".` };
      }
      const firstStage = stage ?? (await db.stage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { order: "asc" },
      }));
      if (!firstStage) return { ok: false, error: "Pipeline has no stages." };

      const contact = await findOrCreateContact(ctx.workspaceId, phone);
      const valuePaise = Number.isFinite(Number(params.value_paise)) ? Math.max(0, Math.round(Number(params.value_paise))) : 0;
      const attributes = params.attributes && typeof params.attributes === "object" ? params.attributes : undefined;

      const deal = await db.deal.create({
        data: {
          workspaceId: ctx.workspaceId,
          pipelineId: pipeline.id,
          stageId: firstStage.id,
          contactId: contact.id,
          title,
          valuePaise,
          ...(attributes ? { attributes: attributes as Prisma.InputJsonValue } : {}),
          source: ctx.callId ? `call:${ctx.callId}` : "ai-tool",
          createdFromCallId: ctx.callId ?? null,
        },
      });
      await logCrmActivity({
        workspaceId: ctx.workspaceId,
        dealId: deal.id,
        contactId: contact.id,
        type: "DEAL_CREATED",
        title: `Deal created: ${deal.title}`,
        callId: ctx.callId,
        userId: ctx.userId,
        metadata: { valuePaise: deal.valuePaise, stage: firstStage.name },
      });
      return { ok: true, data: { deal_id: deal.id, stage: firstStage.name } };
    }

    case "update_deal_stage": {
      const dealId = String(params.deal_id ?? "");
      if (!dealId) return { ok: false, error: "update_deal_stage needs deal_id." };
      const stageName = String(params.stage_name ?? "");
      if (!stageName) return { ok: false, error: "update_deal_stage needs stage_name." };

      const deal = await db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } });
      if (!deal) return { ok: false, error: "Deal not found in this workspace." };
      const stage = await findStageByName(deal.pipelineId, stageName);
      if (!stage) return { ok: false, error: `Stage "${stageName}" not found in the deal's pipeline.` };
      if (deal.stageId === stage.id) return { ok: true, data: { unchanged: true } };

      const status = stage.isWonStage ? "WON" : stage.isLostStage ? "LOST" : "OPEN";
      await db.deal.update({
        where: { id: deal.id },
        data: {
          stageId: stage.id,
          status,
          ...(status !== "OPEN" ? { closedAt: new Date(), closedReason: status === "WON" ? "moved to won stage" : "moved to lost stage" } : { closedAt: null, closedReason: null }),
        },
      });
      await logCrmActivity({
        workspaceId: ctx.workspaceId,
        dealId: deal.id,
        contactId: deal.contactId,
        type: status === "WON" ? "DEAL_WON" : status === "LOST" ? "DEAL_LOST" : "STAGE_CHANGED",
        title: `Stage → ${stage.name}`,
        callId: ctx.callId,
        userId: ctx.userId,
        metadata: { fromStageId: deal.stageId, toStageId: stage.id, status },
      });
      return { ok: true, data: { deal_id: deal.id, stage: stage.name, status } };
    }

    case "add_note": {
      const dealId = String(params.deal_id ?? "");
      const body = String(params.body ?? "").trim();
      if (!dealId) return { ok: false, error: "add_note needs deal_id." };
      if (!body) return { ok: false, error: "add_note needs body." };

      const deal = await db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } });
      if (!deal) return { ok: false, error: "Deal not found in this workspace." };
      await db.dealNote.create({ data: { dealId, userId: ctx.userId ?? null, body } });
      await logCrmActivity({
        workspaceId: ctx.workspaceId,
        dealId,
        contactId: deal.contactId,
        type: "NOTE_ADDED",
        title: "Note added",
        description: body.slice(0, 200),
        callId: ctx.callId,
        userId: ctx.userId,
      });
      return { ok: true, data: { added: true } };
    }

    case "schedule_task": {
      const dealId = String(params.deal_id ?? "");
      const title = String(params.title ?? "").trim();
      const dueAt = new Date(String(params.due_at ?? ""));
      if (!dealId) return { ok: false, error: "schedule_task needs deal_id." };
      if (!title) return { ok: false, error: "schedule_task needs title." };
      if (Number.isNaN(dueAt.getTime())) return { ok: false, error: "schedule_task needs due_at as an ISO date." };

      const deal = await db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } });
      if (!deal) return { ok: false, error: "Deal not found in this workspace." };
      const type = String(params.type ?? "FOLLOW_UP").toUpperCase();
      const task = await db.task.create({
        data: {
          workspaceId: ctx.workspaceId,
          dealId,
          contactId: deal.contactId,
          assigneeId: ctx.userId ?? null,
          type: ["CALL", "SMS", "WHATSAPP", "EMAIL", "MEETING", "DOCUMENT", "FOLLOW_UP", "CUSTOM"].includes(type) ? (type as never) : "FOLLOW_UP",
          title,
          dueAt,
          reminderMin: 30,
        },
      });
      await logCrmActivity({
        workspaceId: ctx.workspaceId,
        dealId,
        contactId: deal.contactId,
        type: "TASK_COMPLETED",
        title: `Task scheduled: ${title}`,
        description: `Due ${dueAt.toISOString()}`,
        callId: ctx.callId,
        userId: ctx.userId,
        metadata: { taskId: task.id, type: task.type, dueAt: dueAt.toISOString() },
      });
      return { ok: true, data: { task_id: task.id } };
    }

    default:
      return { ok: false, error: `Unknown CRM action: ${action}. Expected one of create_deal, update_deal_stage, add_note, schedule_task.` };
  }
}

export async function executeTool(args: {
  workspaceId: string;
  agentId: string;
  tool: AgentToolType;
  config: Record<string, unknown>;
  input: Record<string, unknown>;
}): Promise<ToolExecResult> {
  const { workspaceId, config, input } = args;
  try {
    switch (args.tool) {
      case "CALENDAR_BOOKING": {
        const provider = String(config.provider ?? "google").toUpperCase() as "GOOGLE" | "MICROSOFT" | "CALENDLY" | "CALCOM";
        const conn = await db.calendarConnection.findFirst({
          where: { workspaceId, provider, active: true },
        });
        if (!conn) return { ok: false, error: `No active ${provider} calendar connection (Settings → Integrations).` };
        if (input.action === "book") {
          const evt = await bookSlot(conn, {
            startIso: String(input.startIso),
            endIso: String(input.endIso),
            summary: String(config.eventTitle ?? "Appointment"),
            attendeeName: input.name ? String(input.name) : undefined,
            attendeePhone: input.phone ? String(input.phone) : undefined,
          });
          // Activity (guide crm/03 §1.1: meeting booked → MEETING_SCHEDULED).
          const contactId = input.phone ? await contactIdByPhone(workspaceId, String(input.phone)) : null;
          const dealId = contactId ? await openDealIdForContact(workspaceId, contactId) : null;
          await logCrmActivity({
            workspaceId,
            contactId,
            dealId,
            type: "MEETING_SCHEDULED",
            title: `Meeting scheduled: ${String(config.eventTitle ?? "Appointment")}`,
            description: `${String(input.startIso ?? "")} → ${String(input.endIso ?? "")}`,
            metadata: { eventId: evt.eventId, startIso: input.startIso, endIso: input.endIso },
          });
          return { ok: true, data: evt };
        }
        const slots = await getAvailability(conn, { slotMinutes: Number(config.slotMinutes ?? 30) });
        return { ok: true, data: { slots: slots.slice(0, 5) } };
      }
      case "SMS": {
        const to = String(input.to ?? "");
        const message = String(input.message ?? config.messageTemplate ?? "");
        if (!to || !message) return { ok: false, error: "SMS needs to + message." };
        if (DRY_RUN()) return { ok: true, data: simulated("sms", { to, message }) };
        const result = await sendSms({ to, message });
        // Activity (guide crm/03 §1.1: SMS sent → SMS_SENT).
        const contactId = await contactIdByPhone(workspaceId, to);
        const dealId = contactId ? await openDealIdForContact(workspaceId, contactId) : null;
        await logCrmActivity({
          workspaceId,
          contactId,
          dealId,
          type: "SMS_SENT",
          title: `SMS sent to ${to}`,
          description: message.slice(0, 200),
          metadata: { to, message: message.slice(0, 500) },
        });
        return { ok: true, data: result };
      }
      case "WHATSAPP": {
        const to = String(input.to ?? "");
        const templateName = String(input.template ?? config.templateName ?? "");
        const params = Array.isArray(input.params) ? (input.params as string[]) : [];
        if (!to || !templateName) return { ok: false, error: "WhatsApp needs to + template." };
        if (DRY_RUN()) return { ok: true, data: simulated("whatsapp", { to, templateName, params }) };
        const result = await sendWhatsAppTemplate({ to, templateName, components: waComponents(params) });
        // Activity (guide crm/03 §1.1: WhatsApp sent → WHATSAPP_SENT).
        const contactId = await contactIdByPhone(workspaceId, to);
        const dealId = contactId ? await openDealIdForContact(workspaceId, contactId) : null;
        await logCrmActivity({
          workspaceId,
          contactId,
          dealId,
          type: "WHATSAPP_SENT",
          title: `WhatsApp sent to ${to}`,
          description: `Template: ${templateName}`,
          metadata: { to, templateName, params },
        });
        return { ok: true, data: result };
      }
      case "CRM_WRITE": {
        // Native CRM actions (guide crm/01 §4): create_deal, update_deal_stage,
        // add_note, schedule_task. Input may carry an optional call context.
        const action = input.action ? String(input.action) : "";
        const callId = input.call_id ? String(input.call_id) : input.dograh_call_id ? String(input.dograh_call_id) : undefined;
        if (action) {
          return executeCrmWrite(
            input as Record<string, unknown>,
            { workspaceId, userId: null, callId },
          );
        }
        // Legacy path: flat lead push to the connected external CRM.
        const provider = (config.provider as "HUBSPOT" | "ZOHO" | undefined) ?? undefined;
        const conn = await db.crmConnection.findFirst({
          where: { workspaceId, active: true, ...(provider ? { provider } : {}) },
          orderBy: { updatedAt: "desc" },
        });
        if (!conn) return { ok: false, error: "No active CRM connection (Settings → Integrations)." };
        const crm = getCrmProvider(conn.provider);
        const lead = (input.lead ?? input) as Record<string, unknown>;
        const out = await crm.pushLead(conn, {
          name: String(lead.name ?? ""),
          phone: String(lead.phone ?? ""),
          email: lead.email ? String(lead.email) : undefined,
          note: lead.note ? String(lead.note) : undefined,
          outcome: input.outcome ? String(input.outcome) : undefined,
        });
        return { ok: true, data: out };
      }
      case "PAYMENT_LINK": {
        const amountPaise = Number(input.amountPaise ?? config.amountPaise ?? 0);
        const link = await createPaymentLink({
          amountPaise,
          description: String(input.description ?? config.description ?? "Payment"),
          customerPhone: input.phone ? String(input.phone) : undefined,
          referenceId: `${args.agentId}:${Date.now()}`,
        });
        // Optionally send the link immediately (simulated under VAANI_DRY_RUN).
        let sentVia: string = "readout";
        if (input.phone && config.sendVia !== "readout") {
          sentVia = String(config.sendVia ?? "readout");
          if (!DRY_RUN()) {
            if (config.sendVia === "sms") {
              await sendSms({ to: String(input.phone), message: `Pay here: ${link.shortUrl}` });
            } else if (config.sendVia === "whatsapp" && config.templateName) {
              await sendWhatsAppTemplate({
                to: String(input.phone),
                templateName: String(config.templateName),
                components: waComponents([link.shortUrl]),
              });
            }
          }
        }
        return { ok: true, data: { ...link, sentVia: DRY_RUN() && sentVia !== "readout" ? `simulated-${sentVia}` : sentVia } };
      }
      case "CUSTOM_WEBHOOK": {
        const url = String(config.url ?? "");
        if (!url) return { ok: false, error: "Webhook URL not configured." };
        const res = await fetch(url, {
          method: String(config.method ?? "POST"),
          headers: {
            "Content-Type": "application/json",
            ...(config.authHeader ? { Authorization: String(config.authHeader) } : {}),
          },
          body: String(config.method ?? "POST") === "POST"
            ? JSON.stringify({ ...(config.requestTemplate as object), ...input })
            : undefined,
          signal: AbortSignal.timeout(15000),
        });
        const bodyText = await res.text();
        let body: unknown = bodyText;
        try { body = JSON.parse(bodyText); } catch { /* non-JSON body */ }
        const mapped = applyResponseMapping((config.responseMapping ?? {}) as Record<string, string>, body);
        return { ok: res.ok, error: res.ok ? undefined : `webhook HTTP ${res.status}`, data: { status: res.status, mapped, raw: bodyText.slice(0, 500) } };
      }
      case "VOICEMAIL": {
        await db.voicemailMessage.create({
          data: {
            workspaceId,
            fromNumber: String(input.caller_phone ?? input.from ?? "unknown"),
            transcript: [input.caller_name ? `Name: ${input.caller_name}` : null, input.message ? String(input.message) : null]
              .filter(Boolean).join("\n") || null,
          },
        });
        return { ok: true, data: { captured: true } };
      }
      case "HUMAN_TRANSFER":
        // Executed by Dograh's native Call Transfer tool; TransferRequest rows are
        // created by the guide-06 webhook receiver. Nothing to do here.
        return { ok: true, data: { delegated: "dograh_call_transfer" } };
      default:
        return { ok: false, error: `Unknown tool.` };
    }
  } catch (e) {
    console.error(`tool ${args.tool} failed:`, e);
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "tool failed" };
  }
}
