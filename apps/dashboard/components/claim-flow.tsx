"use client"

import { api } from "@nuni/backend/api"
import { useMutation } from "convex/react"
import {
  CheckCircle2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useStoreUser } from "@/components/use-store-user"
import { hostOf } from "@/lib/format"

type State =
  | { step: "loading" }
  | { step: "confirm"; claimedNow: boolean }
  | { step: "done"; handedOff: boolean }
  | { step: "other"; ownerName: string }
  | { step: "error"; message: string }

export function ClaimFlow({
  project,
  origin,
}: {
  project: string
  origin: string
}) {
  const { ready } = useStoreUser()
  const claim = useMutation(api.projects.claim)
  const createSession = useMutation(api.sessions.create)
  const [state, setState] = useState<State>({ step: "loading" })
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    claim({ publicId: project, origin })
      .then((result) => {
        if (result.status === "claimed_by_other")
          setState({ step: "other", ownerName: result.ownerName })
        else
          setState({ step: "confirm", claimedNow: result.status === "claimed" })
      })
      .catch((error: unknown) =>
        setState({ step: "error", message: errorMessage(error) })
      )
  }, [ready, claim, project, origin])

  async function allow() {
    setBusy(true)
    try {
      const { token } = await createSession({
        publicId: project,
        origin,
        userAgent: navigator.userAgent,
      })
      const opener = window.opener as Window | null
      if (opener && !opener.closed) {
        // Only the site that opened this popup, at exactly this origin, can receive it.
        opener.postMessage({ type: "nuni:session", project, token }, origin)
        setState({ step: "done", handedOff: true })
        setTimeout(() => window.close(), 1200)
      } else {
        setState({ step: "done", handedOff: false })
      }
    } catch (error) {
      setState({ step: "error", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const host = hostOf(origin)
  return (
    <main className="mx-auto grid min-h-svh max-w-md place-items-center p-6">
      <Card className="w-full">
        {state.step === "loading" && (
          <CardHeader>
            <CardTitle>Checking {host}…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </CardHeader>
        )}
        {state.step === "confirm" && (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheckIcon className="size-5 text-primary" />
                {state.claimedNow ? "You own this site now" : "Welcome back"}
              </CardTitle>
              <CardDescription>
                Allow owner tools on{" "}
                <strong className="text-foreground">{host}</strong>? You&apos;ll
                be able to resolve and delete comments right on the page. Only
                allow sites you control.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={allow} disabled={busy}>
                Allow on {host}
              </Button>
              <a
                className={buttonVariants({ variant: "ghost" })}
                href={`/dashboard/p/${project}`}
              >
                Open dashboard
              </a>
            </CardContent>
          </>
        )}
        {state.step === "done" && (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2Icon className="size-5 text-primary" /> All set
              </CardTitle>
              <CardDescription>
                {state.handedOff
                  ? `You're signed in as the owner on ${host}. This window will close.`
                  : `Go back to ${host} and open Nuni again, or manage comments from the dashboard.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                className={buttonVariants({ variant: "outline" })}
                href={`/dashboard/p/${project}`}
              >
                Open dashboard
              </a>
            </CardContent>
          </>
        )}
        {state.step === "other" && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-destructive" /> Already
              claimed
            </CardTitle>
            <CardDescription>
              {host} is managed by {state.ownerName}. Ask them to resolve
              comments, or contact support if this is your site.
            </CardDescription>
          </CardHeader>
        )}
        {state.step === "error" && (
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </CardHeader>
        )}
      </Card>
    </main>
  )
}

function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data
  return (
    data?.message ??
    (error instanceof Error ? error.message : "Please try again.")
  )
}
