import { authkitProxy } from "@workos-inc/authkit-nextjs"

import { REDIRECT_URI } from "@/lib/config"

// Keeps the WorkOS session fresh on every dashboard request. Pages decide
// themselves whether they need a signed-in user.
export default authkitProxy({ redirectUri: REDIRECT_URI })

export const config = {
  // "/" is listed separately: with basePath, the catch-all does not match the bare /dashboard.
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)",
  ],
}
