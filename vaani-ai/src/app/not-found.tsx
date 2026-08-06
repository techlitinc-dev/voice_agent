import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-bold text-primary">404</p>
      <p className="text-muted-foreground">This page hung up on us.</p>
      <Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>
    </main>
  );
}
