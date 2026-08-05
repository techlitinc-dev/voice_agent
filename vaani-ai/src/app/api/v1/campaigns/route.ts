import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { campaignCreateSchema, createCampaign, listCampaigns } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "campaigns:read", async (ctx) => apiOk(await listCampaigns(ctx.workspaceId)));
}

export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "campaigns:write", async (ctx) => {
    const body = await parseJsonBody(req, campaignCreateSchema);
    if ("response" in body) return body.response;
    const result = await createCampaign(ctx.workspaceId, body.data);
    if (result.error) {
      return apiError(422, result.error, `Referenced ${result.error === "agent_not_found" ? "agent" : "contact list"} not found in your workspace`);
    }
    return apiOk(result.campaign, 201);
  });
}
