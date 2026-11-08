import { DASHBOARD_ROUTES, dashboardPath } from "@nuni/shared"
import Image from "next/image"

import { buttonVariants } from "@/components/ui/button"
import { BASE_PATH } from "@/lib/config"

export function SignedOut({ returnTo = BASE_PATH }: { returnTo?: string }) {
  return (
    <div className="mx-auto grid max-w-sm justify-items-center gap-8 py-16 text-center">
      <Image src={`${BASE_PATH}/icon.svg`} alt="" width={44} height={44} />
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
        href={dashboardPath(DASHBOARD_ROUTES.signIn, { returnTo })}
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
