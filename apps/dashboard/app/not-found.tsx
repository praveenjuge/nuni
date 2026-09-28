import Link from "next/link"

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <Link href="/" className="text-sm text-primary hover:underline">
          Go to your projects
        </Link>
      </div>
    </main>
  )
}
