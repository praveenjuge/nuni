import { DASHBOARD_ROUTES } from "@nuni/shared"
import type { Metadata } from "next"

import { CommentSignIn } from "@/components/comment-sign-in"
import { IncompleteLink } from "@/components/flow"
import { popupParams, signedInFlow } from "@/lib/flow-page"

export const metadata: Metadata = { title: "Sign in to comment" }

/** Opened by the widget's "Sign in with GitHub" button, in a popup. */
export default async function Page(props: PageProps<"/comment-sign-in">) {
  const link = popupParams(await props.searchParams)
  if (!link) {
    return (
      <IncompleteLink>
        This sign-in link is incomplete. Open it from the Nuni comments on the
        site.
      </IncompleteLink>
    )
  }
  return signedInFlow(
    DASHBOARD_ROUTES.commentSignIn,
    link,
    <CommentSignIn {...link} />
  )
}
