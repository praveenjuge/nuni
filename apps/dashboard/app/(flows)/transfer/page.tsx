import { DASHBOARD_ROUTES, TOKEN_PREFIX } from "@nuni/shared"
import type { Metadata } from "next"

import { IncompleteLink } from "@/components/flow"
import { TransferAccept } from "@/components/transfer-accept"
import { queryParam, signedInFlow } from "@/lib/auth"

export const metadata: Metadata = { title: "Accept a project" }

export default async function Page(props: PageProps<"/transfer">) {
  const token = queryParam(await props.searchParams, "token").trim()
  if (!token.startsWith(TOKEN_PREFIX.transfer)) {
    return (
      <IncompleteLink>
        This transfer link is incomplete. Ask the owner to send it again.
      </IncompleteLink>
    )
  }
  return signedInFlow(
    DASHBOARD_ROUTES.transfer,
    { token },
    <TransferAccept token={token} />
  )
}
