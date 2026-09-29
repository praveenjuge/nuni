import { getSignInUrl } from "@workos-inc/authkit-nextjs"
import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"

import { safeReturnTo } from "@/lib/config"

/** Starts the hosted AuthKit flow, including email verification for new users. */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"))
  redirect(await getSignInUrl({ returnTo }))
}
