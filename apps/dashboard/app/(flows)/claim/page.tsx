import { DASHBOARD_ROUTES, isProjectId } from "@nuni/shared"
import type { Metadata } from "next"

import { ClaimFlow } from "@/components/claim-flow"
import { IncompleteLink } from "@/components/flow"
import { queryParam, signedInFlow } from "@/lib/auth"
import { cleanOrigin } from "@/lib/format"

export const metadata: Metadata = { title: "Claim this site" }

export default async function Page(props: PageProps<"/claim">) {
  const params = await props.searchParams
  const project = queryParam(params, "project")
  const origin = cleanOrigin(queryParam(params, "origin"))
  if (!isProjectId(project) || !origin) {
    return (
      <IncompleteLink>
        This claim link is incomplete. Open it from the Nuni button on your
        site.
      </IncompleteLink>
    )
  }
  return signedInFlow(
    DASHBOARD_ROUTES.claim,
    { project, origin },
    <ClaimFlow project={project} origin={origin} />
  )
}
