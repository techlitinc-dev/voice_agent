/**
 * Custom-domain verification for white-label workspaces (readme §3.1).
 * The resolver is INJECTED so unit tests never touch the network; production code
 * passes node:dns/promises (see src/server/actions/branding.ts).
 *
 * A workspace proves ownership of `app.theirbrand.com` by EITHER:
 *  - TXT record on the domain:  vaani-verification=<workspaceId>   (preferred), OR
 *  - CNAME record pointing at our app host (e.g. app.vaani.ai).
 * On success the server action sets Workspace.customDomainVerifiedAt; guide 12's
 * Caddy on-demand TLS "ask" endpoint (/api/domain-ask) only approves verified domains.
 */

export const VERIFICATION_TXT_PREFIX = "vaani-verification=";

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
}

export function expectedTxtValue(workspaceId: string): string {
  return `${VERIFICATION_TXT_PREFIX}${workspaceId}`;
}

/** Lowercase, strip protocol/path/trailing dot. Returns null when invalid. */
export function normalizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
    return null;
  }
  return d;
}

export type VerifyResult = {
  ok: boolean;
  method?: "txt" | "cname";
  error?: string;
  found?: string[];
};

export async function verifyDomainOwnership(args: {
  domain: string;
  workspaceId: string;
  appHost: string; // e.g. "app.vaani.ai" — CNAME target
  resolver: DnsResolver;
}): Promise<VerifyResult> {
  const { domain, workspaceId, appHost, resolver } = args;
  const expected = expectedTxtValue(workspaceId);

  // 1. TXT check
  try {
    const records = await resolver.resolveTxt(domain);
    const flat = records.map((chunks) => chunks.join(""));
    if (flat.includes(expected)) {
      return { ok: true, method: "txt", found: flat };
    }
  } catch {
    // ENOTFOUND / ENODATA — fall through to CNAME
  }

  // 2. CNAME check
  try {
    const cnames = await resolver.resolveCname(domain);
    const target = appHost.replace(/\.$/, "").toLowerCase();
    const match = cnames.some((c) => c.replace(/\.$/, "").toLowerCase() === target);
    if (match) return { ok: true, method: "cname", found: cnames };
    return {
      ok: false,
      error: `CNAME points at ${cnames[0] ?? "nothing"} — expected ${appHost}, or add TXT "${expected}".`,
      found: cnames,
    };
  } catch {
    return {
      ok: false,
      error: `No verification record found. Add TXT "${expected}" or a CNAME to ${appHost} on ${domain}, then retry.`,
    };
  }
}
