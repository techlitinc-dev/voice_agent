"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveDealStageAction, rejectDealStageAction } from "@/server/actions/crm";

export function ApprovalRowActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function decide(kind: "approve" | "reject") {
    setBusy(true);
    const res =
      kind === "approve"
        ? await approveDealStageAction(requestId, note || undefined)
        : await rejectDealStageAction(requestId, note || undefined);
    setBusy(false);
    if (res.ok) {
      toast.success(kind === "approve" ? "Approved — deal moved." : "Rejected — deal unchanged.");
      router.refresh();
    } else {
      toast.error(res.error ?? `Could not ${kind} the request.`);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        data-testid={`approval-note-${requestId}`}
        className="h-8 w-40 rounded-md border border-border bg-transparent px-2 text-xs"
      />
      <button
        onClick={() => decide("approve")}
        disabled={busy}
        data-testid={`approval-approve-${requestId}`}
        className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Approve
      </button>
      <button
        onClick={() => decide("reject")}
        disabled={busy}
        data-testid={`approval-reject-${requestId}`}
        className="rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-400 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
