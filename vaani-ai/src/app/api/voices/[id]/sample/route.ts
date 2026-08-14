import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { s3, ensureBucket } from "@/lib/storage";

const VOICES_BUCKET = process.env.S3_BUCKET_VOICES ?? "vaani-voices";

/** GET /api/voices/[id]/sample → 302 to a 15-min presigned MinIO URL (or 404). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireWorkspace();
    const voice = await db.customVoice.findFirst({
      where: { id: params.id, workspaceId: ctx.workspaceId },
      select: { sampleKey: true },
    });
    if (!voice?.sampleKey) return new NextResponse("no sample", { status: 404 });
    await ensureBucket(VOICES_BUCKET);
    const url = await s3.presignedGetObject(VOICES_BUCKET, voice.sampleKey, 15 * 60);
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse("unauthorized", { status: 401 });
  }
}
