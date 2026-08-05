export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
};

export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER_URL?.replace(/\/+$/, "");
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  if (!issuer || !clientId || !clientSecret) return null;
  return { issuer, clientId, clientSecret, redirectUri: `${baseUrl}/api/auth/oidc/callback` };
}

export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const doc = (await res.json()) as Partial<OidcDiscovery>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
    throw new Error("OIDC discovery document incomplete");
  }
  return doc as OidcDiscovery;
}

export async function exchangeOidcCode(
  cfg: OidcConfig,
  discovery: OidcDiscovery,
  code: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed: HTTP ${res.status}`);
  const tokens = (await res.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("OIDC token response missing access_token");
  return tokens.access_token;
}

export async function fetchOidcUserInfo(
  discovery: OidcDiscovery,
  accessToken: string
): Promise<{ sub: string; email?: string; name?: string }> {
  const res = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OIDC userinfo failed: HTTP ${res.status}`);
  const info = (await res.json()) as { sub?: string; email?: string; name?: string };
  if (!info.sub) throw new Error("OIDC userinfo missing sub");
  return { sub: info.sub, email: info.email, name: info.name };
}
