"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  removeMemberAction,
  updateMemberPermissionsAction,
  updateMemberRoleAction,
} from "@/server/actions/members";
import { createInviteAction, revokeInviteAction } from "@/server/actions/invites";
import { PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const ROLES = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;

export function MemberRoleSelect({ membershipId, role }: { membershipId: string; role: string }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: string) {
    setValue(next);
    setError(null);
    const res = await updateMemberRoleAction({ membershipId, role: next });
    if (!res.ok) {
      setError(res.error ?? "Failed.");
      setValue(role);
    }
    router.refresh();
  }

  return (
    <span>
      <Select
        data-testid="member-role-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-32"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </Select>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function MemberPermissionsEditor({
  membershipId,
  granted,
  revoked,
}: {
  membershipId: string;
  granted: string[];
  revoked: string[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function initial(key: string): string {
    if (granted.includes(key)) return "grant";
    if (revoked.includes(key)) return "revoke";
    return "default";
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(e.currentTarget);
    const grantedPermissions: string[] = [];
    const revokedPermissions: string[] = [];
    for (const key of PERMISSIONS) {
      const v = form.get(`perm:${key}`);
      if (v === "grant") grantedPermissions.push(key);
      if (v === "revoke") revokedPermissions.push(key);
    }
    const res = await updateMemberPermissionsAction({ membershipId, grantedPermissions, revokedPermissions });
    setSaving(false);
    setMessage(res.ok ? "Saved." : res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <details>
      <summary data-testid="member-permissions-toggle" className="cursor-pointer text-primary hover:underline">
        Edit overrides
      </summary>
      <form onSubmit={onSave} className="mt-2 space-y-1 rounded-md border border-border p-3">
        <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {PERMISSIONS.map((key) => (
            <label key={key} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono">{key}</span>
              <Select name={`perm:${key}`} defaultValue={initial(key)} className="h-7 w-24 text-xs">
                <option value="default">default</option>
                <option value="grant">grant</option>
                <option value="revoke">revoke</option>
              </Select>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button data-testid="member-overrides-save" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save overrides"}
          </Button>
          {message && <span className="text-xs text-muted-foreground">{message}</span>}
        </div>
      </form>
    </details>
  );
}

export function MemberRemoveButton({ membershipId }: { membershipId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onRemove() {
    setError(null);
    const res = await removeMemberAction({ membershipId });
    if (!res.ok) return setError(res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <span>
      <Button data-testid="member-remove-button" variant="destructive" size="sm" onClick={onRemove}>
        Remove
      </Button>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function InviteForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInviteUrl(null);
    const form = new FormData(e.currentTarget);
    const res = await createInviteAction({
      email: form.get("email"),
      role: form.get("role"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setInviteUrl(res.inviteUrl ?? null);
    router.refresh();
  }

  return (
    <div>
      <form data-testid="invite-form" onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <Input data-testid="invite-email-input" name="email" type="email" placeholder="teammate@business.com" required className="w-64" />
        <Select data-testid="invite-role-select" name="role" defaultValue="AGENT" className="w-36">
          <option value="ADMIN">ADMIN</option>
          <option value="MANAGER">MANAGER</option>
          <option value="AGENT">AGENT</option>
          <option value="VIEWER">VIEWER</option>
        </Select>
        <Button data-testid="invite-submit" disabled={loading}>
          {loading ? "Creating…" : "Create invite link"}
        </Button>
      </form>
      {error && <p data-testid="invite-error" className="mt-2 text-sm text-red-400">{error}</p>}
      {inviteUrl && (
        <p className="mt-3 text-sm">
          Share this link (email delivery arrives in a later guide):{" "}
          <code data-testid="invite-created-link" className="rounded bg-muted px-2 py-1 text-xs">{inviteUrl}</code>
        </p>
      )}
    </div>
  );
}

export function InviteRevokeButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  async function onRevoke() {
    await revokeInviteAction({ inviteId });
    router.refresh();
  }
  return (
    <Button data-testid="invite-revoke-button" variant="outline" size="sm" onClick={onRevoke}>
      Revoke
    </Button>
  );
}
