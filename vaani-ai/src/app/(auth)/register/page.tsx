"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registerAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await registerAction({
      fullName: form.get("fullName"),
      email: form.get("email"),
      password: form.get("password"),
      businessName: form.get("businessName"),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Registration failed.");
    router.push("/dashboard");
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
          <form data-testid="register-form" onSubmit={onSubmit} className="space-y-4">
            <Input data-testid="register-name-input" name="fullName" placeholder="Your name" required />
            <Input data-testid="register-business-input" name="businessName" placeholder="Business name (e.g. Sharma Dental)" required />
            <Input data-testid="register-email-input" name="email" type="email" placeholder="you@business.com" required />
            <Input data-testid="register-password-input" name="password" type="password" placeholder="Password (8+ chars)" required minLength={8} />
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
