"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTemplateAction } from "@/server/actions/whatsapp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** WhatsApp template create form. Client component so the action's validation
 *  error (e.g. bad DLT id — CAMP-29) is surfaced on the page. */
export function TemplateCreateForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await createTemplateAction({
      name: f.get("name"),
      language: f.get("language"),
      body: f.get("body"),
      dltTemplateId: f.get("dltTemplateId") || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not create the template.");
    router.refresh();
    e.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="whatsapp-template-form">
      <div className="flex flex-wrap gap-2">
        <Input name="name" placeholder="call_followup" required className="w-56" data-testid="template-name-input" />
        <Input name="language" defaultValue="en" className="w-24" />
        <Input name="dltTemplateId" placeholder="DLT template id (India)" className="w-56" />
      </div>
      <textarea
        name="body"
        rows={3}
        required
        placeholder={"Hi {{1}}, thanks for speaking with us. Your details are confirmed."}
        className="w-full rounded-md border border-border bg-card p-2 text-sm"
        data-testid="template-body-input"
      />
      {error && <p className="text-sm text-red-400" data-testid="template-form-error">{error}</p>}
      <Button type="submit" disabled={busy} data-testid="template-create-submit">
        {busy ? "Creating…" : "Create template"}
      </Button>
    </form>
  );
}
