"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createApiKeyAction, revokeApiKeyAction } from "@/server/actions/apikeys";
import { PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ApiKeyCreateForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCreatedKey(null);
    const form = new FormData(e.currentTarget);
    const scopes = PERMISSIONS.filter((p) => form.get(`scope:${p}`) === "on");
    const ipAllowlist = String(form.get("ipAllowlist") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await createApiKeyAction({
      name: form.get("name"),
      scopes,
      ipAllowlist,
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setCreatedKey(res.apiKey ?? null);
    router.refresh();
  }

  if (createdKey) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-amber-400">
          Copy this key NOW — it is shown only once and never stored in plain text.
        </p>
        <code data-testid="apikey-created-value" className="block break-all rounded bg-muted px-3 py-2 font-mono text-sm">
          {createdKey}
        </code>
        <Button variant="outline" size="sm" onClick={() => setCreatedKey(null)}>Done</Button>
      </div>
    );
  }

  return (
    <form data-testid="apikey-form" onSubmit={onSubmit} className="space-y-4">
      <Input data-testid="apikey-name-input" name="name" placeholder="Key name (e.g. CRM sync)" required className="w-72" />
      <div>
        <p className="mb-1 text-sm text-muted-foreground">Scopes (permission keys):</p>
        <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-3">
          {PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 font-mono text-xs">
              <input data-testid="apikey-scope-checkbox" type="checkbox" name={`scope:${p}`} /> {p}
            </label>
          ))}
        </div>
      </div>
      <Input
        data-testid="apikey-ipallowlist-input"
        name="ipAllowlist"
        placeholder="IP allowlist CIDRs, comma-separated (empty = any IP)"
        className="w-full"
      />
      {error && <p data-testid="apikey-error" className="text-sm text-red-400">{error}</p>}
      <Button data-testid="apikey-create-submit" disabled={loading}>
        {loading ? "Creating…" : "Create key"}
      </Button>
    </form>
  );
}

export function ApiKeyRevokeButton({ apiKeyId }: { apiKeyId: string }) {
  const router = useRouter();
  async function onRevoke() {
    await revokeApiKeyAction({ apiKeyId });
    router.refresh();
  }
  return (
    <Button data-testid="apikey-revoke-button" variant="destructive" size="sm" onClick={onRevoke}>
      Revoke
    </Button>
  );
}
