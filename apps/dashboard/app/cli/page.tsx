import { isUserCode } from "@nuni/shared"
import { withAuth } from "@workos-inc/authkit-nextjs"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CliApprove } from "@/components/cli-approve"
import { APP_URL } from "@/lib/config"

export const metadata: Metadata = { title: "Sign in the Nuni CLI" }

export default async function Page(props: PageProps<"/cli">) {
  const params = await props.searchParams
  const code =
    typeof params.code === "string" ? params.code.trim().toUpperCase() : ""

  if (!isUserCode(code)) {
    return (
      <main className="mx-auto grid min-h-svh max-w-sm place-items-center p-6 text-center text-sm">
        <p>
          This sign-in link is incomplete. Run{" "}
          <code className="font-mono">npx @nuniapp/cli@latest login</code> and
          open the link it prints.
        </p>
      </main>
    )
  }

  const { user } = await withAuth()
  if (!user) {
    const returnTo = `/dashboard/cli?code=${encodeURIComponent(code)}`
    redirect(
      `${APP_URL}/dashboard/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    )
  }

  return <CliApprove code={code} />
}
