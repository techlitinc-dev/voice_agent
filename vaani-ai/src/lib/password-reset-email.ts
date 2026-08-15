import nodemailer from "nodemailer";
import { RESET_TOKEN_TTL_MINUTES } from "./password-reset";

function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/** Email a password reset link. Skips cleanly when SMTP is not configured. Never throws. */
export async function sendPasswordResetEmail(input: {
  to: string;
  fullName: string;
  token: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(
      `[password-reset] email skipped (no SMTP_HOST) for ${input.to}: token=${input.token}`
    );
    return { ok: true, skipped: true };
  }
  const resetUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(input.token)}`;
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
      to: input.to,
      subject: "Reset your Vaani AI password",
      text: `Hi ${input.fullName},

We received a request to reset your Vaani AI password.

Reset it here (valid for ${RESET_TOKEN_TTL_MINUTES} minutes):
${resetUrl}

If you didn't request this, you can safely ignore this email — your password won't change.

— Vaani AI`,
    });
    return { ok: true };
  } catch (e) {
    console.error("sendPasswordResetEmail failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}
