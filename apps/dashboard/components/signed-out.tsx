"use client"

import { usePathname, useSearchParams } from "next/navigation"

import { NuniMark } from "@/components/logo"
import { buttonVariants } from "@/components/ui/button"
import { signInUrl } from "@/lib/config"

export function SignedOut() {
  const pathname = usePathname()
  // Back to this page as it was opened: a claim, CLI or transfer link is
  // nothing without its query.
  const query = Object.fromEntries(useSearchParams())
  const route = pathname === "/" ? "" : pathname
  return (
    <div className="mx-auto grid max-w-sm justify-items-center gap-8 py-16 text-center">
      <NuniMark size={44} />
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your Nuni projects
        </h1>
        <p className="text-sm text-balance text-muted-foreground">
          Sign in to manage the comments on sites you&apos;ve claimed.
          Commenters never need an account.
        </p>
      </div>
      <a
        className={buttonVariants({ size: "lg", className: "w-full" })}
        href={signInUrl(route, query)}
      >
        Sign in to Nuni
      </a>
      <p className="text-xs text-balance text-muted-foreground">
        To claim a site, open it, click the Nuni button and choose &ldquo;Claim
        Nuni&rdquo;.
      </p>
    </div>
  )
}
