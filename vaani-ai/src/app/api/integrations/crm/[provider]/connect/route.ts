import { NextRequest, NextResponse } from "next/server";
import { CrmProvider as CrmProviderEnum } from "@prisma/client";
import { requireWorkspace } from "@/lib/auth";
import { getCrmProvider } from "@/lib/integrations/crm";
import { signOAuthState } from "@/lib/integrations/oauth-state";

export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const provider = params.provider.toUpperCase();
  if (!Object.values(CrmProviderEnum).includes(provider as CrmProviderEnum)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  try {
    const url = getCrmProvider(provider as CrmProviderEnum).getAuthUrl(signOAuthState(ctx.workspaceId));
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "provider unavailable";
    return NextResponse.redirect(new URL(`/settings/integrations?error=${encodeURIComponent(msg.slice(0, 120))}`, req.url));
  }
}
