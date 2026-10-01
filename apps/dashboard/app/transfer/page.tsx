import { withAuth } from "@workos-inc/authkit-nextjs"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { TransferAccept } from "@/components/transfer-accept"
import { APP_URL } from "@/lib/config"

export const metadata: Metadata = { title: "Accept a project" }

export default async function Page(props: PageProps<"/transfer">) {
  const params = await props.searchParams
  const token = typeof params.token === "string" ? params.token.trim() : ""

  if (!token.startsWith("nuni_t_")) {
    return (
      <main className="mx-auto grid min-h-svh max-w-sm place-items-center p-6 text-center text-sm">
        <p>This transfer link is incomplete. Ask the owner to send it again.</p>
      </main>
    )
  }

  const { user } = await withAuth()
  if (!user) {
    const returnTo = `/dashboard/transfer?token=${encodeURIComponent(token)}`
    redirect(
      `${APP_URL}/dashboard/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    )
  }

  return <TransferAccept token={token} />
}
