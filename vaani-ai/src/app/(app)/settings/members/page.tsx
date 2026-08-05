import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InviteForm,
  InviteRevokeButton,
  MemberPermissionsEditor,
  MemberRemoveButton,
  MemberRoleSelect,
} from "./client";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  let ctx;
  try {
    ctx = await requirePermission("users:read");
  } catch {
    return (
      <p data-testid="members-forbidden" className="text-sm text-red-400">
        You do not have permission to view members.
      </p>
    );
  }

  const memberships = await db.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invites = await db.workspaceInvite.findMany({
    where: { workspaceId: ctx.workspaceId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const canWrite = ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN";

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader><CardTitle>Members</CardTitle></CardHeader>
        <CardContent>
          <table data-testid="members-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Permission overrides</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id} data-testid="member-row" className="border-b align-top">
                  <td className="py-2 pr-4">{m.user.fullName}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{m.user.email}</td>
                  <td className="py-2 pr-4">
                    {canWrite && m.user.id !== ctx.user.id ? (
                      <MemberRoleSelect membershipId={m.id} role={m.role} />
                    ) : (
                      <span>{m.role}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {canWrite && m.role !== "OWNER" ? (
                      <MemberPermissionsEditor
                        membershipId={m.id}
                        granted={m.grantedPermissions}
                        revoked={m.revokedPermissions}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {canWrite && m.user.id !== ctx.user.id && (
                      <MemberRemoveButton membershipId={m.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader><CardTitle>Invite a teammate</CardTitle></CardHeader>
          <CardContent>
            <InviteForm />
            {invites.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-medium">Pending invites</h3>
                <table data-testid="invites-table" className="w-full text-sm">
                  <tbody>
                    {invites.map((inv) => (
                      <tr key={inv.id} className="border-b">
                        <td className="py-2 pr-4">{inv.email}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{inv.role}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          expires {inv.expiresAt.toISOString().slice(0, 10)}
                        </td>
                        <td className="py-2 pr-4">
                          <code data-testid="invite-link" className="block max-w-xs truncate rounded bg-muted px-2 py-1 text-xs">
                            {`${baseUrl}/invite/${inv.token}`}
                          </code>
                        </td>
                        <td className="py-2 text-right">
                          <InviteRevokeButton inviteId={inv.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
