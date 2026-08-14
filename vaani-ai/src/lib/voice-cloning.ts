/**
 * Voice cloning & brand voices (docs/new-features/03).
 *
 * Provider calls (ElevenLabs + PlayHT) follow the repo's dry-run pattern
 * (like QA_DRY_RUN / SENTIMENT_DRY_RUN): when VOICE_CLONE_DRY_RUN !== "false"
 * (default), cloning returns a deterministic fake provider id instead of
 * spending on the provider API, so the whole flow works offline and is
 * unit-testable.
 */

export const VOICE_PROVIDERS = ["elevenlabs", "playht", "sarvam"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export const VOICE_STATUSES = ["PENDING", "TRAINING", "READY", "FAILED"] as const;
export type VoiceStatus = (typeof VOICE_STATUSES)[number];

export const CUSTOM_VOICE_MAX = 5; // doc §4: 5 cloned voices per workspace
export const CUSTOM_VOICE_PRICE_PAISE = 500000; // ₹5,000/mo per voice (doc §4)

export const VOICE_SAMPLE_ACCEPT = [".mp3", ".wav"];
export const VOICE_SAMPLE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB (doc §3.1)

/** MinIO key for an uploaded sample / generated preview. */
export function voiceStorageKey(workspaceId: string, voiceId: string, kind: "sample" | "preview", filename: string): string {
  const safe = filename.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-40);
  return `${workspaceId}/voices/${voiceId}/${kind}-${safe}`;
}

export function voiceContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  return "audio/mpeg";
}

/** Validate an uploaded voice sample: mp3/wav, 30s+ implied by size floor, ≤25 MB. */
export function validateVoiceSample(filename: string, sizeBytes: number): { ok: true } | { ok: false; error: string } {
  const lower = filename.toLowerCase();
  if (!VOICE_SAMPLE_ACCEPT.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: "Only .mp3 and .wav samples are supported." };
  }
  if (sizeBytes > VOICE_SAMPLE_MAX_BYTES) return { ok: false, error: "Sample too large (max 25 MB)." };
  if (sizeBytes < 30_000) return { ok: false, error: "Sample too short — use a clean 30s+ clip of the voice." };
  return { ok: true };
}

/** Deterministic fake clone for VOICE_CLONE_DRY_RUN (no provider spend). */
function dryRunCloneId(name: string, provider: VoiceProvider): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20);
  return `dry-${provider}-${slug}`;
}

/**
 * Clone a voice on ElevenLabs from a sample buffer. Returns the provider's
 * voice_id. Throws on API/network failure so callers can mark the voice FAILED.
 * https://elevenlabs.io/docs/api-reference/voices/add
 */
export async function cloneVoiceElevenLabs(sampleBuffer: Buffer, name: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (process.env.VOICE_CLONE_DRY_RUN !== "false" || !apiKey) return dryRunCloneId(name, "elevenlabs");

  // Node 18+ global FormData + Blob (assignable to fetch BodyInit).
  const form = new FormData();
  form.append("name", name);
  form.append(
    "files",
    new Blob([new Uint8Array(sampleBuffer)], { type: "audio/mpeg" }),
    "sample.mp3",
  );
  form.append("description", `Cloned voice for ${name}`);

  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs clone failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) throw new Error("ElevenLabs clone returned no voice_id.");
  return data.voice_id;
}

/**
 * Clone a voice on PlayHT from a hosted sample URL. Returns the clone id.
 * https://docs.play.ht/reference/api-createclonedvoice
 */
export async function cloneVoicePlayHT(sampleUrl: string, name: string): Promise<string> {
  const userId = process.env.PLAYHT_USER_ID;
  const apiKey = process.env.PLAYHT_API_KEY;
  if (process.env.VOICE_CLONE_DRY_RUN !== "false" || !userId || !apiKey) return dryRunCloneId(name, "playht");

  const res = await fetch("https://api.play.ht/api/v2/cloned-voices", {
    method: "POST",
    headers: {
      "X-USER-ID": userId,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ voice_name: name, sample_url: sampleUrl }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PlayHT clone failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("PlayHT clone returned no id.");
  return data.id;
}

/**
 * Provider-agnostic clone entry point used by the server action.
 * Buffers need a hosted URL for PlayHT — callers that only have a buffer
 * should use ElevenLabs (or upload to MinIO and pass the presigned URL).
 */
export async function cloneVoice(opts: {
  provider: VoiceProvider;
  name: string;
  sampleBuffer?: Buffer;
  sampleUrl?: string;
}): Promise<string> {
  if (opts.provider === "playht") {
    if (!opts.sampleUrl) throw new Error("PlayHT cloning needs a hosted sample URL.");
    return cloneVoicePlayHT(opts.sampleUrl, opts.name);
  }
  if (!opts.sampleBuffer) throw new Error("ElevenLabs cloning needs the sample audio buffer.");
  return cloneVoiceElevenLabs(opts.sampleBuffer, opts.name);
}

/**
 * Synthesize speech with a cloned voice (doc §2.3). v1 returns the provider id
 * so the caller can log/route; the actual TTS happens inside Dograh, which
 * receives the cloned voice id in the workflow tts hints (workflow-builder.ts).
 * Kept as a seam for a future direct-synthesis path.
 */
export async function synthesizeWithClone(voice: {
  provider: string;
  clonedVoiceId: string | null;
  language: string;
}): Promise<{ provider: string; voiceId: string; language: string }> {
  if (!voice.clonedVoiceId) throw new Error("Custom voice has no provider id yet (status must be READY).");
  return { provider: voice.provider, voiceId: voice.clonedVoiceId, language: voice.language };
}
