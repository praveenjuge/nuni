import { withAuth } from "@workos-inc/authkit-nextjs"

import { ProjectsList } from "@/components/projects-list"
import { SignedOut } from "@/components/signed-out"
import { SiteHeader } from "@/components/site-header"

export default async function Page() {
  const { user } = await withAuth()
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        {user ? <ProjectsList /> : <SignedOut />}
      </main>
    </>
  )
}
