"use client";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { createPipelineAction } from "@/server/actions/crm";

const stageSchema = z.object({
  name: z.string().min(1, "Every stage needs a name."),
  probability: z.coerce.number().min(0).max(100),
  color: z.string(),
});

const schema = z.object({
  name: z.string().min(2, "Pipeline name must be at least 2 characters.").max(80),
  stages: z.array(stageSchema).min(1, "Add at least one stage."),
});

type PipelineFormValues = z.infer<typeof schema>;

const DEFAULT_STAGES = [
  { name: "New", probability: 10, color: "#6b7280" },
  { name: "Contacted", probability: 25, color: "#3b82f6" },
  { name: "Qualified", probability: 50, color: "#8b5cf6" },
  { name: "Won", probability: 100, color: "#10b981" },
  { name: "Lost", probability: 0, color: "#ef4444" },
];

export function CreatePipelineForm() {
  const router = useRouter();
  const form = useForm<PipelineFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", stages: DEFAULT_STAGES },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "stages" });

  async function onSubmit(values: PipelineFormValues) {
    const res = await createPipelineAction({
      name: values.name.trim(),
      isDefault: true,
      stages: values.stages.map((s) => ({
        name: s.name.trim(),
        probability: s.probability,
        color: s.color,
      })),
    });
    if (res.ok && res.dealId) {
      toast.success("Pipeline created");
      router.push("/crm/pipeline");
      router.refresh();
    } else {
      toast.error("Failed to create pipeline", { description: res.error });
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 rounded-lg border bg-card p-6"
        data-testid="create-pipeline-form"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pipeline name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Sales" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2">
          <p className="text-sm font-medium">Stages</p>
          {fields.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <FormField
                control={form.control}
                name={`stages.${i}.name`}
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input placeholder={`Stage ${i + 1}`} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`stages.${i}.probability`}
                render={({ field }) => (
                  <FormItem className="w-20">
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        title="Win probability %"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`stages.${i}.color`}
                render={({ field }) => (
                  <FormItem className="w-12">
                    <FormControl>
                      <Input type="color" className="h-9" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ name: "", probability: 0, color: "#94a3b8" })}
          >
            + Add stage
          </Button>
        </div>

        <Button type="submit" disabled={form.formState.isSubmitting} data-testid="pipeline-submit">
          {form.formState.isSubmitting ? "Creating…" : "Create pipeline"}
        </Button>
      </form>
    </Form>
  );
}
