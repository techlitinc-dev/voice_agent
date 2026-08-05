import { requireWorkspace } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveTiles } from "./live-tiles";

export default async function DashboardPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const workspace = await db.workspace.findUnique({ where: { id: ctx.workspaceId } });
  const wallet = await db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{workspace?.name}</h1>
        <div className="flex gap-2">
          <Link href="/settings/members">
            <Button variant="outline" size="sm">Settings</Button>
          </Link>
          <form action={logoutAction}>
            <Button data-testid="logout-button" variant="outline" size="sm">Sign out</Button>
          </form>
        </div>
      </div>
      <LiveTiles />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Wallet balance</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-primary">
            {formatINR(wallet?.balancePaise ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Signed in as</CardTitle></CardHeader>
          <CardContent>
            <p>{ctx.user.fullName}</p>
            <p className="text-sm text-muted-foreground">{ctx.user.email} · {ctx.membership.role}</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
