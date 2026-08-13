import { requirePermission } from "@/lib/auth";
import { SegmentBuilderForm } from "../segment-builder";

export const metadata = { title: "New Segment — Vaani AI" };

export default async function NewSegmentPage() {
  await requirePermission("segments:write");
  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-4 text-lg font-semibold">New segment</h2>
      <SegmentBuilderForm />
    </div>
  );
}
