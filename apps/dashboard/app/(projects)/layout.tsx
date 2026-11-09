import { withAuth } from "@workos-inc/authkit-nextjs"

import { SignedOut } from "@/components/signed-out"
import { SiteHeader } from "@/components/site-header"
import { Skeleton } from "@/components/ui/skeleton"
import { SignedIn } from "@/components/user"

/** The owner's pages: their projects, each project's comments and settings. */
export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = await withAuth()
  return (
    <>
      <SiteHeader email={user?.email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        {user ? (
          <SignedIn fallback={<Skeleton className="h-72 rounded-3xl" />}>
            {children}
          </SignedIn>
        ) : (
          <SignedOut />
        )}
      </main>
    </>
  )
}
