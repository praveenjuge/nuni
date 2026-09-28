import { signOut } from "@workos-inc/authkit-nextjs"

import { APP_URL, BASE_PATH } from "@/lib/config"

export async function GET() {
  await signOut({ returnTo: `${APP_URL}${BASE_PATH}` })
}
