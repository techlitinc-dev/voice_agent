import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { TotpManager } from "./client";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }
  const totp = await db.totpSecret.findUnique({ where: { userId: user.id } });
  const remainingBackupCodes = totp?.status === "ENABLED"
    ? await db.backupCode.count({ where: { userId: user.id, usedAt: null } })
    : 0;

  return (
    <Card>
      <CardHeader><CardTitle>Two-factor authentication (TOTP)</CardTitle></CardHeader>
      <CardContent>
        <p data-testid="totp-status" className="mb-4 text-sm">
          Status:{" "}
          <span className="font-semibold">
            {totp?.status === "ENABLED" ? `Enabled (${remainingBackupCodes} backup codes left)` : "Disabled"}
          </span>
        </p>
        <TotpManager enabled={totp?.status === "ENABLED"} />
      </CardContent>
    </Card>
  );
}
