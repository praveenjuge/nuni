"use client"

import { useState, type ComponentType, type ReactNode } from "react"

import { Logo } from "@/components/logo"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/format"

/** A centered page for one step: a claim, a sign-in, a transfer, a 404. */
export function FlowShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-md content-center justify-items-center gap-8 p-6">
      <Logo />
      {children}
    </main>
  )
}

const TONES = {
  primary: "text-primary",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  foreground: "text-foreground",
}

/** One state of a flow: what is happening, and what the person can do. */
export function FlowCard({
  icon: Icon,
  tone = "primary",
  media,
  title,
  description,
  children,
}: {
  icon?: ComponentType<{ className?: string }>
  tone?: keyof typeof TONES
  /** Shown in place of the icon, such as an avatar. */
  media?: ReactNode
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <Card className="w-full min-w-0 [overflow-wrap:anywhere]">
      <CardHeader className="min-w-0">
        <div className="flex items-center gap-2">
          {media ??
            (Icon && <Icon className={`size-5 shrink-0 ${TONES[tone]}`} />)}
          <CardTitle className="min-w-0">{title}</CardTitle>
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children && <CardContent className="grid gap-3">{children}</CardContent>}
    </Card>
  )
}

export function FlowSkeleton() {
  return (
    <Card className="w-full">
      <CardContent className="py-6">
        <Skeleton className="h-24" />
      </CardContent>
    </Card>
  )
}

/** A flow link that is missing what it needs, and where to get a good one. */
export function IncompleteLink({ children }: { children: ReactNode }) {
  return <p className="max-w-sm text-center text-sm">{children}</p>
}

export type FlowError = { step: "error"; message: string }

/**
 * The person's one action in a flow: `run` it, then show `result`, or the
 * error it failed with.
 */
export function useFlowStep<T>() {
  const [result, setResult] = useState<T | FlowError | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<T>) {
    setBusy(true)
    try {
      setResult(await action())
    } catch (error) {
      setResult({ step: "error", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }
  return { result, busy, run }
}
