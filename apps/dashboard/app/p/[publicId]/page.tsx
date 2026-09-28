import { withAuth } from "@workos-inc/authkit-nextjs"
import type { Metadata } from "next"

import { ProjectView } from "@/components/project-view"
import { SignedOut } from "@/components/signed-out"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = { title: "Project" }

export default async function Page(props: PageProps<"/p/[publicId]">) {
  const { publicId } = await props.params
  const { user } = await withAuth()
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email : null
  return (
    <>
      <SiteHeader user={user && name ? { name, avatarUrl: user.profilePictureUrl } : null} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        {user ? <ProjectView publicId={publicId} /> : <SignedOut returnTo={`/dashboard/p/${publicId}`} />}
      </main>
    </>
  )
}
