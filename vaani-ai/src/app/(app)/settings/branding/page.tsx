import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { expectedTxtValue } from "@/lib/domain-verify";
import { checkFeatureGate } from "@/lib/feature-gates";
import {
  removeCustomDomainAction,
  removeLogoAction,
  saveCustomDomainAction,
  savePrimaryColorAction,
  setWhiteLabelEnabledAction,
  uploadLogoAction,
  verifyCustomDomainAction,
} from "@/server/actions/branding";
import { BrandingForms } from "./branding-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branding — Vaani AI" };

export default async function BrandingPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });

  // Plan gate (guide 09). On any error, treat as not allowed — fail closed.
  let whiteLabelAllowed = false;
  let gateNote: string | null = null;
  try {
    const gate = await checkFeatureGate(ctx.workspaceId, "whiteLabel");
    whiteLabelAllowed = gate.allowed;
    if (!gate.allowed) gateNote = "White-label requires the Enterprise plan or the white-label add-on.";
  } catch {
    gateNote = "Plan feature check unavailable (guide 09 billing incomplete).";
  }

  const appHost = (process.env.APP_URL ?? "http://localhost:3000").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  return (
    <div className="max-w-2xl space-y-6" data-testid="branding-page">
      <h1 className="text-2xl font-bold">White-label branding</h1>

      {gateNote && !whiteLabelAllowed && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400" data-testid="branding-gate-banner">
          {gateNote} Logo and brand color still work on every plan.
        </p>
      )}

      <BrandingForms
        hasLogo={Boolean(workspace.logoUrl)}
        primaryColor={workspace.primaryColor ?? ""}
        customDomain={workspace.customDomain ?? ""}
        domainVerified={workspace.customDomainVerifiedAt != null}
        whiteLabelEnabled={workspace.whiteLabelEnabled}
        whiteLabelAllowed={whiteLabelAllowed}
        verificationTxt={expectedTxtValue(ctx.workspaceId)}
        appHost={appHost}
        actions={{
          uploadLogo: uploadLogoAction,
          removeLogo: removeLogoAction,
          saveColor: savePrimaryColorAction,
          saveDomain: saveCustomDomainAction,
          verifyDomain: verifyCustomDomainAction,
          removeDomain: removeCustomDomainAction,
          setWhiteLabel: setWhiteLabelEnabledAction,
        }}
      />

      <Card>
        <CardHeader><CardTitle>How custom domains work</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Save your domain (e.g. <code>calls.yourbrand.com</code>).</p>
          <p>2. At your DNS provider add EITHER a TXT record <code>{expectedTxtValue(ctx.workspaceId)}</code> on the domain, OR a CNAME to <code>{appHost}</code>.</p>
          <p>3. Click Verify. Once verified, HTTPS on your domain is issued automatically by the platform (on-demand TLS, guide 12) — no certificate work for you.</p>
          <p>4. Flip the white-label switch: the app shell then shows your workspace name instead of Vaani AI, with your logo and color.</p>
        </CardContent>
      </Card>
    </div>
  );
}
