"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction, verifyLoginTotpAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const GOOGLE_SSO = process.env.NEXT_PUBLIC_GOOGLE_SSO_ENABLED === "true";
const OIDC_SSO = process.env.NEXT_PUBLIC_OIDC_SSO_ENABLED === "true";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(
    search.get("error") === "sso" ? "SSO sign-in failed. Try again or use your password." : null
  );
  const [resetDone] = useState(search.get("reset") === "1");
  const [loading, setLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [useBackupCode, setUseBackupCode] = useState(false);

  function afterSuccess() {
    router.push(search.get("next") ?? "/dashboard");
    router.refresh();
  }

  async function onSubmitPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await loginAction({
      email: form.get("email"),
      password: form.get("password"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Login failed.");
    if (res.requiresTotp && res.pendingToken) return setPendingToken(res.pendingToken);
    afterSuccess();
  }

  async function onSubmitTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await verifyLoginTotpAction({
      pendingToken,
      code: form.get("code"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Invalid code.");
    afterSuccess();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            Sign in to <span className="text-primary">Vaani AI</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingToken === null ? (
            <>
              <form data-testid="login-form" onSubmit={onSubmitPassword} className="space-y-4">
                <Input data-testid="login-email-input" name="email" type="email" placeholder="you@business.com" required />
                <div>
                  <Input data-testid="login-password-input" name="password" type="password" placeholder="Password" required />
                  <div className="mt-1 text-right">
                    <Link href="/forgot-password" data-testid="login-forgot-link" className="text-xs text-primary hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                </div>
                {resetDone && (
                  <p data-testid="login-reset-banner" className="text-sm text-green-400">
                    Password updated — sign in with your new password.
                  </p>
                )}
                {error && <p data-testid="login-error" className="text-sm text-red-400">{error}</p>}
                <Button data-testid="login-submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </form>
              {(GOOGLE_SSO || OIDC_SSO) && (
                <div className="mt-4 space-y-2">
                  <div className="text-center text-xs text-muted-foreground">or continue with</div>
                  {GOOGLE_SSO && (
                    <a data-testid="login-google-button" href="/api/auth/google/start">
                      <Button variant="outline" className="w-full" type="button">Google</Button>
                    </a>
                  )}
                  {OIDC_SSO && (
                    <a data-testid="login-oidc-button" href="/api/auth/oidc/start">
                      <Button variant="outline" className="w-full" type="button">Enterprise SSO</Button>
                    </a>
                  )}
                </div>
              )}
              <p className="mt-4 text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link href="/register" className="text-primary hover:underline">
                  Start free trial
                </Link>
              </p>
            </>
          ) : (
            <form data-testid="login-totp-form" onSubmit={onSubmitTotp} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {useBackupCode
                  ? "Enter one of your backup codes."
                  : "Enter the 6-digit code from your authenticator app."}
              </p>
              {useBackupCode ? (
                <Input
                  data-testid="login-totp-input"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="xxxx-xxxx"
                  required
                />
              ) : (
                <div className="flex justify-center">
                  <InputOTP
                    data-testid="login-totp-input"
                    name="code"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                    render={({ slots }) => (
                      <InputOTPGroup>
                        {slots.map((slot, i) => (
                          <InputOTPSlot key={i} index={i} />
                        ))}
                      </InputOTPGroup>
                    )}
                  />
                </div>
              )}
              {error && <p data-testid="login-error" className="text-sm text-red-400">{error}</p>}
              <Button data-testid="login-totp-submit" className="w-full" disabled={loading}>
                {loading ? "Verifying…" : "Verify"}
              </Button>
              <button
                data-testid="login-backup-code-toggle"
                type="button"
                className="w-full text-center text-sm text-primary hover:underline"
                onClick={() => setUseBackupCode((v) => !v)}
              >
                {useBackupCode ? "Use authenticator code instead" : "Use a backup code instead"}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
