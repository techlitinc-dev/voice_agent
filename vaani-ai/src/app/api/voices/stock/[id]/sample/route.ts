import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { getVoice } from "@/lib/voices";

/**
 * GET /api/voices/stock/[id]/sample → 302 to a sample audio URL for a Sarvam
 * Bulbul v3 stock voice (AGENT-09 "Preview voice"). The sample audio comes from
 * a public bucket — there is no per-workspace auth needed beyond being logged in.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireWorkspace();
  } catch {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const voice = getVoice(params.id);
  if (!voice) return new NextResponse("unknown voice", { status: 404 });
  const base = process.env.VOICE_SAMPLE_BASE_URL?.replace(/\/$/, "");
  const url = base
    ? `${base}/${encodeURIComponent(voice.id)}.mp3`
    : `https://storage.googleapis.com/vaani-voice-samples/${encodeURIComponent(voice.id)}.mp3`;
  return NextResponse.redirect(url);
}
