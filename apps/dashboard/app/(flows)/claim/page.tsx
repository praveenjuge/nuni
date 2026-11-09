import { DASHBOARD_ROUTES } from "@nuni/shared"
import type { Metadata } from "next"

import { ClaimFlow } from "@/components/claim-flow"
import { IncompleteLink } from "@/components/flow"
import { popupParams, signedInFlow } from "@/lib/flow-page"

export const metadata: Metadata = { title: "Claim this site" }

export default async function Page(props: PageProps<"/claim">) {
  const link = popupParams(await props.searchParams)
  if (!link) {
    return (
      <IncompleteLink>
        This claim link is incomplete. Open it from the Nuni button on your
        site.
      </IncompleteLink>
    )
  }
  return signedInFlow(DASHBOARD_ROUTES.claim, link, <ClaimFlow {...link} />)
}
