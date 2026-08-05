import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  acceptTransferAction, declineTransferAction, toggleAvailabilityAction,
} from "@/server/actions/transfers";
import { canSeeTransfer, isAvailable, userSkills } from "@/lib/transfers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Snapshot = { summary?: string; transcriptTail?: string; fromNumber?: string; whisperContext?: string };

export default async function TransfersPage() {
  let ctx;
  try {
    ctx = await requireRole("AGENT");
  } catch {
    redirect("/login");
  }
  const skills = userSkills(ctx.membership.grantedPermissions);
  const available = isAvailable(ctx.membership.grantedPermissions);

  const [pending, mine] = await Promise.all([
    db.transferRequest.findMany({
      where: { workspaceId: ctx.workspaceId, status: { in: ["QUEUED", "RINGING"] } },
      include: { call: { select: { fromNumber: true, toNumber: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    db.transferRequest.findMany({
      where: { workspaceId: ctx.workspaceId, acceptedByUserId: ctx.user.id, status: "ACCEPTED" },
      orderBy: { acceptedAt: "desc" },
      take: 10,
    }),
  ]);
  const visible = pending.filter((t) => canSeeTransfer(t, skills));

  async function accept(formData: FormData) {
    "use server";
    await acceptTransferAction(String(formData.get("id")));
  }
  async function decline(formData: FormData) {
    "use server";
    await declineTransferAction(String(formData.get("id")));
  }
  async function toggle() {
    "use server";
    await toggleAvailabilityAction();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transfer Queue</h1>
          <p className="text-sm text-muted-foreground">
            Your skills: {skills.length > 0 ? skills.join(", ") : "all queues (no skill tags)"}
          </p>
        </div>
        <form action={toggle}>
          <Button type="submit" variant={available ? "default" : "outline"} data-testid="availability-toggle">
            {available ? "Available" : "Unavailable"}
          </Button>
        </form>
      </div>

      {visible.length === 0 && (
        <p className="text-muted-foreground" data-testid="transfer-empty">No pending transfers.</p>
      )}
      {visible.map((t) => {
        const snap = (t.contextSnapshot ?? {}) as Snapshot;
        return (
          <Card key={t.id} data-testid="transfer-queue-row">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{t.call.fromNumber}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs">queue: {t.queue ?? "—"}</span>
                {t.skill && <span className="rounded bg-muted px-2 py-0.5 text-xs">skill: {t.skill}</span>}
                {t.reason && <span className="rounded bg-muted px-2 py-0.5 text-xs">reason: {t.reason}</span>}
                <span className="text-xs text-muted-foreground">{t.createdAt.toLocaleString()}</span>
              </div>

              <div className="rounded border border-border bg-card p-3" data-testid="transfer-context">
                <p className="text-sm font-semibold">Context (read before accepting)</p>
                <p className="text-sm">{snap.summary ?? "No summary yet."}</p>
                {snap.whisperContext && (
                  <p className="text-xs text-amber-500">Supervisor whisper: {snap.whisperContext}</p>
                )}
                {snap.transcriptTail && (
                  <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {snap.transcriptTail}
                  </pre>
                )}
              </div>

              <div className="flex gap-2">
                <form action={accept}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" size="sm" data-testid="transfer-accept-btn">Accept</Button>
                </form>
                <form action={decline}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" size="sm" variant="outline" data-testid="transfer-decline-btn">
                    Decline
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {mine.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Accepted by you</h2>
          {mine.map((t) => (
            <p key={t.id} className="text-sm text-muted-foreground" data-testid="transfer-accepted-row">
              #{t.id.slice(-6)} · queue {t.queue ?? "—"} · accepted {t.acceptedAt?.toLocaleString()}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
