import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { AcceptInviteButton } from "./client";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const invite = await db.workspaceInvite.findUnique({
    where: { token: params.token },
    include: { workspace: { select: { name: true } } },
  });
  const user = await getCurrentUser();

  const invalid =
    !invite || invite.status !== "PENDING" || invite.expiresAt < new Date();

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Workspace invite</CardTitle></CardHeader>
        <CardContent>
          {invalid ? (
            <p data-testid="invite-invalid" className="text-sm text-red-400">
              This invite is invalid, revoked, or expired. Ask your admin for a new one.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm" data-testid="invite-details">
                You have been invited to join{" "}
                <span className="font-semibold">{invite.workspace.name}</span> as{" "}
                <span className="font-semibold">{invite.role}</span> ({invite.email}).
              </p>
              {user ? (
                <AcceptInviteButton token={params.token} />
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">Sign in with {invite.email} to accept.</p>
                  <Link href={`/login?next=/invite/${params.token}`}>
                    <Button data-testid="invite-login-link" className="w-full">Sign in to accept</Button>
                  </Link>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
