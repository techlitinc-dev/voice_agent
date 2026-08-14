import {
  PhoneIncoming, PhoneOutgoing, MessageSquare, MessageCircle, Mail,
  FileText, ArrowRightCircle, PlusCircle, Trophy, XCircle, Calendar,
  CheckCircle2, UserCog, PenLine, Stamp, type LucideIcon,
} from "lucide-react";
import type { ActivityType } from "@prisma/client";

/** Icon + badge color per activity type (guide crm/03 §1.3). */
const META: Record<ActivityType, { icon: LucideIcon; color: string }> = {
  CALL_INBOUND:       { icon: PhoneIncoming,   color: "bg-blue-100 text-blue-700" },
  CALL_OUTBOUND:      { icon: PhoneOutgoing,   color: "bg-indigo-100 text-indigo-700" },
  SMS_SENT:           { icon: MessageSquare,   color: "bg-emerald-100 text-emerald-700" },
  WHATSAPP_SENT:      { icon: MessageCircle,   color: "bg-green-100 text-green-700" },
  EMAIL_SENT:         { icon: Mail,            color: "bg-cyan-100 text-cyan-700" },
  NOTE_ADDED:         { icon: PenLine,         color: "bg-gray-100 text-gray-700" },
  STAGE_CHANGED:      { icon: ArrowRightCircle,color: "bg-amber-100 text-amber-700" },
  DEAL_CREATED:       { icon: PlusCircle,      color: "bg-violet-100 text-violet-700" },
  DEAL_WON:           { icon: Trophy,          color: "bg-green-100 text-green-700" },
  DEAL_LOST:          { icon: XCircle,         color: "bg-red-100 text-red-700" },
  MEETING_SCHEDULED:  { icon: Calendar,        color: "bg-purple-100 text-purple-700" },
  TASK_COMPLETED:     { icon: CheckCircle2,    color: "bg-teal-100 text-teal-700" },
  CONTACT_UPDATED:    { icon: UserCog,         color: "bg-slate-100 text-slate-700" },
  MANUAL:             { icon: FileText,        color: "bg-gray-100 text-gray-700" },
  APPROVAL_REQUESTED: { icon: Stamp,           color: "bg-amber-100 text-amber-700" },
  APPROVAL_RESOLVED:  { icon: Stamp,           color: "bg-green-100 text-green-700" },
  APPROVAL_REJECTED:  { icon: Stamp,           color: "bg-red-100 text-red-700" },
};

export const activityIcon = (type: ActivityType): LucideIcon => META[type]?.icon ?? FileText;
export const activityColor = (type: ActivityType): string => META[type]?.color ?? "bg-gray-100 text-gray-700";

/** Human label used in timeline filter dropdowns. */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL_INBOUND: "Inbound call",
  CALL_OUTBOUND: "Outbound call",
  SMS_SENT: "SMS sent",
  WHATSAPP_SENT: "WhatsApp sent",
  EMAIL_SENT: "Email sent",
  NOTE_ADDED: "Note added",
  STAGE_CHANGED: "Stage changed",
  DEAL_CREATED: "Deal created",
  DEAL_WON: "Deal won",
  DEAL_LOST: "Deal lost",
  MEETING_SCHEDULED: "Meeting scheduled",
  TASK_COMPLETED: "Task completed",
  CONTACT_UPDATED: "Contact updated",
  MANUAL: "Manual entry",
  APPROVAL_REQUESTED: "Approval requested",
  APPROVAL_RESOLVED: "Approval approved",
  APPROVAL_REJECTED: "Approval rejected",
};
