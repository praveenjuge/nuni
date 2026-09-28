import { getSignInUrl } from "@workos-inc/authkit-nextjs"
import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"

import { safeReturnTo } from "@/lib/config"

/**
 * Starts sign-in. We use the AuthKit flow (PKCE + state cookie) but point it
 * straight at GitHub, so there is no intermediate AuthKit screen.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"))
  const url = new URL(await getSignInUrl({ returnTo }))
  if (process.env.NUNI_AUTH_PROVIDER !== "authkit") {
    url.searchParams.set("provider", "GitHubOAuth")
  }
  redirect(url.toString())
}
