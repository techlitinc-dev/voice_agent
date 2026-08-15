"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export const AGENTS_PER_PAGE = 12;

/**
 * Search + status filter for the agent list (AGENT-06/07). Submits via URL
 * searchParams so the server page does the filtering/pagination — no client
 * state to drift from the DB.
 */
export function AgentListFilters({
  initialQ,
  initialStatus,
}: {
  initialQ: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState(initialStatus || "ALL");

  function apply(nextQ = q, nextStatus = status) {
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextStatus && nextStatus !== "ALL") params.set("status", nextStatus);
    router.push(`/agents${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="agents-filters">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        placeholder="Search agents by name…"
        className="max-w-xs"
        data-testid="agents-search-input"
      />
      <select
        value={status}
        onChange={(e) => {
          const s = e.target.value;
          setStatus(s);
          apply(q, s);
        }}
        className="h-9 rounded-md border border-border bg-card px-3 text-sm"
        data-testid="agents-status-filter"
      >
        <option value="ALL">All statuses</option>
        <option value="DRAFT">Draft</option>
        <option value="PUBLISHED">Published</option>
        <option value="ARCHIVED">Archived</option>
      </select>
      <button
        type="button"
        onClick={() => {
          setQ("");
          setStatus("ALL");
          apply("", "ALL");
        }}
        className="text-sm text-muted-foreground hover:text-foreground"
        data-testid="agents-filter-clear"
      >
        Clear
      </button>
    </div>
  );
}
