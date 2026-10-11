import { isProjectId } from "@nuni/shared"
import { withAuth } from "@workos-inc/authkit-nextjs"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CommentSignIn } from "@/components/comment-sign-in"
import { APP_URL } from "@/lib/config"
import { cleanOrigin } from "@/lib/format"

export const metadata: Metadata = { title: "Sign in to comment" }

/** Opened by the widget's "Sign in with GitHub" button, in a popup. */
export default async function Page(props: PageProps<"/comment-sign-in">) {
  const params = await props.searchParams
  const project = typeof params.project === "string" ? params.project : ""
  const origin = cleanOrigin(
    typeof params.origin === "string" ? params.origin : undefined
  )

  if (!isProjectId(project) || !origin) {
    return (
      <main className="mx-auto grid min-h-svh max-w-sm place-items-center p-6 text-center text-sm">
        <p>
          This sign-in link is incomplete. Open it from the Nuni comments on the
          site.
        </p>
      </main>
    )
  }

  const { user } = await withAuth()
  if (!user) {
    const returnTo = `/dashboard/comment-sign-in?project=${encodeURIComponent(project)}&origin=${encodeURIComponent(origin)}`
    redirect(
      `${APP_URL}/dashboard/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    )
  }

  return <CommentSignIn project={project} origin={origin} />
}
