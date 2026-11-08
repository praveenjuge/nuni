import { DASHBOARD_ROUTES, dashboardPath, TOKEN_PREFIX } from "@nuni/shared"
import { withAuth } from "@workos-inc/authkit-nextjs"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { TransferAccept } from "@/components/transfer-accept"
import { signInUrl } from "@/lib/config"

export const metadata: Metadata = { title: "Accept a project" }

export default async function Page(props: PageProps<"/transfer">) {
  const params = await props.searchParams
  const token = typeof params.token === "string" ? params.token.trim() : ""

  if (!token.startsWith(TOKEN_PREFIX.transfer)) {
    return (
      <main className="mx-auto grid min-h-svh max-w-sm place-items-center p-6 text-center text-sm">
        <p>This transfer link is incomplete. Ask the owner to send it again.</p>
      </main>
    )
  }

  const { user } = await withAuth()
  if (!user) {
    redirect(signInUrl(dashboardPath(DASHBOARD_ROUTES.transfer, { token })))
  }

  return <TransferAccept token={token} />
}
