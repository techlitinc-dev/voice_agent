"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registerAction } from "@/server/actions/auth";
import { PASSWORD_RULE, PASSWORD_MIN_LENGTH } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Client mirror of the server registerSchema — keeps the form snappy and gives
// the visible per-field errors the manual test plan expects (AUTH-03/04).
function validateField(name: string, value: string): string | null {
  if (name === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address.";
  }
  if (name === "password") {
    if (value.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (!PASSWORD_RULE.test(value)) {
      return "Password needs an uppercase, a lowercase, a number and a special character.";
    }
  }
  return null;
}

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const fullName = String(form.get("fullName") ?? "");
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const businessName = String(form.get("businessName") ?? "");

    // Client-side gate (AUTH-03/04): invalid email / weak password blocks submit.
    const errors: { email?: string; password?: string } = {};
    const emailErr = validateField("email", email);
    const passErr = validateField("password", password);
    if (emailErr) errors.email = emailErr;
    if (passErr) errors.password = passErr;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    const res = await registerAction({
      fullName,
      email,
      password,
      businessName,
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Registration failed.");
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            Create your <span className="text-primary">Vaani AI</span> workspace
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            ₹1,000 free call credit. No card required.
          </p>
        </CardHeader>
        <CardContent>
          <form data-testid="register-form" onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <Input data-testid="register-name-input" name="fullName" placeholder="Your name" required />
            </div>
            <div>
              <Input data-testid="register-business-input" name="businessName" placeholder="Business name (e.g. Sharma Dental)" required />
            </div>
            <div>
              <Input data-testid="register-email-input" name="email" type="email" placeholder="you@business.com" required />
              {fieldErrors.email && (
                <p data-testid="register-email-error" className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>
              )}
            </div>
            <div>
              <Input data-testid="register-password-input" name="password" type="password" placeholder={`Password (${PASSWORD_MIN_LENGTH}+ chars)`} required minLength={PASSWORD_MIN_LENGTH} />
              {fieldErrors.password && (
                <p data-testid="register-password-error" className="mt-1 text-xs text-red-400">{fieldErrors.password}</p>
              )}
            </div>
            {error && <p data-testid="register-error" className="text-sm text-red-400">{error}</p>}
            <Button data-testid="register-submit" className="w-full" disabled={loading}>
              {loading ? "Creating…" : "Create workspace"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already registered?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
