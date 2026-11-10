import { DOCS_URL } from "@nuni/shared"

import { Logo } from "@/components/logo"
import { buttonVariants } from "@/components/ui/button"
import { UserMenu } from "@/components/user-menu"

/** `email` is the signed-in person's, if anyone is signed in. */
export function SiteHeader({ email }: { email?: string }) {
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
          {email && <UserMenu email={email} />}
        </nav>
      </div>
    </header>
  )
}
