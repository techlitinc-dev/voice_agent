import { z } from "zod";
import type { AgentToolType } from "@prisma/client";

/** Per-tool config schemas (stored as AgentToolConfig.config JSON). */
export const TOOL_CONFIG_SCHEMAS: Record<AgentToolType, z.ZodTypeAny> = {
  CALENDAR_BOOKING: z.object({
    provider: z.enum(["google", "microsoft", "calendly", "calcom"]).default("google"),
    calendarId: z.string().max(200).default("primary"),
    slotMinutes: z.coerce.number().int().min(10).max(120).default(30),
    eventTitle: z.string().max(120).default("Appointment"),
  }),
  HUMAN_TRANSFER: z.object({
    queue: z.string().max(60).default("support"),
    skill: z.string().max(60).default(""),
    fallbackNumber: z.string().max(20).default(""), // E.164 static transfer target (optional)
    whisperSummary: z.coerce.boolean().default(true),
  }),
  SMS: z.object({
    messageTemplate: z.string().min(5).max(500).default("Namaste {{name}}, {{details}} — {{business_name}}"),
  }),
  WHATSAPP: z.object({
    templateName: z.string().min(2).max(120),
    paramsHint: z.string().max(300).default(""),
  }),
  CRM_WRITE: z.object({
    provider: z.enum(["HUBSPOT", "ZOHO", "SALESFORCE", "LEADSQUARED", "FRESHSALES", "PIPEDRIVE"]).optional(),
    objectType: z.enum(["contact", "lead"]).default("contact"),
    logCallOutcome: z.coerce.boolean().default(true),
    // Native CRM actions (guide crm/01): which actions the agent may use mid-call.
    actions: z
      .array(z.enum(["create_deal", "update_deal_stage", "add_note", "schedule_task"]))
      .default(["create_deal", "update_deal_stage", "add_note", "schedule_task"]),
  }),
  PAYMENT_LINK: z.object({
    amountPaise: z.coerce.number().int().min(100).optional(), // fixed-amount agents (EMI)
    description: z.string().max(200).default("Payment"),
    sendVia: z.enum(["sms", "whatsapp", "readout"]).default("whatsapp"),
  }),
  CUSTOM_WEBHOOK: z.object({
    url: z.string().url().max(1000),
    method: z.enum(["GET", "POST"]).default("POST"),
    authHeader: z.string().max(500).optional(),
    requestTemplate: z.record(z.string(), z.unknown()).default({}),
    responseMapping: z.record(z.string(), z.string()).default({}), // {ourField: "json.path"}
  }),
  VOICEMAIL: z.object({
    transcribe: z.coerce.boolean().default(true),
    notifyEmail: z.string().email().optional().or(z.literal("")),
  }),
};

export type ToolConfigValidation = { ok: true; config: unknown } | { ok: false; error: string };

export function validateToolConfig(tool: AgentToolType, config: unknown): ToolConfigValidation {
  const parsed = TOOL_CONFIG_SCHEMAS[tool].safeParse(config ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Invalid ${tool} config: ${parsed.error.issues[0]?.message ?? "check fields"}` };
  }
  return { ok: true, config: parsed.data };
}

/** Metadata for the editor UI (labels + which tools have a dry-run test). */
export const TOOL_META: { tool: AgentToolType; label: string; description: string; testable: boolean }[] = [
  { tool: "CALENDAR_BOOKING", label: "Book appointment", description: "Availability check + booking via connected calendar", testable: true },
  { tool: "HUMAN_TRANSFER", label: "Transfer to human", description: "Warm transfer with context whisper (guide 06 queue)", testable: false },
  { tool: "SMS", label: "Send SMS", description: "Confirmation / details via Vobiz SMS", testable: true },
  { tool: "WHATSAPP", label: "Send WhatsApp", description: "Template message via Vobiz WhatsApp Business API", testable: true },
  { tool: "CRM_WRITE", label: "CRM write", description: "Create/update deals, add notes, schedule tasks; or push lead to connected CRM", testable: true },
  { tool: "PAYMENT_LINK", label: "Payment collection", description: "Razorpay payment link: read out, send, confirm", testable: true },
  { tool: "CUSTOM_WEBHOOK", label: "Custom webhook", description: "Any REST endpoint with auth + response mapping", testable: true },
  { tool: "VOICEMAIL", label: "Take a message", description: "Voicemail capture with transcription + notify", testable: false },
];

/** Resolve a JSON path like "data.order.status" from a webhook response. */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Apply CUSTOM_WEBHOOK responseMapping to a response body. */
export function applyResponseMapping(
  mapping: Record<string, string>,
  responseBody: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [ourField, path] of Object.entries(mapping)) {
    out[ourField] = resolveJsonPath(responseBody, path);
  }
  return out;
}
