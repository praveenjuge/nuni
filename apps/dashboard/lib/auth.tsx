import { withAuth } from "@workos-inc/authkit-nextjs"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { FlowSkeleton } from "@/components/flow"
import { SignedIn } from "@/components/user"
import { signInUrl } from "@/lib/config"

/**
 * A one-step flow page for a signed-in person. Anyone else is sent to sign
 * in and back to `route` with `query` first. (AuthKit's `ensureSignedIn`
 * can't do this from a page: it sets a cookie, which pages may not.)
 */
export async function signedInFlow(
  route: string,
  query: Record<string, string>,
  page: ReactNode
) {
  const { user } = await withAuth()
  if (!user) redirect(signInUrl(route, query))
  return <SignedIn fallback={<FlowSkeleton />}>{page}</SignedIn>
}

/** One query parameter; "" when it is missing or repeated. */
export function queryParam(
  params: Record<string, string | string[] | undefined>,
  name: string
): string {
  const value = params[name]
  return typeof value === "string" ? value : ""
}
