# 04 — Navigation & Overlays

> **Goal:** Patterns for navigation (side nav, breadcrumbs, tabs), overlays
> (dialogs, sheets, popovers), and command palette.

---

## 1. App Layout Navigation

### 1.1 Sidebar structure

The existing `app/(app)/layout.tsx` has a sidebar. Expand it:

```tsx
// src/app/(app)/layout.tsx
import { LayoutDashboard, Bot, Phone, Megaphone, Users, KanbanSquare, BarChart3, Wallet, Settings, FileText } from "lucide-react";

const NAV_ITEMS = [
  { section: "Overview", items: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Live Calls", href: "/live", icon: Phone, badge: "liveCount" },
  ]},
  { section: "Voice", items: [
    { label: "Agents", href: "/agents", icon: Bot },
    { label: "Calls", href: "/calls", icon: Phone },
    { label: "Campaigns", href: "/campaigns", icon: Megaphone },
  ]},
  { section: "CRM", items: [
    { label: "Pipeline", href: "/crm/pipeline", icon: KanbanSquare },
    { label: "Contacts", href: "/contacts", icon: Users },
    { label: "Analytics", href: "/crm/analytics", icon: BarChart3 },
  ]},
  { section: "Account", items: [
    { label: "Billing", href: "/billing", icon: Wallet },
    { label: "Settings", href: "/settings", icon: Settings },
  ]},
];

export default function AppLayout({ children }) {
  return (
    <div className="flex h-screen">
      <Sidebar navItems={NAV_ITEMS} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
```

### 1.2 Nav item with active state + badge

```tsx
// src/components/nav/sidebar-link.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function SidebarLink({ item, badgeCount }: { item: NavItem; badgeCount?: number }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + "/");

  return (
    <Link href={item.href} className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
    )}>
      <item.icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{item.label}</span>
      {badgeCount !== undefined && badgeCount > 0 && (
        <Badge variant={active ? "secondary" : "default"} className="h-5 px-1.5 text-xs">{badgeCount}</Badge>
      )}
    </Link>
  );
}
```

### 1.3 Mobile navigation (Sheet)

```tsx
// src/components/nav/mobile-nav.tsx
"use client";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden"><Menu /></Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <Sidebar />
      </SheetContent>
    </Sheet>
  );
}
```

---

## 2. Breadcrumbs

```tsx
// src/components/ui/breadcrumb.tsx (from shadcn)
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export function DealBreadcrumbs({ workspace, pipeline, deal }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/crm/pipeline">Pipeline</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{deal.title}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
```

---

## 3. Command Palette (⌘K)

A quick-search + quick-action palette:

```tsx
// src/components/command-palette.tsx
"use client";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { Bot, Phone, Megaphone, Users, KanbanSquare, Plus, Search } from "lucide-react";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const go = (href: string) => { router.push(href); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden max-w-lg">
        <Command>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Quick Actions">
              <CommandItem onSelect={() => go("/agents/new")}><Plus className="mr-2 h-4 w-4" />New Agent</CommandItem>
              <CommandItem onSelect={() => go("/crm/deals/new")}><Plus className="mr-2 h-4 w-4" />New Deal</CommandItem>
              <CommandItem onSelect={() => go("/campaigns/new")}><Plus className="mr-2 h-4 w-4" />New Campaign</CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => go("/dashboard")}><Search className="mr-2 h-4 w-4" />Dashboard</CommandItem>
              <CommandItem onSelect={() => go("/crm/pipeline")}><KanbanSquare className="mr-2 h-4 w-4" />CRM Pipeline</CommandItem>
              <CommandItem onSelect={() => go("/calls")}><Phone className="mr-2 h-4 w-4" />Calls</CommandItem>
              <CommandItem onSelect={() => go("/agents")}><Bot className="mr-2 h-4 w-4" />Agents</CommandItem>
              <CommandItem onSelect={() => go("/campaigns")}><Megaphone className="mr-2 h-4 w-4" />Campaigns</CommandItem>
              <CommandItem onSelect={() => go("/contacts")}><Users className="r-2 h-4 w-4" />Contacts</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
```

