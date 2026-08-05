import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { contactsBulkSchema, listContacts, upsertContacts } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "contacts:read", async (ctx) => apiOk(await listContacts(ctx.workspaceId)));
}

/** Bulk import: {"contacts": [{phone, name?, listId?, timezone?, attributes?}, ...]} up to 1000. */
export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "contacts:import", async (ctx) => {
    const body = await parseJsonBody(req, contactsBulkSchema);
    if ("response" in body) return body.response;
    const result = await upsertContacts(ctx.workspaceId, body.data.contacts);
    if (result.error) return apiError(422, result.error, `Contact list not found for phone ${result.phone}`);
    return apiOk(result, 201);
  });
}
