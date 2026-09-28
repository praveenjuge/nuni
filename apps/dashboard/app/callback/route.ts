import { handleAuth } from "@workos-inc/authkit-nextjs"

import { APP_URL, BASE_PATH } from "@/lib/config"

// baseURL keeps the redirect (and the session cookie) on the public domain
// even though requests arrive through the docs-site rewrite.
export const GET = handleAuth({ returnPathname: BASE_PATH, baseURL: APP_URL })
