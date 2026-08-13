"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Phone, MessageSquare, MessageCircle, PenLine, Plus, Calendar } from "lucide-react";

/** Quick-action buttons for a deal/contact (guide crm/03 §5). */
export function QuickActions({
  phone,
  dealId,
  canWrite,
}: {
  phone?: string | null;
  dealId?: string | null;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const tel = phone ? `tel:${phone}` : undefined;
  const sms = phone ? `sms:${phone}` : undefined;
  const wa = phone ? `https://wa.me/${phone.replace(/^\+/, "")}` : undefined;

  return (
    <div className="flex flex-wrap gap-2" data-testid="quick-actions">
      {tel && (
        <a href={tel}>
          <Button size="sm" variant="outline"><Phone className="h-4 w-4" /> Call</Button>
        </a>
      )}
      {sms && (
        <a href={sms}>
          <Button size="sm" variant="outline"><MessageSquare className="h-4 w-4" /> SMS</Button>
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="outline"><MessageCircle className="h-4 w-4" /> WhatsApp</Button>
        </a>
      )}
      {dealId && canWrite && (
        <Button size="sm" variant="outline" onClick={() => document.getElementById("quick-note")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          <PenLine className="h-4 w-4" /> Note
        </Button>
      )}
      {dealId && canWrite && (
        <Button size="sm" variant="outline" onClick={() => router.push(`/crm/deals/${dealId}?quickTask=1`)}>
          <Plus className="h-4 w-4" /> Task
        </Button>
      )}
      {dealId && (
        <Link href={`/crm/deals/${dealId}/edit`}>
          <Button size="sm" variant="outline"><Calendar className="h-4 w-4" /> Edit</Button>
        </Link>
      )}
    </div>
  );
}
