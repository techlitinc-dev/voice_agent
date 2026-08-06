"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        The team has been notified via server logs. Try again — if it persists, check the status page.
      </p>
      <Button onClick={reset}>Retry</Button>
    </div>
  );
}
