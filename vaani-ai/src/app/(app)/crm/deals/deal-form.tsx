"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { createDealAction, updateDealAction } from "@/server/actions/crm";

export type DealFormData = {
  title: string;
  valuePaise: number;
  pipelineId: string;
  stageId: string;
  contactId?: string;
  priority: "low" | "medium" | "high" | "urgent";
  expectedClose?: string;
  ownerUserId?: string;
};

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  valuePaise: z.coerce.number().int().min(0, "Value must be positive"),
  pipelineId: z.string().min(1, "Select a pipeline"),
  stageId: z.string().min(1, "Select a stage"),
  contactId: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  expectedClose: z.string().optional(),
  ownerUserId: z.string().optional(),
});

type DealFormValues = z.infer<typeof schema>;

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export function DealForm({
  mode,
  dealId,
  initial,
  pipelines,
  contacts,
  users,
  createPipeline,
}: {
  mode: "create" | "edit";
  dealId?: string;
  initial?: DealFormData;
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  contacts: { id: string; name: string | null; phone: string }[];
  users: { id: string; fullName: string }[];
  createPipeline?: boolean;
}) {
  const router = useRouter();
  const activePipeline = pipelines.find((p) => p.id === initial?.pipelineId);

  const form = useForm<DealFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? "",
      valuePaise: initial?.valuePaise ?? 0,
      pipelineId: initial?.pipelineId ?? pipelines[0]?.id ?? "",
      stageId: initial?.stageId ?? activePipeline?.stages[0]?.id ?? pipelines[0]?.stages[0]?.id ?? "",
      contactId: initial?.contactId ?? "",
      priority: initial?.priority ?? "medium",
      expectedClose: initial?.expectedClose ? initial.expectedClose.slice(0, 10) : "",
      ownerUserId: initial?.ownerUserId ?? "",
    },
  });

  const watchedPipelineId = form.watch("pipelineId");
  const watchedStages = pipelines.find((p) => p.id === watchedPipelineId)?.stages ?? [];

  async function onSubmit(values: DealFormValues) {
    const payload = {
      ...values,
      contactId: values.contactId || undefined,
      ownerUserId: values.ownerUserId || undefined,
      expectedClose: values.expectedClose ? new Date(values.expectedClose).toISOString() : undefined,
    };
    const res =
      mode === "create"
        ? await createDealAction(payload)
        : dealId
          ? await updateDealAction(dealId, payload)
          : { ok: false as const, error: "missing deal" };
    if (res.ok && res.dealId) {
      toast.success(mode === "create" ? "Deal created" : "Deal updated");
      router.push(`/crm/deals/${res.dealId}`);
      router.refresh();
    } else {
      toast.error("Failed to save deal", { description: res.error });
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 rounded-lg border bg-card p-6"
        data-testid="deal-form"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Deal Title *</FormLabel>
              <FormControl>
                <Input placeholder="Home loan — Ramesh" data-testid="deal-title" {...field} />
              </FormControl>
              <FormDescription>A short, descriptive title for this deal.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="valuePaise"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Value (₹) *</FormLabel>
              <FormControl>
                <MoneyInput
                  value={field.value}
                  onChange={field.onChange}
                  data-testid="deal-value"
                  placeholder="2500000"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="pipelineId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pipeline *</FormLabel>
                <FormControl>
                  <Select
                    {...field}
                    onChange={(e) => {
                      const pid = e.target.value;
                      field.onChange(pid);
                      // Reset stage to the new pipeline's first stage.
                      const p = pipelines.find((x) => x.id === pid);
                      form.setValue("stageId", p?.stages[0]?.id ?? "");
                    }}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="stageId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stage *</FormLabel>
                <FormControl>
                  <Select {...field}>
                    {watchedStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <FormControl>
                  <Select {...field}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contactId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact</FormLabel>
                <FormControl>
                  <Select {...field} value={field.value ?? ""}>
                    <option value="">None</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? c.phone}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="expectedClose"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expected close</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="ownerUserId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Owner</FormLabel>
                <FormControl>
                  <Select {...field} value={field.value ?? ""}>
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={form.formState.isSubmitting} data-testid="deal-submit">
            {form.formState.isSubmitting
              ? "Saving…"
              : mode === "create"
                ? "Create deal"
                : "Save changes"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
        {createPipeline && (
          <p className="text-xs text-muted-foreground">
            Tip: no pipelines exist yet — create one first.
          </p>
        )}
      </form>
    </Form>
  );
}
