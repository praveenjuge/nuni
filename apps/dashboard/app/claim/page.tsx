import { isProjectId } from "@nuni/shared"
import { withAuth } from "@workos-inc/authkit-nextjs"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ClaimFlow } from "@/components/claim-flow"
import { APP_URL } from "@/lib/config"

export const metadata: Metadata = { title: "Claim this site" }

function cleanOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null
  } catch {
    return null
  }
}

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
    const returnTo = `/dashboard/claim?project=${encodeURIComponent(project)}&origin=${encodeURIComponent(origin)}`
    redirect(
      `${APP_URL}/dashboard/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    )
  }

  return <ClaimFlow project={project} origin={origin} />
}
