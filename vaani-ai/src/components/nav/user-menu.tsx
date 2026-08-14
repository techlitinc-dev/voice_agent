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

export function UserMenu({
  name,
  email,
  onOpenCommandPalette,
}: {
  name: string;
  email: string;
  onOpenCommandPalette?: () => void;
}) {
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
        <DropdownMenuItem onSelect={() => onOpenCommandPalette?.()}>
          <span className="mr-2 flex h-4 w-4 items-center justify-center">
            <Kbd>⌘K</Kbd>
          </span>
          Shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600" asChild>
          <form action={logoutAction}>
            <button type="submit" className="flex w-full items-center" data-testid="logout-button">
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
