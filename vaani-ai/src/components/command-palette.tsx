"use client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import {
  Bot,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  Phone,
  Plus,
  Users,
} from "lucide-react";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const go = (href: string) => {
    router.push(href);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0" data-testid="command-palette">
        <Command>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Quick Actions">
              <CommandItem onSelect={() => go("/agents/new")} data-testid="cmd-new-agent">
                <Plus className="mr-2 h-4 w-4" /> New Agent
              </CommandItem>
              <CommandItem onSelect={() => go("/crm/deals/new")} data-testid="cmd-new-deal">
                <Plus className="mr-2 h-4 w-4" /> New Deal
              </CommandItem>
              <CommandItem onSelect={() => go("/campaigns/new")} data-testid="cmd-new-campaign">
                <Plus className="mr-2 h-4 w-4" /> New Campaign
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => go("/dashboard")} data-testid="cmd-dashboard">
                <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
              </CommandItem>
              <CommandItem onSelect={() => go("/crm/pipeline")} data-testid="cmd-pipeline">
                <KanbanSquare className="mr-2 h-4 w-4" /> CRM Pipeline
              </CommandItem>
              <CommandItem onSelect={() => go("/calls")} data-testid="cmd-calls">
                <Phone className="mr-2 h-4 w-4" /> Calls
              </CommandItem>
              <CommandItem onSelect={() => go("/agents")} data-testid="cmd-agents">
                <Bot className="mr-2 h-4 w-4" /> Agents
              </CommandItem>
              <CommandItem onSelect={() => go("/campaigns")} data-testid="cmd-campaigns">
                <Megaphone className="mr-2 h-4 w-4" /> Campaigns
              </CommandItem>
              <CommandItem onSelect={() => go("/contacts")} data-testid="cmd-contacts">
                <Users className="mr-2 h-4 w-4" /> Contacts
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
