import * as React from "react";
import { Input } from "@/components/ui/input";

interface PhoneInputProps {
  value: string; // E.164, e.g. +9198XXXXXXXX
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
}

/** Indian phone input — stores E.164 (+91), displays the 10-digit local part (docs/ui-expansion/03 §3.2). */
export function PhoneInput({ value, onChange, className, ...props }: PhoneInputProps) {
  return (
    <div className="flex">
      <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
        +91
      </span>
      <Input
        className={className ? `rounded-l-none ${className}` : "rounded-l-none"}
        value={value.replace("+91", "")}
        onChange={(e) => onChange("+91" + e.target.value.replace(/\D/g, ""))}
        maxLength={10}
        placeholder="98XXXXXXXX"
        {...props}
      />
    </div>
  );
}
