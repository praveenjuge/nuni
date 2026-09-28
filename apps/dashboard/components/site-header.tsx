import { DOCS_URL } from "@nuni/shared"
import Link from "next/link"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function SiteHeader({
  user,
}: {
  user?: { name: string; avatarUrl?: string | null } | null
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            n
          </span>
          Nuni
        </Link>
        <a
          href={DOCS_URL}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Docs
        </a>
        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <Avatar className="size-7">
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback>
                  {user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm sm:inline">{user.name}</span>
              <a
                href="/dashboard/sign-out"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Sign out
              </a>
            </>
          ) : (
            <a href="/dashboard/sign-in" className="text-sm font-medium">
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  )
}
