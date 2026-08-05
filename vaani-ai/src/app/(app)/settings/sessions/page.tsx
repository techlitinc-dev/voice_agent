import { getCurrentSession, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { RevokeAllButton, RevokeSessionButton } from "./client";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }
  const current = await getCurrentSession();
  const sessions = await db.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Your active sessions</CardTitle>
          <RevokeAllButton />
        </div>
      </CardHeader>
      <CardContent>
        <table data-testid="sessions-table" className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Device</th>
              <th className="py-2 pr-4">IP</th>
              <th className="py-2 pr-4">Last seen</th>
              <th className="py-2 pr-4" />
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} data-testid="session-row" className="border-b">
                <td className="py-2 pr-4">{s.deviceName ?? "Unknown device"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{s.ipAddress ?? "—"}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {s.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="py-2 pr-4">
                  {current?.id === s.id && (
                    <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">this device</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {current?.id !== s.id && <RevokeSessionButton sessionId={s.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
