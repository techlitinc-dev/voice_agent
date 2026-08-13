"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCampaignFromSegmentAction } from "@/server/actions/crm";

export function CreateCampaignButton({ segmentId, memberCount }: { segmentId: string; memberCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (memberCount === 0) {
    return <span className="text-xs text-muted-foreground">No contacts to target</span>;
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Create campaign</Button>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Campaign name is required."); return; }
    setBusy(true);
    setError(null);
    const res = await createCampaignFromSegmentAction({ segmentId, campaignName: name.trim() });
    setBusy(false);
    if (res.ok && res.dealId) {
      router.push(`/campaigns/${res.dealId}`);
      router.refresh();
    } else {
      setError(res.error ?? "Could not create the campaign.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-md border bg-card p-2" data-testid="create-campaign-form">
      <span className="text-xs text-muted-foreground">{memberCount} contacts</span>
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" className="h-8 w-44 text-xs" />
      <Button type="submit" size="sm" disabled={busy} data-testid="create-campaign-submit">{busy ? "Creating…" : "Create"}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>✕</Button>
    </form>
  );
}
