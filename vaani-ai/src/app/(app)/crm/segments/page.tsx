import { redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { fetchSegments } from "@/lib/crm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const metadata = { title: "Segments — Vaani AI" };

export default async function SegmentsPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const segments = await fetchSegments(ctx.workspaceId);

  return (
    <div className="space-y-6" data-testid="segments-page">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{segments.length} segments</h2>
        <Link href="/crm/segments/new"><Button size="sm" data-testid="new-segment-button"><Plus className="h-4 w-4" /> New segment</Button></Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {segments.map((s) => (
          <Link key={s.id} href={`/crm/segments/${s.id}`} className="block">
            <div className="rounded-lg border bg-card p-4 transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="font-medium">{s.name}</p>
                <Badge variant="secondary">{s.memberCount} members</Badge>
              </div>
              {s.description && <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {s.matchMode === "all" ? "Match ALL rules" : "Match ANY rule"} · {s.isDynamic ? "dynamic" : "static"}
              </p>
            </div>
          </Link>
        ))}
        {segments.length === 0 && (
          <p className="text-muted-foreground">No segments yet — create one to group contacts dynamically.</p>
        )}
      </div>
    </div>
  );
}
