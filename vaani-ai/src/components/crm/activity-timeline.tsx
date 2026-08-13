"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import { activityIcon, activityColor, ACTIVITY_TYPE_LABELS } from "./activity-meta";

/** Serializable activity shape (no Date objects across the RSC boundary). */
export type TimelineActivity = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  createdAt: string; // ISO
  userId: string | null;
  userName: string | null;
  callId: string | null;
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN");
}

export function ActivityTimeline({
  activities,
  showFilters = false,
}: {
  activities: TimelineActivity[];
  showFilters?: boolean;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [rangeFilter, setRangeFilter] = useState<string>(""); // 7 | 30 | 90 | ""

  const users = useMemo(() => {
    const set = new Map<string, string>();
    for (const a of activities) {
      if (a.userId && a.userName) set.set(a.userId, a.userName);
    }
    return [...set.entries()].map(([id, name]) => ({ id, name }));
  }, [activities]);

  const filtered = useMemo(() => {
    return activities
      .filter((a) => (typeFilter ? a.type === typeFilter : true))
      .filter((a) => (userFilter === "system" ? !a.userId : userFilter ? a.userId === userFilter : true))
      .filter((a) => {
        if (!rangeFilter) return true;
        const cutoff = Date.now() - Number(rangeFilter) * 24 * 60 * 60 * 1000;
        return new Date(a.createdAt).getTime() >= cutoff;
      });
  }, [activities, typeFilter, userFilter, rangeFilter]);

  const types = useMemo(() => [...new Set(activities.map((a) => a.type))].sort(), [activities]);

  return (
    <div>
      {showFilters && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-44" data-testid="timeline-type-filter">
            <option value="">Type: All</option>
            {types.map((t) => (
              <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t as keyof typeof ACTIVITY_TYPE_LABELS] ?? t}</option>
            ))}
          </Select>
          <Select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="w-40">
            <option value="">User: All</option>
            <option value="system">AI / System</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Select value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value)} className="w-36">
            <option value="">Any time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        </div>
      )}

      <div className="relative">
        <div className="absolute bottom-0 left-4 top-0 w-px bg-border" />
        <div className="space-y-1">
          {filtered.map((act) => {
            const Icon = activityIcon(act.type as never);
            return (
              <div key={act.id} className="relative flex gap-3 py-3">
                <div className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${activityColor(act.type as never)}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 border-b pb-3 last:border-0">
                  <p className="text-sm font-medium">{act.title}</p>
                  {act.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{act.description}</p>}
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{relativeTime(act.createdAt)}</span>
                    {act.userName && <span>• {act.userName}</span>}
                    {act.callId && (
                      <Link href={`/calls/${act.callId}`} className="text-primary hover:underline">
                        View call →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No activity matches the current filters.</p>
          )}
        </div>
      </div>
    </div>
  );
}
