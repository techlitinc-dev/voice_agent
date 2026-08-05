import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { listNumbers, numberCreateSchema, registerNumber } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "numbers:read", async (ctx) => apiOk(await listNumbers(ctx.workspaceId)));
}

/**
 * Register a number record + optional agent assignment. Purchasing/provisioning a
 * NEW DID from Vobiz stays an operator/dashboard action (guide 09 billing) — this
 * endpoint registers numbers already on your Vobiz account.
 */
export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "numbers:write", async (ctx) => {
    const body = await parseJsonBody(req, numberCreateSchema);
    if ("response" in body) return body.response;
    const result = await registerNumber(ctx.workspaceId, body.data);
    if (result.error) return apiError(422, result.error, result.error);
    return apiOk(result.number, 201);
  });
}
