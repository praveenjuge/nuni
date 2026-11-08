import { DASHBOARD_ROUTES, dashboardPath, isProjectId } from "@nuni/shared"
import { withAuth } from "@workos-inc/authkit-nextjs"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ClaimFlow } from "@/components/claim-flow"
import { signInUrl } from "@/lib/config"
import { cleanOrigin } from "@/lib/format"

export const metadata: Metadata = { title: "Claim this site" }

export default async function Page(props: PageProps<"/claim">) {
  const params = await props.searchParams
  const project = typeof params.project === "string" ? params.project : ""
  const origin = cleanOrigin(
    typeof params.origin === "string" ? params.origin : undefined
  )

  if (!isProjectId(project) || !origin) {
    return (
      <main className="mx-auto grid min-h-svh max-w-sm place-items-center p-6 text-center text-sm">
        <p>
          This claim link is incomplete. Open it from the Nuni button on your
          site.
        </p>
      </main>
    )
  }

  const { user } = await withAuth()
  if (!user) {
    redirect(
      signInUrl(dashboardPath(DASHBOARD_ROUTES.claim, { project, origin }))
    )
  }

  return <ClaimFlow project={project} origin={origin} />
}
