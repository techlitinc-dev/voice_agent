"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importContactsAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CsvUploader({ campaignId }: { campaignId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("csv") as File | null;
    const listName = String(data.get("listName") ?? "");
    if (!file || file.size === 0) { setBusy(false); return setError("Choose a CSV file."); }
    if (file.size > 2 * 1024 * 1024) { setBusy(false); return setError("Max 2 MB CSV."); }
    const csvText = await file.text();
    const res = await importContactsAction({ listName, csvText, ...(campaignId ? { campaignId } : {}) });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Import failed.");
    setResult(
      `Imported ${res.imported} contacts (${res.skipped} skipped — bad phone` +
      `${res.dncSkipped ? `, ${res.dncSkipped} skipped — on DNC list` : ""}).` +
      (campaignId ? " Added to the campaign." : "")
    );
    form.reset();
    router.refresh();
  }

  return (
    <Card data-testid="contacts-upload-card">
      <CardHeader><CardTitle>{campaignId ? "Upload CSV → this campaign" : "Upload CSV"}</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Required column: <code>phone</code> (or <code>mobile</code>). Optional:{" "}
          <code>name</code>, <code>timezone</code> (IANA, e.g. Asia/Kolkata),{" "}
          <code>consent_at</code> (date or &quot;yes&quot;), <code>consent_source</code>, plus any
          extra columns (they become call personalization variables). Indian 10-digit
          mobiles auto-convert to +91. Numbers on the DNC list are skipped and counted.
        </p>
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" data-testid="contacts-upload-form">
          <Input name="listName" placeholder="List name (e.g. July leads)" className="w-56" required data-testid="list-name-input" />
          <input name="csv" type="file" accept=".csv,text/csv" required className="text-sm" data-testid="csv-file-input" />
          <Button type="submit" disabled={busy} data-testid="csv-import-submit">{busy ? "Importing…" : "Import"}</Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-400" data-testid="csv-import-error">{error}</p>}
        {result && <p className="mt-2 text-sm text-green-400" data-testid="csv-import-result">{result}</p>}
      </CardContent>
    </Card>
  );
}
