"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

type Result = { ok: boolean; error?: string };

type Actions = {
  uploadLogo: (formData: FormData) => Promise<Result>;
  removeLogo: () => Promise<Result>;
  saveColor: (input: { primaryColor: string }) => Promise<Result>;
  saveDomain: (input: { domain: string }) => Promise<Result>;
  verifyDomain: () => Promise<Result>;
  removeDomain: () => Promise<Result>;
  setWhiteLabel: (enabled: boolean) => Promise<Result>;
};

export function BrandingForms(props: {
  hasLogo: boolean;
  primaryColor: string;
  customDomain: string;
  domainVerified: boolean;
  whiteLabelEnabled: boolean;
  whiteLabelAllowed: boolean;
  verificationTxt: string;
  appHost: string;
  actions: Actions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [color, setColor] = useState(props.primaryColor || "#14b8a6");
  const [domain, setDomain] = useState(props.customDomain);

  async function run(label: string, fn: () => Promise<Result>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    setNotice(`${label} — done.`);
    router.refresh();
  }

  return (
    <>
      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400" data-testid="branding-error">{error}</p>}
      {notice && <p className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400" data-testid="branding-notice">{notice}</p>}

      <Card>
        <CardHeader><CardTitle>Logo</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {props.hasLogo && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/branding/logo" alt="workspace logo" className="h-12 w-12 rounded border object-contain" data-testid="branding-logo-preview" />
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => run("Logo removed", props.actions.removeLogo)} data-testid="branding-logo-remove">
                Remove
              </Button>
            </div>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            data-testid="branding-logo-form"
            action={(formData) => run("Logo uploaded", () => props.actions.uploadLogo(formData))}
          >
            <Tooltip label="PNG/JPG/WEBP/SVG up to 512 KB. Square logos look best." testid="tooltip-branding-logo">
              <input type="file" name="file" required accept=".png,.jpg,.jpeg,.webp,.svg" data-testid="branding-logo-input"
                className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm" />
            </Tooltip>
            <Button type="submit" variant="outline" disabled={busy !== null} data-testid="branding-logo-upload">
              {busy === "Logo uploaded" ? "Uploading…" : "Upload"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Brand color</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              data-testid="branding-color-picker"
              className="h-10 w-14 cursor-pointer rounded border border-border bg-card"
            />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="max-w-[120px]" data-testid="branding-color-hex" />
            <Button
              variant="outline" disabled={busy !== null}
              onClick={() => run("Color saved", () => props.actions.saveColor({ primaryColor: color }))}
              data-testid="branding-color-save"
            >
              Save color
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Applied instantly across your app shell (buttons, highlights) via the <code>--primary</code> CSS variable.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Custom domain</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {props.customDomain ? (
            <div className="space-y-2 text-sm">
              <p>
                Domain: <span className="font-semibold">{props.customDomain}</span>{" "}
                <span
                  className={props.domainVerified ? "text-green-400" : "text-amber-400"}
                  data-testid="branding-domain-status"
                >
                  {props.domainVerified ? "verified ✓" : "not verified"}
                </span>
              </p>
              {!props.domainVerified && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="branding-dns-instructions">
                  <p>Add ONE of these DNS records at your DNS provider, then click Verify:</p>
                  <p className="mt-1">• TXT <code>{props.verificationTxt}</code> on <code>{props.customDomain}</code></p>
                  <p>• or CNAME <code>{props.customDomain}</code> → <code>{props.appHost}</code></p>
                  <p className="mt-1">DNS can take a few minutes to propagate.</p>
                </div>
              )}
              <div className="flex gap-2">
                {!props.domainVerified && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("Domain verified", props.actions.verifyDomain)} data-testid="branding-domain-verify">
                    {busy === "Domain verified" ? "Checking DNS…" : "Verify DNS"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("Domain removed", props.actions.removeDomain)} data-testid="branding-domain-remove">
                  Remove domain
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="calls.yourbrand.com"
                className="max-w-xs"
                data-testid="branding-domain-input"
                disabled={!props.whiteLabelAllowed}
              />
              <Button
                variant="outline"
                disabled={busy !== null || !domain || !props.whiteLabelAllowed}
                onClick={() => run("Domain saved", () => props.actions.saveDomain({ domain }))}
                data-testid="branding-domain-save"
              >
                Save domain
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>White-label mode</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {props.whiteLabelEnabled
              ? "ON — your workspace name, logo and color replace Vaani AI branding."
              : "Off — Vaani AI branding shows in the app shell."}
            {!props.whiteLabelAllowed && " (Enterprise plan / add-on required.)"}
          </p>
          <Button
            variant={props.whiteLabelEnabled ? "destructive" : "default"}
            size="sm"
            disabled={busy !== null || !props.whiteLabelAllowed || (!props.whiteLabelEnabled && !props.domainVerified)}
            onClick={() => run("White-label updated", () => props.actions.setWhiteLabel(!props.whiteLabelEnabled))}
            data-testid="branding-whitelabel-toggle"
            title={!props.domainVerified ? "Verify your custom domain first" : undefined}
          >
            {props.whiteLabelEnabled ? "Disable" : "Enable"}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
