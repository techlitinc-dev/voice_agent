import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain-verify";

/**
 * Caddy on-demand TLS "ask" endpoint (guide 12 Caddyfile). Caddy calls this before
 * issuing a certificate for a workspace custom domain. Approve ONLY domains that
 * are claimed by a workspace AND DNS-verified — anything else must 403 so random
 * hostnames cannot burn our Let's Encrypt rate limit.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("domain");
  if (!raw) return new NextResponse("domain param required", { status: 400 });
  const domain = normalizeDomain(raw);
  if (!domain) return new NextResponse("bad domain", { status: 400 });
  const ws = await db.workspace.findFirst({
    where: { customDomain: domain, customDomainVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (!ws) return new NextResponse("not verified", { status: 403 });
  return new NextResponse("ok", { status: 200 });
}
