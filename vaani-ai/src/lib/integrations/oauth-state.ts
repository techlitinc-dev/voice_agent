import { createHmac, timingSafeEqual } from "crypto";

/** OAuth state = `${workspaceId}.${hmac}` — proves the callback belongs to this tenant. */
export function signOAuthState(workspaceId: string): string {
  const sig = createHmac("sha256", process.env.SESSION_SECRET ?? "dev").update(workspaceId).digest("hex");
  return `${workspaceId}.${sig}`;
}

export function verifyOAuthState(state: string): string | null {
  const [workspaceId, sig] = state.split(".");
  if (!workspaceId || !sig) return null;
  const expected = signOAuthState(workspaceId).split(".")[1];
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? workspaceId : null;
}
