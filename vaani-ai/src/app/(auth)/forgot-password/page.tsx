"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/server/actions/password-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await requestPasswordResetAction({ email: form.get("email") });
    setLoading(false);
    // The action always resolves the same way — show the generic confirmation.
    setSent(true);
    if (!res.ok) setError(res.error ?? "Something went wrong. Please try again.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            Reset your <span className="text-primary">Vaani AI</span> password
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter the email you signed up with and we&apos;ll send you a reset link.
          </p>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p data-testid="forgot-password-sent" className="text-sm text-green-400">
              If an account exists for that email, we&apos;ve sent a reset link.
            </p>
          ) : (
            <form data-testid="forgot-password-form" onSubmit={onSubmit} className="space-y-4">
              <Input
                data-testid="forgot-password-email-input"
                name="email"
                type="email"
                placeholder="you@business.com"
                required
              />
              {error && <p data-testid="forgot-password-error" className="text-sm text-red-400">{error}</p>}
              <Button data-testid="forgot-password-submit" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
