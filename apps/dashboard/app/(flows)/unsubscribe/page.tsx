import { TOKEN_PREFIX } from "@nuni/shared"
import type { Metadata } from "next"

import { EmailUnsubscribe } from "@/components/email-unsubscribe"
import { IncompleteLink } from "@/components/flow"
import { queryParam } from "@/lib/flow-page"

export const metadata: Metadata = { title: "Turn off emails" }

/** No sign-in: the link from the email is enough to turn its emails off. */
export default async function Page(props: PageProps<"/unsubscribe">) {
  const token = queryParam(await props.searchParams, "token").trim()
  if (!token.startsWith(TOKEN_PREFIX.unsubscribe)) {
    return (
      <IncompleteLink>
        This link is incomplete. Open it from the email again, or change your
        emails in the project&apos;s settings.
      </IncompleteLink>
    )
  }
  return <EmailUnsubscribe token={token} />
}
