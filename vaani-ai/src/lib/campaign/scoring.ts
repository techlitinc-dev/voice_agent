/**
 * Post-call conversation intelligence (readme §6.2):
 * - Interest scoring: hot/warm/cold + reason (LLM, parser is pure).
 * - Callback scheduling: "call me tomorrow at 5" → absolute dueAt (LLM resolves the
 *   natural-language hint to ISO using the contact's timezone; parser validates).
 * - Opt-out detection: deterministic on Call.outcome + transcript phrases (§11:
 *   "stop calling me" honored instantly).
 * - Sentiment escalation: negative sentiment / abuse → human flag.
 */

export type InterestScoreValue = "HOT" | "WARM" | "COLD";

// ---------- Interest scoring ----------

export function buildInterestPrompt(input: { transcript: string; campaignType: string }): {
  system: string;
  user: string;
} {
  return {
    system:
      "You classify outbound sales/service calls. Reply with ONLY a JSON object " +
      '{"score":"HOT"|"WARM"|"COLD","reason":"one short sentence"}. ' +
      "HOT = caller explicitly agreed to next step (booking, payment, demo, callback with intent). " +
      "WARM = caller engaged, asked questions, no commitment. " +
      "COLD = refusal, disinterest, wrong number, or no conversation.",
    user: `Campaign type: ${input.campaignType}\n\nTranscript:\n${input.transcript.slice(0, 4000)}`,
  };
}

/** Parse the LLM JSON. null on any deviation (caller treats null as "skip scoring"). */
export function parseInterestScore(text: string): { score: InterestScoreValue; reason: string } | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const score = o.score;
    const reason = o.reason;
    if (score !== "HOT" && score !== "WARM" && score !== "COLD") return null;
    if (typeof reason !== "string" || reason.length === 0) return null;
    return { score, reason: reason.slice(0, 300) };
  } catch {
    return null;
  }
}

// ---------- Callback scheduling ----------

export function buildCallbackPrompt(input: {
  transcript: string;
  nowIso: string;
  timezone: string;
}): { system: string; user: string } {
  return {
    system:
      "You detect callback requests in phone call transcripts. Reply with ONLY a JSON object " +
      '{"callbackRequested":boolean,"dueAt":"ISO 8601 timestamp or null","note":"short reason or null"}. ' +
      "Resolve relative hints (\"tomorrow at 5\", \"Monday morning\") against the provided current time " +
      "and caller timezone. Morning = 10:00, afternoon = 14:00, evening = 17:00 local. " +
      "dueAt must be in the future and within 30 days. If no callback was requested, dueAt is null.",
    user:
      `Current time: ${input.nowIso}\nCaller timezone: ${input.timezone}\n\n` +
      `Transcript:\n${input.transcript.slice(0, 4000)}`,
  };
}

export type CallbackExtraction = { requested: boolean; dueAt?: Date; note?: string };

/**
 * Parse + validate the LLM JSON. `now` injected. Rejects past dates, dates >30 days
 * out, and malformed payloads (returns { requested: false } — safe default).
 */
export function parseCallbackRequest(text: string, now: Date): CallbackExtraction {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (o.callbackRequested !== true) return { requested: false };
    if (typeof o.dueAt !== "string") return { requested: false };
    const dueAt = new Date(o.dueAt);
    if (Number.isNaN(dueAt.getTime())) return { requested: false };
    if (dueAt.getTime() <= now.getTime()) return { requested: false };
    const maxFuture = now.getTime() + 30 * 24 * 60 * 60_000;
    if (dueAt.getTime() > maxFuture) return { requested: false };
    return {
      requested: true,
      dueAt,
      note: typeof o.note === "string" && o.note.length > 0 ? o.note.slice(0, 200) : undefined,
    };
  } catch {
    return { requested: false };
  }
}

// ---------- Opt-out detection (deterministic — compliance path, no LLM) ----------

const OPT_OUT_PATTERNS = [
  /stop calling/i,
  /don'?t call/i,
  /do not call/i,
  /remove (me|my number)/i,
  /opt[ -]?out/i,
  /unsubscribe/i,
  /never call/i,
  /मुझे कॉल मत करो/,
  /मुझे फोन मत करो/,
];

/** True when the caller opted out. Structured outcome wins; else transcript phrases. */
export function detectOptOut(input: { outcome?: string | null; transcript?: string | null }): boolean {
  if (input.outcome === "opt-out") return true;
  const t = input.transcript ?? "";
  return OPT_OUT_PATTERNS.some((p) => p.test(t));
}

// ---------- Sentiment escalation (deterministic) ----------

const ABUSE_PATTERNS = [
  /\b(bloody|damn|hell|stupid|idiot|shut up|fraud|cheat|scam)\b/i,
  /बकवास|धोखा/,
];

/** True when the call should be flagged for a human (polite exit already happened
 *  mid-call via the agent's playbook; this creates the TransferRequest after). */
export function needsHumanEscalation(input: {
  sentiment?: string | null;
  outcome?: string | null;
  transcript?: string | null;
}): boolean {
  if (input.outcome === "escalate-to-human") return true;
  if (input.sentiment === "negative") return true;
  const t = input.transcript ?? "";
  return ABUSE_PATTERNS.some((p) => p.test(t));
}
