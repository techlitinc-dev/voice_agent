"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteSegmentAction } from "@/server/actions/crm";

export function DeleteSegmentButton({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    setBusy(true);
    const res = await deleteSegmentAction(segmentId);
    if (res.ok) {
      router.push("/crm/segments");
    } else {
      setBusy(false);
      alert(res.error ?? "Failed to delete segment.");
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setConfirming(true)}>
        Delete segment
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Delete this segment?</span>
      <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>Yes</Button>
      <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>No</Button>
    </span>
  );
}
