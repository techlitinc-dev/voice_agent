import { NextResponse } from "next/server";
import { apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { agentCreateSchema, createAgent, listAgents } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "agents:read", async (ctx) => apiOk(await listAgents(ctx.workspaceId)));
}

export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "agents:write", async (ctx) => {
    const body = await parseJsonBody(req, agentCreateSchema);
    if ("response" in body) return body.response;
    const agent = await createAgent(ctx.workspaceId, body.data);
    return apiOk(agent, 201);
  });
}
