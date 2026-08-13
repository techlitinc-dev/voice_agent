# 01 — Component Catalog & Installation

> **Goal:** Expand the UI from **5 components** (button, card, input, select,
> tooltip) to a **full 40+ component shadcn/ui catalog** — the foundation for a
> polished, consistent, production-grade interface.

---

## 1. Current State

```
src/components/ui/
├── button.tsx     ✓
├── card.tsx       ✓
├── input.tsx      ✓
├── select.tsx     ✓
└── tooltip.tsx    ✓
```

Only 5 of ~45 shadcn/ui components. This limits every page to basic forms and
static cards — no dialogs, tabs, tables, dropdowns, toasts, etc.

---

## 2. Target State — Full Catalog

```
src/components/ui/
├── accordion.tsx          ├── hover-card.tsx         ├── select.tsx ✓
├── alert.tsx              ├── input.tsx ✓            ├── separator.tsx
├── alert-dialog.tsx       ├── input-otp.tsx          ├── sheet.tsx
├── avatar.tsx             ├── kbd.tsx                ├── skeleton.tsx
├── badge.tsx              ├── label.tsx              ├── slider.tsx
├── breadcrumb.tsx         ├── menubar.tsx            ├── sonner.tsx (toast)
├── button.tsx ✓           ├── navigation-menu.tsx    ├── spinner.tsx
├── calendar.tsx           ├── pagination.tsx         ├── switch.tsx
├── card.tsx ✓             ├── popover.tsx            ├── table.tsx
├── carousel.tsx           ├── progress.tsx           ├── tabs.tsx
├── checkbox.tsx           ├── radio-group.tsx        ├── textarea.tsx
├── collapsible.tsx        ├── resizable.tsx          ├── timeline.tsx (custom)
├── command.tsx            ├── scroll-area.tsx        ├── toggle.tsx
├── context-menu.tsx       ├── data-table.tsx (custom)├── toggle-group.tsx
├── dialog.tsx             ├── date-picker.tsx (custom)├── tooltip.tsx ✓
├── dropdown-menu.tsx      ├── dropzone.tsx (custom)  └── empty-state.tsx (custom)
├── form.tsx               ├── drawer.tsx
└── ...
```

**Legend**: ✓ = already exists, (custom) = not in shadcn registry but built in-house using the same patterns.

---

## 3. Installation

### 3.1 Initialize shadcn/ui (one-time)

The project already uses the shadcn pattern (Radix + CVA + tailwind-merge). Add
the CLI for easy component management:

```bash
cd vaani-ai
npx shadcn@latest init
```

When prompted:

| Option | Value |
|---|---|
| Style | **New York** (the default for shadcn) |
| Base color | **Slate** or **Zinc** |
| CSS variables | **Yes** |
| Components alias | `@/components` (already set) |
| Utils alias | `@/lib/utils` (already set) |
| RSC | **Yes** |

This creates/updates `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

### 3.2 Add all components

```bash
# Add components in batches
npx shadcn@latest add alert alert-dialog avatar badge breadcrumb checkbox \
  collapsible command context-menu dialog drawer dropdown-menu form hover-card \
  input-otp label menubar navigation-menu pagination popover progress \
  radio-group resizable scroll-area separator sheet skeleton slider sonner \
  switch table tabs textarea toggle toggle-group calendar

# These need react-day-picker
npx shadcn@latest add calendar date-picker

