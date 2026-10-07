import { DOCS_URL } from "@nuni/shared"
import type { User } from "@workos-inc/node"

import { Logo } from "@/components/logo"
import { buttonVariants } from "@/components/ui/button"
import { UserMenu } from "@/components/user-menu"

export function SiteHeader({ user }: { user: User | null }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <Logo />
        <nav
          aria-label="Main navigation"
          className="ml-auto flex items-center gap-1"
        >
          <a
            href={DOCS_URL}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Docs
          </a>
          {user && (
            <UserMenu
              name={
                [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                user.email
              }
              email={user.email}
              avatarUrl={user.profilePictureUrl}
            />
          )}
        </nav>
      </div>
    </header>
  )
}
