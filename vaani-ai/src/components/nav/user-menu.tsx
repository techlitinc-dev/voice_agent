"use client";
import Link from "next/link";
import { logoutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut, Settings, User } from "lucide-react";

export function UserMenu({ name, email }: { name: string; email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex w-full items-center justify-start gap-2 px-2 py-2"
          data-testid="user-menu-trigger"
        >
          <Avatar name={name} size="sm" />
          <span className="flex-1 truncate text-left text-sm">{name}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/members">
            <User className="mr-2 h-4 w-4" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="mr-2 h-4 w-4" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => document.dispatchEvent(new Event("vaani:open-command"))}>
          <span className="mr-2 flex h-4 w-4 items-center justify-center">
            <Kbd>⌘K</Kbd>
          </span>
          Shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Not asChild: Radix Item prevents default on click, which would swallow
            the form's submit. A plain form child keeps the server action working. */}
        <DropdownMenuItem className="p-0 text-red-600" onSelect={(e) => e.preventDefault()}>
          <form action={logoutAction} className="w-full">
            <button type="submit" className="flex w-full items-center px-2 py-1.5 text-sm" data-testid="logout-button">
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
