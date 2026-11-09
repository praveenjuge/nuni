import { DASHBOARD_ROUTES, isProjectId } from "@nuni/shared"
import type { Metadata } from "next"

import { CommentSignIn } from "@/components/comment-sign-in"
import { IncompleteLink } from "@/components/flow"
import { queryParam, signedInFlow } from "@/lib/auth"
import { cleanOrigin } from "@/lib/format"

export const metadata: Metadata = { title: "Sign in to comment" }

/** Opened by the widget's "Sign in with GitHub" button, in a popup. */
export default async function Page(props: PageProps<"/comment-sign-in">) {
  const params = await props.searchParams
  const project = queryParam(params, "project")
  const origin = cleanOrigin(queryParam(params, "origin"))
  if (!isProjectId(project) || !origin) {
    return (
      <IncompleteLink>
        This sign-in link is incomplete. Open it from the Nuni comments on the
        site.
      </IncompleteLink>
    )
  }
  return signedInFlow(
    DASHBOARD_ROUTES.commentSignIn,
    { project, origin },
    <CommentSignIn project={project} origin={origin} />
  )
}
