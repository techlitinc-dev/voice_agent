import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { evaluateSegment } from "@/lib/crm/segments";

const previewSchema = z.object({
  rules: z.array(z.object({
    field: z.string().min(1),
    op: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })),
  matchMode: z.enum(["all", "any"]).default("all"),
});

/** Live preview for the segment builder (guide crm/04 §1.2): evaluate unsaved
 *  rules and return the matching count + first 5 contacts. */
export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const conditions = parsed.data.rules.filter((r) => r.field && String(r.value ?? "").trim() !== "");
  if (conditions.length === 0) {
    return NextResponse.json({ ok: true, count: 0, members: [] });
  }
  const members = await evaluateSegment(ctx.workspaceId, {
    rules: { matchMode: parsed.data.matchMode, conditions },
    matchMode: parsed.data.matchMode,
  });
  const preview = members.slice(0, 5).map((m) => {
    const attrs = (m.attributes ?? {}) as Record<string, unknown>;
    return {
      id: m.id,
      name: m.name,
      phone: m.phone,
      city: String(attrs.city ?? ""),
      score: m.leadScore?.score ?? null,
      grade: m.leadScore?.grade ?? null,
    };
  });
  return NextResponse.json({ ok: true, count: members.length, members: preview });
}
