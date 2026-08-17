"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPasswordAction } from "@/server/actions/password-reset";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function ResetPasswordForm() {
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) {
      setLoading(false);
      return setError("Passwords do not match.");
    }
    const res = await resetPasswordAction({
      token: search.get("token") ?? "",
      password,
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Could not reset your password.");
    // navigate() avoids the router.push + refresh() race that can stall the
    // transition in Next 14 — we want a hard, reliable move to /login.
    window.location.href = "/login?reset=1";
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            Choose a new <span className="text-primary">password</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!search.get("token") ? (
            <p data-testid="reset-password-invalid" className="text-sm text-red-400">
              This reset link is invalid or has expired.
            </p>
          ) : (
            <form data-testid="reset-password-form" onSubmit={onSubmit} className="space-y-4">
              <Input
                data-testid="reset-password-input"
                name="password"
                type="password"
                placeholder={`New password (${PASSWORD_MIN_LENGTH}+ chars)`}
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
              <Input
                data-testid="reset-password-confirm-input"
                name="confirm"
                type="password"
                placeholder="Confirm new password"
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
              {error && <p data-testid="reset-password-error" className="text-sm text-red-400">{error}</p>}
              <Button data-testid="reset-password-submit" className="w-full" disabled={loading}>
                {loading ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
