"use client";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    const openFromEvent = () => setCmdOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("vaani:open-command", openFromEvent);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("vaani:open-command", openFromEvent);
    };
  }, []);

  return (
    <>
      {children}
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}
