import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { DialPad } from "@/components/dial-pad";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DialerPage() {
  let ctx;
  try {
    ctx = await requireRole("AGENT");
  } catch {
    redirect("/login");
  }
  const [numbers, history] = await Promise.all([
    db.phoneNumber.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, number: true, label: true },
      orderBy: { createdAt: "asc" },
    }),
    db.call.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        direction: "OUTBOUND",
        extractedEntities: { path: ["source"], equals: "manual-dial" },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Web Dialer</h1>
      <Card>
        <CardHeader><CardTitle>Make a call</CardTitle></CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Register a number first (Numbers page) before using the dialer.
            </p>
          ) : (
            <DialPad numbers={numbers} />
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Manual call history</h2>
        {history.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="dialer-history-empty">No manual calls yet.</p>
        )}
        {history.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded border border-border p-3 text-sm"
            data-testid="dialer-history-row">
            <span className="font-mono">{c.toNumber}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">{c.status}</span>
            <span className="text-xs text-muted-foreground">
              from {c.fromNumber} · {c.createdAt.toLocaleString()} · {c.durationSec}s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
