"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteDealAction } from "@/server/actions/crm";

export function DeleteDealButton({ dealId, title }: { dealId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    setBusy(true);
    const res = await deleteDealAction(dealId);
    if (res.ok) {
      router.push("/crm/pipeline");
    } else {
      setBusy(false);
      alert(res.error ?? "Failed to delete deal.");
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Delete “{title.slice(0, 24)}”?</span>
      <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>Yes</Button>
      <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>No</Button>
    </span>
  );
}