Global hotkey listener:

```tsx
// src/app/(app)/layout.tsx
"use client";
import { useEffect, useState } from "react";

export function AppShell({ children }) {
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {children}
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}
```

---

## 4. Dialogs (modals)

### 4.1 Create/edit dialog

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function CreateDealDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Deal</DialogTitle>
          <DialogDescription>Add a new deal to the pipeline.</DialogDescription>
        </DialogHeader>
        <DealForm onSuccess={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
```

### 4.2 Confirmation dialog (destructive)

```tsx
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export function DeleteDealButton({ dealId }: { dealId: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm"><Trash2 className="w-4 h-4 mr-1" /> Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the deal and all its activities. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => deleteDeal(dealId)} className="bg-red-600 hover:bg-red-700">
            Delete permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

---

## 5. Dropdown Menus

### 5.1 Row actions

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function DealRowActions({ deal }: { deal: Deal }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => router.push(`/crm/deals/${deal.id}`)}>
          <Eye className="mr-2 h-4 w-4" /> View Details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(`/crm/deals/${deal.id}/edit`)}>
          <Edit className="mr-2 h-4 w-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => duplicateDeal(deal.id)}>
          <Copy className="mr-2 h-4 w-4" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600" onClick={() => setDeleteId(deal.id)}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 5.2 User menu

```tsx
export function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2">
          <Avatar><AvatarImage src={user.image} /><AvatarFallback>{initials}</AvatarFallback></Avatar>
          <span className="text-sm hidden md:block">{user.name}</span>
          <ChevronDown className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem><User className="mr-2 h-4 w-4" /> Profile</DropdownMenuItem>
        <DropdownMenuItem><Settings className="mr-2 h-4 w-4" /> Settings</DropdownMenuItem>
        <DropdownMenuItem><Keyboard className="mr-2 h-4 w-4" /> Shortcuts <Kbd>⌘K</Kbd></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600"><LogOut className="mr-2 h-4 w-4" /> Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

## 6. Tabs

The existing `Tabs` component (already has radix-tabs). Use for detail pages:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function DealDetailTabs({ deal }) {
  return (
    <Tabs defaultValue="activity">
      <TabsList>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="calls">Calls ({deal.calls.length})</TabsTrigger>
        <TabsTrigger value="tasks">Tasks ({deal.tasks.length})</TabsTrigger>
        <TabsTrigger value="notes">Notes ({deal.notes.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="activity"><ActivityTimeline activities={deal.activities} /></TabsContent>
      <TabsContent value="calls"><CallList calls={deal.calls} /></TabsContent>
      <TabsContent value="tasks"><TaskList tasks={deal.tasks} /></TabsContent>
      <TabsContent value="notes"><NotesList notes={deal.notes} /></TabsContent>
    </Tabs>
  );
}
```

---

## 7. Popover (filters)

```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function FilterButton({ filters, onApply }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline"><Filter className="w-4 h-4 mr-2" /> Filters {activeCount > 0 && <Badge className="ml-1">{activeCount}</Badge>}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <h4 className="font-medium">Filter deals</h4>
          <Select><SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger>...</Select>
          <Select><SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>...</Select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
            <Button size="sm" onClick={applyFilters}>Apply</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

---

## 8. Responsive Patterns

| Breakpoint | Behavior |
|---|---|
| `sm` (640px) | Mobile: single column, Sheet nav, bottom sheet actions |
| `md` (768px) | Tablet: 2-column grids, collapsible sidebar |
| `lg` (1024px) | Desktop: sidebar always visible, 3-column deal detail |
| `xl` (1280px) | Wide: 4-column KPI grid, expanded pipeline |

Key rules:
- Hide sidebar on mobile, show via Sheet.
- Tables become cards on mobile (stacked).
- Dialogs become bottom Drawers on mobile.
- KPI grids collapse from 4 → 2 → 1 columns.

---

← Back to [UI Expansion](../README.md#ui-expansion-shadcnui) | [New Features →](../new-features/01-real-time-call-coaching.md)