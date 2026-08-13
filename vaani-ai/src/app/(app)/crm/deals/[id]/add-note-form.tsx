"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDealNoteAction } from "@/server/actions/crm";
import { Plus } from "lucide-react";

export function AddNoteForm({ dealId, canWrite }: { dealId: string; canWrite: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    const res = await addDealNoteAction(dealId, body.trim());
    if (res.ok) {
      setBody("");
      router.refresh();
    } else {
      setError(res.error ?? "Failed to add note.");
    }
  }

  if (!canWrite) return null;

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        className="h-8 w-48 text-xs"
        data-testid="note-input"
      />
      <Button type="submit" size="sm" variant="outline" data-testid="add-note-button"><Plus className="h-3 w-3" /></Button>
    </form>
  );
}