# Carousel needs embla-carousel-react
npx shadcn@latest add carousel
```

### 3.3 Additional dependencies

Some components require extra packages:

```bash
npm install @hello-pangea/dnd      # drag-and-drop (pipeline board)
npm install react-hook-form @hookform/resolvers  # form component
npm install embla-carousel-react   # carousel
npm install react-day-picker date-fns  # calendar/date-picker
npm install cmdk                   # command palette
npm install vaul                   # drawer (bottom sheet)
npm install sonner                 # toasts
npm install react-resizable-panels # resizable panels
npm install input-otp              # OTP input (2FA)
npm install recharts               # charts (already installed)
```

### 3.4 Custom components

Build these in-house following shadcn patterns:

```bash
# Create custom components (not in shadcn registry)
touch src/components/ui/data-table.tsx
touch src/components/ui/date-picker.tsx
touch src/components/ui/dropzone.tsx
touch src/components/ui/empty-state.tsx
touch src/components/ui/timeline.tsx
touch src/components/ui/spinner.tsx
touch src/components/ui/stat-card.tsx
touch src/components/ui/kbd.tsx
```

---

## 4. Component Reference

### 4.1 Quick reference table

| Component | Purpose | Used in |
|---|---|---|
| `Accordion` | Collapsible sections | Settings, FAQ |
| `Alert` | Inline messages | Form errors, warnings |
| `AlertDialog` | Confirmation dialogs | Delete confirmations |
| `Avatar` | User/workspace images | Members, deal owner |
| `Badge` | Status tags | Call status, deal stage, HOT/WARM |
| `Breadcrumb` | Navigation trail | Nested pages |
| `Button` | Actions | Everywhere ✓ |
| `Calendar` | Date picker | Reports, scheduling |
| `Card` | Content containers | Dashboard, stats ✓ |
| `Carousel` | Image/card carousel | Marketplace templates |
| `Checkbox` | Boolean input | Task completion, filters |
| `Command` | Command palette | Quick search (⌘K) |
| `DataTable` | Sortable/filterable table | Calls list, deals list, contacts |
| `DatePicker` | Date range selection | Analytics, reports |
| `Dialog` | Modal windows | Create deal, edit agent |
| `Drawer` | Bottom sheet (mobile) | Mobile quick-actions |
| `DropdownMenu` | Context menus | Row actions, user menu |
| `Dropzone` | File upload | Knowledge docs, KYC |
| `EmptyState` | "No data" placeholder | Empty lists |
| `Form` | Form wrapper + validation | All forms |
| `HoverCard` | Preview on hover | Contact preview |
| `Input` | Text input ✓ | Forms |
| `InputOTP` | OTP entry | 2FA verification |
| `Kbd` | Keyboard key display | Shortcuts help |
| `Label` | Form labels | Forms |
| `Menubar` | Top menu bar | (if desktop app) |
| `NavigationMenu` | Main nav | Header |
| `Pagination` | Page navigation | Lists |
| `Popover` | Floating panel | Filters, date picker |
| `Progress` | Progress bar | Campaign progress, upload |
| `RadioGroup` | Single choice | Pipeline selector |
| `Resizable` | Resizable panels | Split views |
| `ScrollArea` | Custom scrollbar | Activity timeline |
| `Select` | Dropdown select ✓ | Filters, forms |
| `Separator` | Visual divider | Settings sections |
| `Sheet` | Side panel | Mobile nav, deal detail |
| `Skeleton` | Loading placeholder | All pages |
| `Slider` | Range input | Value filters |
| `Sonner` (Toast) | Notifications | Action feedback |
| `Spinner` | Loading indicator | Buttons, inline |
| `StatCard` | KPI display | Dashboard |
| `Switch` | Toggle | Feature flags, settings |
| `Table` | Data table base | Lists |
| `Tabs` | Tabbed content | Deal detail, settings |
| `Textarea` | Multi-line input | Notes, prompts |
| `Timeline` | Activity feed | Deal/contact timeline |
| `Toggle` | On/off button | View mode toggle |
| `ToggleGroup` | Multi-toggle | Filter chips |
| `Tooltip` | Hover info ✓ | Icon buttons |

---

## 5. Usage Examples by Module

### Dashboard
```tsx
<StatCard />              // KPI cards
<Card> + <Tabs>           // Tabbed widget
<Progress />              // Campaign progress
<Skeleton />              // Loading state
<Sonner toast />          // "Export ready"
```

### CRM Pipeline
```tsx
<DragDropContext>         // Kanban board
<Badge />                 // HOT/WARM/COLD
<Avatar />                // Deal owner
<Sheet>                   // Deal detail (mobile)
<DropdownMenu />          // Deal actions
<AlertDialog />           // Delete confirmation
<Input /> + <Select />    // Create deal form
```

### Calls List
```tsx
<DataTable />             // Sortable, paginated
<DatePicker />            // Date filter
<Select />                // Status filter
<Dialog />                // Call detail modal
<HoverCard />             // Contact preview
<Checkbox />              // Bulk select
```

### Settings
```tsx
<Tabs />                  // Section navigation
<Form />                  // All forms
<Switch />                // Toggles
<InputOTP />              // 2FA setup
<Dropzone />              // KYC upload
<Separator />             // Section dividers
```

---

## 6. Theming & Customization

### 6.1 CSS variables (already in globals.css)

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --primary: 222.2 47.4% 11.2%;
  --secondary: 210 40% 96.1%;
  --muted: 210 40% 96.1%;
  --accent: 210 40% 96.1%;
  --destructive: 0 84.2% 60.2%;
  --border: 214.3 31.8% 91.4%;
  --radius: 0.5rem;
}
```

### 6.2 Dark mode

Add dark mode via a `class` strategy:

```tsx
// tailwind.config.ts
darkMode: ["class"]

// Add a theme toggle
import { useTheme } from "next-themes";
npm install next-themes
```

```tsx
// src/components/theme-toggle.tsx
"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      <Sun className="h-5 w-5 dark:hidden" />
      <Moon className="h-5 w-5 hidden dark:block" />
    </Button>
  );
}
```

### 6.3 Brand theming (white-label)

For white-label (existing `Workspace.primaryColor`), inject CSS variables per workspace:

```tsx
// src/app/(app)/layout.tsx
export default async function AppLayout() {
  const workspace = await getWorkspace();
  return (
    <div style={{
      ...(workspace.primaryColor && {
        "--primary": hexToHsl(workspace.primaryColor),
      }),
    } as React.CSSProperties}>
      {children}
    </div>
  );
}
```

---

## Next

→ [02 — Dashboard & Data Display Patterns](02-dashboard-and-data-display.md)