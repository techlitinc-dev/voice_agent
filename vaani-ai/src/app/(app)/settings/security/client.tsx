"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmTotpEnrollmentAction,
  disableTotpAction,
  startTotpEnrollmentAction,
} from "@/server/actions/totp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TotpManager({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enroll, setEnroll] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  async function onStart() {
    setLoading(true);
    setError(null);
    const res = await startTotpEnrollmentAction();
    setLoading(false);
    if (!res.ok || !res.secret || !res.qrDataUrl) return setError(res.error ?? "Failed to start.");
    setEnroll({ secret: res.secret, qrDataUrl: res.qrDataUrl });
  }

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const code = new FormData(e.currentTarget).get("code");
    const res = await confirmTotpEnrollmentAction({ code });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setBackupCodes(res.backupCodes ?? []);
    setEnroll(null);
    router.refresh();
  }

  async function onDisable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const password = new FormData(e.currentTarget).get("password");
    const res = await disableTotpAction({ password });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    router.refresh();
  }

  if (backupCodes) {
    return (
      <div data-testid="totp-backup-codes" className="space-y-3">
        <p className="text-sm font-medium text-amber-400">
          Save these backup codes NOW — they are shown only once. Each works once.
        </p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-3">
          {backupCodes.map((c) => (
            <li key={c} className="rounded bg-muted px-2 py-1">{c}</li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => setBackupCodes(null)}>Done</Button>
      </div>
    );
  }

  if (enroll) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Scan with your authenticator app (Google Authenticator, Authy, 1Password…):
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img data-testid="totp-qr" src={enroll.qrDataUrl} alt="TOTP QR code" className="h-44 w-44 rounded-md bg-white p-2" />
        <p className="text-sm">
          Or enter manually: <code data-testid="totp-secret" className="rounded bg-muted px-2 py-1 text-xs">{enroll.secret}</code>
        </p>
        <form onSubmit={onConfirm} className="flex items-end gap-2">
          <Input
            data-testid="totp-confirm-input"
            name="code"
            inputMode="numeric"
            placeholder="123456"
            maxLength={6}
            required
            className="w-32"
          />
          <Button data-testid="totp-confirm-submit" disabled={loading}>
            {loading ? "Verifying…" : "Confirm & enable"}
          </Button>
        </form>
        {error && <p data-testid="totp-error" className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  if (enabled) {
    return (
      <form onSubmit={onDisable} className="flex items-end gap-2">
        <Input
          data-testid="totp-disable-password"
          name="password"
          type="password"
          placeholder="Confirm with password"
          required
          className="w-56"
        />
        <Button data-testid="totp-disable-button" variant="destructive" disabled={loading}>
          {loading ? "Disabling…" : "Disable 2FA"}
        </Button>
        {error && <p data-testid="totp-error" className="text-sm text-red-400">{error}</p>}
      </form>
    );
  }

  return (
    <div>
      <Button data-testid="totp-enroll-start" onClick={onStart} disabled={loading}>
        {loading ? "Preparing…" : "Enable 2FA"}
      </Button>
      {error && <p data-testid="totp-error" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
