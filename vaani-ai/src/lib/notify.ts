import nodemailer from "nodemailer";
import { sendWhatsAppTemplate } from "./vobiz"; // guide 04's client

export function staffEmails(): string[] {
  return (process.env.STAFF_NOTIFICATION_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function staffWhatsAppNumbers(): string[] {
  return (process.env.STAFF_NOTIFICATION_WHATSAPP ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Email a summary to staff. Skips cleanly when SMTP is not configured. Never throws. */
export async function sendStaffEmail(
  subject: string,
  text: string
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const to = staffEmails();
  const host = process.env.SMTP_HOST;
  if (to.length === 0 || !host) {
    console.log(`[notify] email skipped (no SMTP_HOST or recipients): ${subject}`);
    return { ok: true, skipped: true };
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
        : {}),
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? "Vaani AI <no-reply@vaani.ai>",
      to: to.join(", "),
      subject,
      text,
    });
    return { ok: true };
  } catch (e) {
    console.error("sendStaffEmail failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

/** WhatsApp a summary to staff via guide 04's Vobiz client, behind the
 *  WHATSAPP_DRY_RUN gate (true = log only, the default). Never throws.
 *  Params are mapped to the WhatsApp Cloud-API body-component shape that
 *  guide 04's client expects (same shape as guide 05's waComponents helper). */
export async function sendStaffWhatsApp(
  templateName: string,
  params: string[]
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const numbers = staffWhatsAppNumbers();
  if (numbers.length === 0) return { ok: true, skipped: true };
  if (process.env.WHATSAPP_DRY_RUN !== "false") {
    console.log(
      `[notify] whatsapp DRY RUN template=${templateName} to=${numbers.join(",")} params=${JSON.stringify(params)}`
    );
    return { ok: true, skipped: true };
  }
  const components: Array<Record<string, unknown>> = params.length
    ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
    : [];
  let lastError: string | undefined;
  for (const to of numbers) {
    try {
      // guide 04's client returns WhatsAppSendResult and THROWS VobizError on failure.
      await sendWhatsAppTemplate({ to, templateName, components });
    } catch (e) {
      lastError = String(e).slice(0, 200);
    }
  }
  return lastError ? { ok: false, error: lastError } : { ok: true };
}

/** One-call helper for "message taken / voicemail received" notifications. */
export async function notifyStaffMessage(input: {
  fromNumber: string;
  summary: string;
  kind: "message" | "voicemail";
}): Promise<void> {
  const subject = `[Vaani] New ${input.kind} from ${input.fromNumber}`;
  await sendStaffEmail(subject, input.summary);
  await sendStaffWhatsApp("staff_message_alert", [input.fromNumber, input.summary.slice(0, 200)]);
}
