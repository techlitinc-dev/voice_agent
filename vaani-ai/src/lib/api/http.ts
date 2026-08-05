import { NextResponse } from "next/server";
import { ApiAuthError, requireApiKey, type ApiKeyContext } from "@/lib/apikeys";
import { rateLimitAllow } from "@/lib/ratelimit";
import type { PermissionKey } from "@/lib/permissions";

export function apiOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/**
 * Wrapper for every /api/v1 handler: API-key auth (scope) -> per-key rate limit ->
 * handler. Never throws; consistent error shape.
 */
export async function withApiKey(
  req: Request,
  scope: PermissionKey,
  handler: (ctx: ApiKeyContext, req: Request) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const ctx = await requireApiKey(req, scope);
    if (!rateLimitAllow(ctx.apiKey.id)) {
      return apiError(429, "rate_limited", "Rate limit exceeded — default 120 requests/minute per API key (PUBLIC_API_RATE_LIMIT)");
    }
    return await handler(ctx, req);
  } catch (e) {
    if (e instanceof ApiAuthError) return apiError(e.status, e.message, e.message);
    console.error(`[api v1] ${scope} handler error`, e);
    return apiError(500, "internal_error", "Unexpected server error");
  }
}

/** Parse + validate a JSON body with zod; returns parsed data or a 400 response. */
export async function parseJsonBody<T>(
  req: Request,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } },
): Promise<{ data: T } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { response: apiError(400, "invalid_json", "Body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { response: apiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Invalid input") };
  }
  return { data: parsed.data };
}
