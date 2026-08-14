import { MessageCircle, MessageSquare, Phone, type LucideIcon } from "lucide-react";

export const CHANNELS: Record<string, { label: string; icon: LucideIcon; dot: string }> = {
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle, dot: "bg-green-500" },
  SMS: { label: "SMS", icon: MessageSquare, dot: "bg-blue-500" },
  WEBCHAT: { label: "Web Chat", icon: MessageSquare, dot: "bg-violet-500" },
  VOICE: { label: "Voice", icon: Phone, dot: "bg-amber-500" },
  EMAIL: { label: "Email", icon: MessageSquare, dot: "bg-gray-500" },
};

export function channelLabel(channel: string): string {
  return CHANNELS[channel]?.label ?? channel;
}
