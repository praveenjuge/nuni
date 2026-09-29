import { DOCS_URL } from "@nuni/shared"
import Image from "next/image"
import Link from "next/link"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { buttonVariants } from "@/components/ui/button"

export function SiteHeader({
  user,
}: {
  user?: { name: string; avatarUrl?: string | null } | null
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/dashboard/icon.svg" alt="" width={28} height={28} />
          Nuni
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-1">
          <Link
            href="/"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Projects
          </Link>
          <a
            href={DOCS_URL}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Docs
          </a>
        </nav>
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
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Sign out
              </a>
            </>
          ) : (
            <a
              href="/dashboard/sign-in"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  )
}
