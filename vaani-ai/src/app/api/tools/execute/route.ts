import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AgentToolType } from "@prisma/client";
import { db } from "@/lib/db";
import { executeTool } from "@/lib/tool-executor";

const bodySchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
  tool: z.nativeEnum(AgentToolType),
  input: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Dograh HTTP API tools POST here mid-call. Auth: static shared secret header
 * (x-tool-secret), same value Dograh already uses for webhooks. Cross-tenant safety:
 * the AgentToolConfig row is loaded with BOTH workspaceId and agentId from the body
 * — a mismatched pair yields 404.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.DOGRAH_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-tool-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const { workspaceId, agentId, tool, input } = parsed.data;

  const row = await db.agentToolConfig.findFirst({
    where: { agentId, tool, enabled: true, agent: { workspaceId } },
  });
  if (!row) {
    return NextResponse.json({ ok: false, error: "tool not enabled for this agent" }, { status: 404 });
  }

  const result = await executeTool({
    workspaceId, agentId, tool,
    config: (row.config ?? {}) as Record<string, unknown>,
    input,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
