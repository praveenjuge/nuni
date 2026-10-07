import type { ReactNode } from "react"

import { Logo } from "@/components/logo"

/** A centered page for one-step flows: claiming a site, signing in the CLI, accepting a transfer. */
export function FlowShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-md content-center justify-items-center gap-8 p-6">
      <Logo />
      {children}
    </main>
  )
}
