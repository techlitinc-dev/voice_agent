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
import type { AgentToolType } from "@prisma/client";

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
        return { ok: true, data: await sendSms({ to, message }) };
      }
      case "WHATSAPP": {
        const to = String(input.to ?? "");
        const templateName = String(input.template ?? config.templateName ?? "");
        const params = Array.isArray(input.params) ? (input.params as string[]) : [];
        if (!to || !templateName) return { ok: false, error: "WhatsApp needs to + template." };
        if (DRY_RUN()) return { ok: true, data: simulated("whatsapp", { to, templateName, params }) };
        return { ok: true, data: await sendWhatsAppTemplate({ to, templateName, components: waComponents(params) }) };
      }
      case "CRM_WRITE": {
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
