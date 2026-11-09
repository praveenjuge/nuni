import { signOut } from "@workos-inc/authkit-nextjs"

import { appUrl } from "@/lib/config"

export async function GET() {
  await signOut({ returnTo: appUrl() })
}
