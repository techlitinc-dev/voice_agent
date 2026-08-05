import { db } from "./db";
import { notifyStaffMessage } from "./notify";
import { emitWebhookEvent } from "./webhooks";

/** Sarvam batch speech-to-text. Returns null on any failure (caller falls back). */
export async function transcribeVoicemail(recordingUrl: string): Promise<string | null> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return null;
  try {
    const audio = await fetch(recordingUrl);
    if (!audio.ok) return null;
    const form = new FormData();
    form.append("file", new Blob([await audio.arrayBuffer()]), "voicemail.wav");
    form.append("model", "saarika:v2.5");
    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { transcript?: string };
    return json.transcript?.trim() || null;
  } catch (e) {
    console.error("voicemail transcription failed", e);
    return null;
  }
}

/**
 * Create a VoicemailMessage, transcribe if needed, route to staff (email + WhatsApp),
 * and emit "voicemail.received" to webhook subscribers. Never throws.
 */
export async function recordVoicemailMessage(input: {
  workspaceId: string;
  callId?: string;
  phoneNumberId?: string;
  fromNumber: string;
  transcript?: string | null;
  recordingUrl?: string | null;
}): Promise<void> {
  try {
    let transcript = input.transcript ?? null;
    if (!transcript && input.recordingUrl) {
      transcript = await transcribeVoicemail(input.recordingUrl);
    }
    const vm = await db.voicemailMessage.create({
      data: {
        workspaceId: input.workspaceId,
        callId: input.callId ?? null,
        phoneNumberId: input.phoneNumberId ?? null,
        fromNumber: input.fromNumber,
        transcript,
        recordingKey: input.recordingUrl ? `pending:${input.recordingUrl}` : null,
      },
    });
    await notifyStaffMessage({
      fromNumber: input.fromNumber,
      summary: transcript ?? "(no transcript available — listen to the recording)",
      kind: "voicemail",
    });
    await emitWebhookEvent(input.workspaceId, "voicemail.received", {
      voicemailMessageId: vm.id,
      fromNumber: input.fromNumber,
      hasTranscript: transcript !== null,
    });
  } catch (e) {
    console.error("recordVoicemailMessage failed", e);
  }
}
