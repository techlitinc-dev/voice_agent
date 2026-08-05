/**
 * Minimal Vobiz REST client — WhatsApp Business template sends (readme §9).
 * OPERATOR GATE: VOBIZ_WHATSAPP_PATH defaults to "/v1/whatsapp/messages" and the body
 * mirrors the WhatsApp Business Cloud API template-send shape. Confirm against
 * https://vobiz.ai/docs before the first live send; adjust ONLY VOBIZ_WHATSAPP_PATH /
 * VOBIZ_API_BASE in .env if Vobiz documents a different path.
 */

export class VobizError extends Error {
  constructor(public status: number, message: string) {
    super(`Vobiz ${status}: ${message}`);
  }
}

export type WhatsAppTemplateInput = {
  /** Recipient, E.164, e.g. "+919812345678". */
  to: string;
  /** Approved template name from the Vobiz/Meta console, e.g. "call_followup". */
  templateName: string;
  /** Template language code; default "en". */
  languageCode?: string;
  /** WhatsApp template components (header/body parameters). */
  components?: Array<Record<string, unknown>>;
};

export type WhatsAppSendResult = {
  /** Provider-side message id when the response carries one, else null. */
  providerMessageId: string | null;
  /** Raw parsed response body for logging/debugging. */
  raw: unknown;
};

export async function sendWhatsAppTemplate(
  input: WhatsAppTemplateInput
): Promise<WhatsAppSendResult> {
  const base = (process.env.VOBIZ_API_BASE ?? "https://api.vobiz.ai").replace(/\/$/, "");
  const path = process.env.VOBIZ_WHATSAPP_PATH ?? "/v1/whatsapp/messages";
  const authId = process.env.VOBIZ_AUTH_ID ?? "";
  const authToken = process.env.VOBIZ_AUTH_TOKEN ?? "";
  const sender = process.env.VOBIZ_WHATSAPP_SENDER ?? "";
  if (!authId || !authToken) throw new VobizError(0, "VOBIZ_AUTH_ID/VOBIZ_AUTH_TOKEN not set");
  if (!sender) throw new VobizError(0, "VOBIZ_WHATSAPP_SENDER not set");
  if (!/^\+[1-9]\d{6,14}$/.test(input.to)) throw new VobizError(0, `bad recipient: ${input.to}`);

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`,
    },
    body: JSON.stringify({
      from: sender,
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode ?? "en" },
        components: input.components ?? [],
      },
    }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new VobizError(res.status, text.slice(0, 500));
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  const r = raw as { message_id?: string; id?: string } | null;
  return { providerMessageId: r?.message_id ?? r?.id ?? null, raw };
}

// ---------- Guide 05 addition: transactional SMS ----------

export type SmsInput = {
  /** Recipient, E.164, e.g. "+919812345678". */
  to: string;
  /** SMS body (truncated to 900 chars). */
  message: string;
  /** Override sender id; default VOBIZ_SMS_SENDER env. */
  senderId?: string;
};

export type SmsSendResult = {
  providerMessageId: string | null;
  raw: unknown;
};

/**
 * Send a transactional SMS via Vobiz (readme §4.4 send_sms agent tool).
 * OPERATOR GATE: VOBIZ_SMS_PATH defaults to "/v1/sms/messages". Confirm the exact
 * path/payload from https://vobiz.ai/docs before the first LIVE send; adjust ONLY
 * VOBIZ_SMS_PATH / VOBIZ_API_BASE in .env if Vobiz documents a different path.
 */
export async function sendSms(input: SmsInput): Promise<SmsSendResult> {
  const base = (process.env.VOBIZ_API_BASE ?? "https://api.vobiz.ai").replace(/\/$/, "");
  const path = process.env.VOBIZ_SMS_PATH ?? "/v1/sms/messages";
  const authId = process.env.VOBIZ_AUTH_ID ?? "";
  const authToken = process.env.VOBIZ_AUTH_TOKEN ?? "";
  const sender = input.senderId ?? process.env.VOBIZ_SMS_SENDER ?? "";
  if (!authId || !authToken) throw new VobizError(0, "VOBIZ_AUTH_ID/VOBIZ_AUTH_TOKEN not set");
  if (!sender) throw new VobizError(0, "VOBIZ_SMS_SENDER not set");
  if (!/^\+[1-9]\d{6,14}$/.test(input.to)) throw new VobizError(0, `bad recipient: ${input.to}`);

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`,
    },
    body: JSON.stringify({ from: sender, to: input.to, type: "sms", text: input.message.slice(0, 900) }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new VobizError(res.status, text.slice(0, 500));
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  const r = raw as { message_id?: string; id?: string } | null;
  return { providerMessageId: r?.message_id ?? r?.id ?? null, raw };
}
