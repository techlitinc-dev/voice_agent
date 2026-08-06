"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

const DOC_TYPES = [
  { value: "GST", label: "GST certificate" },
  { value: "PAN", label: "PAN card" },
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "INCORPORATION", label: "Certificate of incorporation" },
  { value: "OTHER", label: "Other" },
];

export function KycForm({
  action,
}: {
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <form
      className="space-y-3"
      data-testid="kyc-form"
      action={async (formData) => {
        setBusy(true); setError(null); setDone(false);
        const res = await action(formData);
        setBusy(false);
        if (!res.ok) return setError(res.error ?? "Something went wrong.");
        setDone(true);
        router.refresh();
      }}
    >
      <select
        name="documentType"
        required
        defaultValue="GST"
        data-testid="kyc-doctype-select"
        className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
      >
        {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <Input name="documentRef" placeholder="GSTIN / PAN / Aadhaar number (optional)" data-testid="kyc-ref-input" />
      <Tooltip label="PDF, PNG or JPG up to 5 MB. Stored privately; reviewed by the operator." testid="tooltip-kyc-file">
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.png,.jpg,.jpeg"
          data-testid="kyc-file-input"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm"
        />
      </Tooltip>
      <Button type="submit" disabled={busy} data-testid="kyc-submit-btn">
        {busy ? "Uploading…" : "Submit for review"}
      </Button>
      {error && <p className="text-sm text-red-400" data-testid="kyc-error">{error}</p>}
      {done && <p className="text-sm text-green-400" data-testid="kyc-success">Submitted — status is now PENDING.</p>}
    </form>
  );
}
