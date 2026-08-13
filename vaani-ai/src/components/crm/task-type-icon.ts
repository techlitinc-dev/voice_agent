import { Phone, MessageSquare, MessageCircle, Mail, Calendar, FileText, RefreshCw, Tag, type LucideIcon } from "lucide-react";
import type { TaskType } from "@prisma/client";

const ICONS: Record<TaskType, LucideIcon> = {
  CALL: Phone,
  SMS: MessageSquare,
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
  MEETING: Calendar,
  DOCUMENT: FileText,
  FOLLOW_UP: RefreshCw,
  CUSTOM: Tag,
};

export const taskTypeIcon = (type: TaskType): LucideIcon => ICONS[type] ?? Tag;
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CALL: "Call",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  MEETING: "Meeting",
  DOCUMENT: "Document",
  FOLLOW_UP: "Follow-up",
  CUSTOM: "Custom",
};
