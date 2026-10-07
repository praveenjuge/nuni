"use client"

import { LogOutIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { initials } from "@/lib/format"

/** The signed-in person: who they are, the theme, and signing out. */
export function UserMenu({
  name,
  email,
  avatarUrl,
}: {
  name: string
  email: string
  avatarUrl?: string | null
}) {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="ml-1 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Avatar size="sm">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="grid gap-0.5 px-2 py-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {email !== name && (
            <span className="truncate text-xs text-muted-foreground">
              {email}
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Theme <Kbd>D</Kbd>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme ?? "system"}
            onValueChange={(value) => setTheme(value as string)}
          >
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="/dashboard/sign-out" />}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
