import {
  cliCommand,
  DASHBOARD_ROUTES,
  isUserCode,
  normalizeUserCode,
} from "@nuni/shared"
import type { Metadata } from "next"

import { CliApprove } from "@/components/cli-approve"
import { IncompleteLink } from "@/components/flow"
import { queryParam, signedInFlow } from "@/lib/auth"

export const metadata: Metadata = { title: "Sign in the Nuni CLI" }

export default async function Page(props: PageProps<"/cli">) {
  const code = normalizeUserCode(queryParam(await props.searchParams, "code"))
  if (!isUserCode(code)) {
    return (
      <IncompleteLink>
        This sign-in link is incomplete. Run{" "}
        <code className="font-mono">{cliCommand("login")}</code> and open the
        link it prints.
      </IncompleteLink>
    )
  }
  return signedInFlow(
    DASHBOARD_ROUTES.cli,
    { code },
    <CliApprove code={code} />
  )
}
