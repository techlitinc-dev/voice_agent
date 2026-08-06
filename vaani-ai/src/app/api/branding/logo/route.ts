import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { s3, ensureBucket } from "@/lib/storage";

const BRANDING_BUCKET = process.env.S3_BUCKET_BRANDING ?? "vaani-branding";

/** GET /api/branding/logo → 302 to a 15-min presigned MinIO URL (or 404). */
export async function GET() {
  try {
    const ctx = await requireWorkspace();
    const ws = await db.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { logoUrl: true },
    });
    if (!ws?.logoUrl) return new NextResponse("no logo", { status: 404 });
    await ensureBucket(BRANDING_BUCKET);
    const url = await s3.presignedGetObject(BRANDING_BUCKET, ws.logoUrl, 15 * 60);
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse("unauthorized", { status: 401 });
  }
}
