import { withAuth } from "@workos-inc/authkit-nextjs"

import { ProjectsList } from "@/components/projects-list"
import { SignedOut } from "@/components/signed-out"
import { SiteHeader } from "@/components/site-header"

export default async function Page() {
  const { user } = await withAuth()
  const name = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    : null
  return (
    <>
      <SiteHeader
        user={user && name ? { name, avatarUrl: user.profilePictureUrl } : null}
      />
      <main className="mx-auto max-w-5xl px-4 py-10">
        {user ? <ProjectsList /> : <SignedOut />}
      </main>
    </>
  )
}
