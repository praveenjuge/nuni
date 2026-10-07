import Link from "next/link"

import { FlowShell } from "@/components/flow-shell"
import { buttonVariants } from "@/components/ui/button"

export default function NotFound() {
  return (
    <FlowShell>
      <div className="grid justify-items-center gap-4 text-center">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Page not found
          </h1>
          <p className="text-sm text-muted-foreground">
            The link may be old, or the page has moved.
          </p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Go to your projects
        </Link>
      </div>
    </FlowShell>
  )
}
