# 03 — Forms & Input Patterns

> **Goal:** Consistent, validated, accessible forms across the app using
> react-hook-form + Zod + the shadcn Form component.

---

## 1. Setup

```bash
npm install react-hook-form @hookform/resolvers
```

The shadcn `Form` component wraps `react-hook-form` with consistent error display.

---

## 2. Standard Form Pattern

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  valuePaise: z.coerce.number().int().min(0, "Value must be positive"),
  pipelineId: z.string().min(1, "Select a pipeline"),
  stageId: z.string().min(1, "Select a stage"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  expectedClose: z.string().optional(),
});

type DealFormValues = z.infer<typeof schema>;

export function DealForm({ pipelines, stages, onSubmit }: DealFormProps) {
  const form = useForm<DealFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", valuePaise: 0, priority: "medium" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="title" render={({ field }) => (
          <FormItem>
            <FormLabel>Deal Title *</FormLabel>
            <FormControl><Input placeholder="Home loan — Ramesh" {...field} /></FormControl>
            <FormDescription>A short, descriptive title for this deal.</FormDescription>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="valuePaise" render={({ field }) => (
          <FormItem>
            <FormLabel>Value (₹) *</FormLabel>
            <FormControl>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground">₹</span>
                <Input type="number" className="pl-7" placeholder="2500000" {...field} />
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="pipelineId" render={({ field }) => (
            <FormItem>
              <FormLabel>Pipeline *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
                <SelectContent>
                  {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="priority" render={({ field }) => (
            <FormItem>
              <FormLabel>Priority</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )} />
        </div>

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving..." : "Create Deal"}
        </Button>
      </form>
    </Form>
  );
}
```

---

## 3. Input Variants

### 3.1 Money input (INR)

```tsx
// src/components/ui/money-input.tsx
export function MoneyInput({ value, onChange, ...props }: MoneyInputProps) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">₹</span>
      <Input
        type="number"
        className="pl-7"
        value={value ? (value / 100) : ""} // paise to rupees for display
        onChange={(e) => onChange(Math.round(parseFloat(e.target.value || "0") * 100))} // rupees to paise
        {...props}
      />
    </div>
  );
}
```

### 3.2 Phone input (E.164)

```tsx
// src/components/ui/phone-input.tsx
export function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex">
      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-muted text-sm">+91</span>
      <Input
        className="rounded-l-none"
        value={value.replace("+91", "")}
        onChange={(e) => onChange("+91" + e.target.value.replace(/\D/g, ""))}
        maxLength={10}
        placeholder="98XXXXXXXX"
      />
    </div>
  );
}
```

### 3.3 OTP input (2FA)

```tsx
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

<InputOTP maxLength={6} value={otp} onChange={setOtp}>
  <InputOTPGroup>
    <InputOTPSlot index={0} /><InputOTPSlot index={1} /><InputOTPSlot index={2} />
  </InputOTPGroup>
  <InputOTPSeparator />
  <InputOTPGroup>
    <InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} />
  </InputOTPGroup>
</InputOTP>
```

---

## 4. File Upload (Dropzone)

```tsx
// src/components/ui/dropzone.tsx
"use client";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud } from "lucide-react";

export function Dropzone({ onUpload, accept, maxSize }: DropzoneProps) {
  const onDrop = useCallback((files: File[]) => { onUpload(files[0]); }, [onUpload]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxSize });

  return (
    <div {...getRootProps()} className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30"}`}>
      <input {...getInputProps()} />
      <UploadCloud className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm">{isDragActive ? "Drop the file here..." : "Drag and drop or click to upload"}</p>
      <p className="text-xs text-muted-foreground mt-1">PDF, DOCX up to 10 MB</p>
    </div>
  );
}
```

---

## 5. Toasts (Sonner)

```tsx
// src/app/layout.tsx (add once at root)
import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
```

Usage in any component:

```tsx
import { toast } from "sonner";

toast.success("Deal created successfully");
toast.error("Failed to create deal", { description: "You don't have permission." });
toast.promise(saveDeal(), { loading: "Saving...", success: "Deal created!", error: "Failed" });
```

---

## Next

→ [04 — Navigation & Overlays](04-navigation-and-overlays.md)