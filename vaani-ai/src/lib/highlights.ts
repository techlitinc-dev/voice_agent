/**
 * Call Highlights Reel (docs/new-features/05 §3.6): post-call selection of 3–5
 * notable transcript segments (successful close, objection handling) stitched
 * into a ~30s audio clip. Pure functions here — the audio stitching happens in
 * the post-call worker via ffmpeg-static.
 *
 * TranscriptEntry has a single timestampMs (utterance START) with no per-turn
 * duration, so a segment's end is inferred from the next entry's start (or a
 * fixed window for the final segment).
 */

export type HighlightSegment = {
  speaker: "AGENT" | "CALLER" | "SYSTEM";
  text: string;
  startMs: number;
  endMs: number; // exclusive — inferred from the next entry's start
};

export type SegmentSource = {
  speaker: "AGENT" | "CALLER" | "SYSTEM";
  text: string;
  timestampMs: number;
  sentiment?: string | null; // positive | neutral | negative | angry | frustrated | joyful
  sentimentScore?: number | null; // -1..1
};

export const MIN_SEGMENTS = 3;
export const MAX_SEGMENTS = 5;
export const POSITIVE_LABELS = ["positive", "joyful"] as const;
export const NEGATIVE_LABELS = ["negative", "angry", "frustrated"] as const;
export const POSITIVE_SCORE_CUTOFF = 0.4;
/** Final-segment end when there's no following entry to bound it. */
export const DEFAULT_SEGMENT_MS = 8_000;
/** Reel cap (roadmap: "30-second"). */
export const REEL_CAP_SEC = 30;

/**
 * Pick 3–5 notable segments:
 *  1. Caller turns with positive/joyful sentiment (successful close, laughter).
 *  2. Agent turns that FOLLOW a caller's negative/frustrated turn (objection
 *     handling — the rebuttal).
 *  3. Fallback: the highest-|score| turns (any speaker) until we hit MIN_SEGMENTS.
 * Segments are returned in chronological order. Never throws; returns [] when
 * there are no usable entries.
 */
export function selectHighlightSegments(entries: SegmentSource[]): HighlightSegment[] {
  if (entries.length === 0) return [];

  const ordered = [...entries].sort((a, b) => a.timestampMs - b.timestampMs);
  const picks = new Map<number, SegmentSource>(); // by timestampMs, dedupes

  // 1) Positive caller turns.
  for (const e of ordered) {
    if (e.speaker === "CALLER" && POSITIVE_LABELS.includes(e.sentiment as (typeof POSITIVE_LABELS)[number])
        && (e.sentimentScore ?? 0) > POSITIVE_SCORE_CUTOFF) {
      picks.set(e.timestampMs, e);
    }
  }

  // 2) Agent rebuttals after a negative/frustrated caller turn.
  for (let i = 0; i < ordered.length && picks.size < MAX_SEGMENTS; i++) {
    const e = ordered[i];
    const prev = ordered[i - 1];
    if (e.speaker === "AGENT" && prev && prev.speaker === "CALLER"
        && NEGATIVE_LABELS.includes(prev.sentiment as (typeof NEGATIVE_LABELS)[number])
        && !picks.has(e.timestampMs)) {
      picks.set(e.timestampMs, e);
    }
  }

  // 3) Fallback to the highest-|score| turns until MIN_SEGMENTS.
  if (picks.size < MIN_SEGMENTS) {
    const byAbs = ordered
      .filter((e) => !picks.has(e.timestampMs))
      .sort((a, b) => Math.abs(b.sentimentScore ?? 0) - Math.abs(a.sentimentScore ?? 0));
    for (const e of byAbs) {
      if (picks.size >= MIN_SEGMENTS) break;
      picks.set(e.timestampMs, e);
    }
  }

  const selected = ordered.filter((e) => picks.has(e.timestampMs)).slice(0, MAX_SEGMENTS);
  return selected.map((e, i) => {
    const next = selected[i + 1];
    const endMs = next ? next.timestampMs : e.timestampMs + DEFAULT_SEGMENT_MS;
    return { speaker: e.speaker, text: e.text, startMs: e.timestampMs, endMs };
  });
}

/**
 * Build a single ffmpeg filter_complex that cuts each segment and concats them
 * into one clip, capped at REEL_CAP_SEC. Each segment is a `atrim` + `asetpts`
 * pair, joined by `concat=n=N:v=0:a=1`.
 */
export function buildFfmpegFilter(segments: HighlightSegment[], capSec = REEL_CAP_SEC): string {
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const start = Math.max(0, Math.floor(s.startMs / 1000));
    const end = Math.max(start + 1, Math.ceil(s.endMs / 1000));
    parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[s${i}]`);
  }
  const labels = segments.map((_, i) => `[s${i}]`).join("");
  const concat = segments.length > 1
    ? `${labels}concat=n=${segments.length}:v=0:a=1,atrim=0:${capSec},asetpts=PTS-STARTPTS[out]`
    : `[s0]atrim=0:${capSec},asetpts=PTS-STARTPTS[out]`;
  return [...parts, concat].join(";");
}
