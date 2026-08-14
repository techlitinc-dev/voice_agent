/**
 * Call Highlights Reel (docs/new-features/05 §3.6): audio stitching for the
 * post-call worker. Reads the full recording from MinIO, cuts the selected
 * transcript segments with ffmpeg-static, and uploads the ~30s reel back.
 *
 * Graceful degradation: any failure (no recording, missing object, ffmpeg
 * error, selection too small) returns null and never throws — the post-call
 * sweep keeps going for other calls.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { selectHighlightSegments, buildFfmpegFilter, type SegmentSource, type HighlightSegment } from "../lib/highlights";
import { getObject, putObject, RECORDINGS_BUCKET } from "../lib/storage";

const execFileAsync = promisify(execFile);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export type HighlightResult = {
  key: string; // MinIO object key of the reel
  segments: HighlightSegment[]; // for the call detail UI
} | null;

/** Run ffmpeg on a wav buffer with the given filter; returns the output wav. */
async function runFfmpeg(input: Buffer, filter: string): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary missing");
  const { stdout } = await execFileAsync(
    ffmpegPath,
    ["-i", "pipe:0", "-filter_complex", filter, "-map", "[out]", "-f", "wav", "pipe:1"],
    { maxBuffer: 64 * 1024 * 1024 } // reels are small but headroom for wav headers
  );
  return Buffer.from(stdout);
}

/**
 * Generate the highlight reel for a completed call with a stored recording.
 * Returns null (never throws) when the call can't be reeled.
 */
export async function generateHighlights(input: {
  callId: string;
  workspaceId: string;
  recordingKey: string; // MinIO key of the full recording (NOT a pending: URL)
  entries: SegmentSource[];
}): Promise<HighlightResult> {
  try {
    const segments = selectHighlightSegments(input.entries);
    if (segments.length === 0) return null;

    const recording = await getObject(input.recordingKey);
    if (!recording) return null;

    const filter = buildFfmpegFilter(segments);
    const reel = await runFfmpeg(recording, filter);

    const key = `${input.workspaceId}/${input.callId}.highlights.wav`;
    await putObject(RECORDINGS_BUCKET, key, reel, "audio/wav");
    log(`[highlights] generated ${key} — ${segments.length} segment(s)`);
    return { key, segments };
  } catch (e) {
    console.error(`[highlights] failed for call ${input.callId}`, e);
    return null;
  }
}
