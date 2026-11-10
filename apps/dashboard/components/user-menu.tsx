"use client"

import { DASHBOARD_ROUTES, dashboardPath } from "@nuni/shared"
import { LogOutIcon } from "vadivam-react"
import { useTheme } from "next-themes"

import { THEME_HOTKEY } from "@/components/theme-provider"
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
import { Skeleton } from "@/components/ui/skeleton"
import { useMaybeMe } from "@/components/user"
import { initials } from "@/lib/format"

/** The signed-in person: who they are, the theme, and signing out. */
export function UserMenu({ email }: { email: string }) {
  const me = useMaybeMe()
  const { theme, setTheme } = useTheme()
  if (!me) return <Skeleton className="ml-1 size-6 rounded-full" />
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="ml-1 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Avatar size="sm">
          {me.avatarUrl ? <AvatarImage src={me.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(me.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="grid gap-0.5 px-2 py-1.5">
          <span className="truncate text-sm font-medium">{me.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {email}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Theme <Kbd>{THEME_HOTKEY.toUpperCase()}</Kbd>
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
        {/* A route handler, so a full page load rather than <Link>. */}
        <DropdownMenuItem
          render={<a href={dashboardPath(DASHBOARD_ROUTES.signOut)} />}
        >
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
