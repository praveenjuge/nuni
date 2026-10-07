import Image from "next/image"

import { buttonVariants } from "@/components/ui/button"

export function SignedOut({ returnTo = "/dashboard" }: { returnTo?: string }) {
  return (
    <div className="mx-auto grid max-w-sm justify-items-center gap-8 py-16 text-center">
      <Image src="/dashboard/icon.svg" alt="" width={44} height={44} />
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
        href={`/dashboard/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
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
