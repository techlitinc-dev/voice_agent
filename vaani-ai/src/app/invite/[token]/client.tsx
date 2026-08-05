"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/server/actions/invites";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onAccept() {
    setLoading(true);
    setError(null);
    const res = await acceptInviteAction({ token });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed to accept invite.");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <Button data-testid="invite-accept-button" className="w-full" onClick={onAccept} disabled={loading}>
        {loading ? "Joining…" : "Accept invite"}
      </Button>
      {error && <p data-testid="invite-accept-error" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
