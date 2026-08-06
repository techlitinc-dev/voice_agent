"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button data-testid="invoice-print-button" variant="outline" onClick={() => window.print()}>
      Print / Save as PDF
    </Button>
  );
}
