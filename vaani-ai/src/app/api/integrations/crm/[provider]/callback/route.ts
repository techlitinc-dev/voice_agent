import { NextRequest, NextResponse } from "next/server";
import { CrmProvider as CrmProviderEnum } from "@prisma/client";
import { db } from "@/lib/db";
import { getCrmProvider } from "@/lib/integrations/crm";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/settings/integrations?error=${encodeURIComponent(msg)}`, req.url));

  const workspaceId = verifyOAuthState(state);
  if (!workspaceId || !code) return fail("Invalid OAuth state — try connecting again.");

  const provider = params.provider.toUpperCase();
  if (!Object.values(CrmProviderEnum).includes(provider as CrmProviderEnum)) return fail("unknown provider");

  try {
    const tokens = await getCrmProvider(provider as CrmProviderEnum).exchangeCode(code);
    await db.crmConnection.upsert({
      where: { workspaceId_provider: { workspaceId, provider: provider as CrmProviderEnum } },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        instanceUrl: tokens.instanceUrl ?? undefined,
        active: true,
      },
      create: {
        workspaceId,
        provider: provider as CrmProviderEnum,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        instanceUrl: tokens.instanceUrl ?? null,
        active: true,
      },
    });
    await audit({ workspaceId, action: "crm.connect", entity: "CrmConnection", metadata: { provider } });
    return NextResponse.redirect(new URL(`/settings/integrations?connected=${provider}`, req.url));
  } catch (e) {
    console.error(e);
    return fail("OAuth exchange failed — check app credentials, then retry.");
  }
}
