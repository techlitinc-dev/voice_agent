export const LIVE_MODES = ["NONE", "LISTEN", "WHISPER", "BARGE", "TAKEOVER"] as const;
export type LiveModeName = (typeof LIVE_MODES)[number];

/** Allowed supervisor-mode transitions. Same→same is always allowed (idempotent). */
const ALLOWED: Record<LiveModeName, readonly LiveModeName[]> = {
  NONE: ["LISTEN", "WHISPER", "BARGE", "TAKEOVER"],
  LISTEN: ["NONE", "WHISPER", "BARGE", "TAKEOVER"],
  WHISPER: ["NONE", "BARGE", "TAKEOVER"],
  BARGE: ["NONE", "TAKEOVER"],
  TAKEOVER: ["NONE"], // release only
};

export function canTransitionLiveMode(from: LiveModeName, to: LiveModeName): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export const WHISPER_MAX_LEN = 500;

export function validateWhisperText(
  text: unknown
): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof text !== "string") return { ok: false, error: "Whisper text is required." };
  const t = text.trim();
  if (t.length === 0) return { ok: false, error: "Whisper text cannot be empty." };
  if (t.length > WHISPER_MAX_LEN) return { ok: false, error: `Keep it under ${WHISPER_MAX_LEN} characters.` };
  return { ok: true, text: t };
}
