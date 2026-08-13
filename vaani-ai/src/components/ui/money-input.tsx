import * as React from "react";
import { Input } from "@/components/ui/input";

interface MoneyInputProps {
  value: number; // paise
  onChange: (paise: number) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

/** INR money input — stores paise, displays rupees (docs/ui-expansion/03 §3.1). */
export function MoneyInput({ value, onChange, className, ...props }: MoneyInputProps) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">₹</span>
      <Input
        type="number"
        min={0}
        className={className ? `pl-7 ${className}` : "pl-7"}
        value={value ? value / 100 : ""}
        onChange={(e) => onChange(Math.round((parseFloat(e.target.value) || 0) * 100))}
        {...props}
      />
    </div>
  );
}
