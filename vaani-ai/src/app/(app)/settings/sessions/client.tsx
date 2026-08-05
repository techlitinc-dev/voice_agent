"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/server/actions/sessions";
import { Button } from "@/components/ui/button";

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onRevoke() {
    setError(null);
    const res = await revokeSessionAction({ sessionId });
    if (!res.ok) return setError(res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <span>
      <Button data-testid="session-revoke-button" variant="outline" size="sm" onClick={onRevoke}>
        Revoke
      </Button>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function RevokeAllButton() {
  const router = useRouter();
  async function onRevokeAll() {
    await revokeOtherSessionsAction();
    router.refresh();
  }
  return (
    <Button data-testid="sessions-revoke-all" variant="destructive" size="sm" onClick={onRevokeAll}>
      Log out all other devices
    </Button>
  );
}
