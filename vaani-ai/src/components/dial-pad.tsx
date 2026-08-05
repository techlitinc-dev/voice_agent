"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startManualCallAction } from "@/server/actions/dialer";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "#"];

export function DialPad({ numbers }: { numbers: { id: string; number: string; label: string | null }[] }) {
  const [toNumber, setToNumber] = useState("");
  const [fromId, setFromId] = useState(numbers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call() {
    setBusy(true);
    setMessage(null);
    const r = await startManualCallAction({ toNumber, fromPhoneNumberId: fromId });
    setMessage(r.ok ? `Call initiated (${r.callId?.slice(-6)}) — the worker is dialing.` : r.error ?? "Failed.");
    setBusy(false);
  }

  return (
    <div className="space-y-4" data-testid="dialer-pad">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground">From:</label>
        <select value={fromId} onChange={(e) => setFromId(e.target.value)} data-testid="dialer-from-select"
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>{n.number}{n.label ? ` (${n.label})` : ""}</option>
          ))}
        </select>
      </div>
      <Input value={toNumber} onChange={(e) => setToNumber(e.target.value)}
        placeholder="+919812345678" className="w-64 font-mono" data-testid="dialer-number-input" />
      <div className="grid w-64 grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <Button key={k} variant="outline" data-testid={`dialer-digit-${k === "+" ? "plus" : k === "#" ? "hash" : k}`}
            onClick={() => setToNumber((v) => (v + k).slice(0, 16))}>
            {k}
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" data-testid="dialer-backspace-btn"
          onClick={() => setToNumber((v) => v.slice(0, -1))}>
          ⌫
        </Button>
        <Button onClick={call} disabled={busy || !fromId} data-testid="dialer-call-btn">
          {busy ? "Dialing…" : "Call"}
        </Button>
      </div>
      {message && <p className="text-sm" data-testid="dialer-message">{message}</p>}
      <p className="text-xs text-muted-foreground">
        In-browser audio (softphone) is operator-gated on Dograh web-call support;
        v1 dials out via the campaign worker and the call events appear in Calls.
      </p>
    </div>
  );
}
