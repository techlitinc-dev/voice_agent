"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importFromCrmAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CrmImportButton({ connections }: { connections: { id: string; provider: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(id: string) {
    setBusy(true); setMessage(null);
    const res = await importFromCrmAction(id);
    setBusy(false);
    setMessage(
      res.ok
        ? `CRM import: ${res.imported} imported, ${res.skipped} skipped (bad phone), ${res.dncSkipped} on DNC.`
        : res.error ?? "CRM import failed."
    );
    router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Import from CRM</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Pull contacts from a connected CRM (Settings → Integrations). In
          CRM_IMPORT_DRY_RUN mode this imports two fixture contacts instead of
          calling the CRM.
        </p>
        <div className="flex flex-wrap gap-2">
          {connections.map((c) => (
            <Button key={c.id} variant="outline" disabled={busy} onClick={() => run(c.id)} data-testid="crm-import-button">
              {busy ? "Importing…" : `Import from ${c.provider}`}
            </Button>
          ))}
        </div>
        {message && <p className="text-sm text-green-400" data-testid="crm-import-result">{message}</p>}
      </CardContent>
    </Card>
  );
}
