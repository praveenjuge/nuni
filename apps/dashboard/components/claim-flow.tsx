"use client"

import { api } from "@nuni/backend/api"
import { useMutation, useQuery } from "convex/react"
import {
  CheckCircle2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useState } from "react"

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

type Result =
  | { step: "done"; handedOff: boolean }
  | { step: "other"; ownerName: string }
  | { step: "error"; message: string }

/**
 * Nothing is claimed or granted until the user clicks: the page first shows
 * which site and project the link is for, read-only.
 */
export function ClaimFlow({
  project,
  origin,
}: {
  project: string
  origin: string
}) {
  const { ready } = useStoreUser()
  const status = useQuery(
    api.projects.claimStatus,
    ready ? { publicId: project } : "skip"
  )
  const claim = useMutation(api.projects.claim)
  const createSession = useMutation(api.sessions.create)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      if (status?.state === "unclaimed") {
        const claimed = await claim({ publicId: project, origin })
        if (claimed.status === "claimed_by_other") {
          setResult({ step: "other", ownerName: claimed.ownerName })
          return
        }
      }
      const { token } = await createSession({
        publicId: project,
        origin,
        userAgent: navigator.userAgent,
      })
      const opener = window.opener as Window | null
      if (opener && !opener.closed) {
        // Only the site that opened this popup, at exactly this origin, can receive it.
        opener.postMessage({ type: "nuni:session", project, token }, origin)
        setResult({ step: "done", handedOff: true })
        setTimeout(() => window.close(), 1200)
      } else {
        setResult({ step: "done", handedOff: false })
      }
    } catch (error) {
      setResult({ step: "error", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const host = hostOf(origin)
  const view:
    Result | { step: "loading" } | { step: "confirm"; mine: boolean } =
    result ??
    (!ready || status === undefined
      ? { step: "loading" }
      : status.state === "other"
        ? { step: "other", ownerName: status.ownerName }
        : { step: "confirm", mine: status.state === "mine" })

  return (
    <main className="mx-auto grid min-h-svh max-w-md place-items-center p-6">
      <Card className="w-full min-w-0 [overflow-wrap:anywhere]">
        {view.step === "loading" && (
          <CardHeader>
            <CardTitle>Checking {host}…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </CardHeader>
        )}
        {view.step === "confirm" && (
          <>
            <CardHeader className="min-w-0">
              <CardTitle className="flex items-start gap-2">
                <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  {view.mine ? "Welcome back" : `Claim ${host}?`}
                </span>
              </CardTitle>
              <CardDescription>
                {view.mine ? (
                  <>
                    Allow owner tools on{" "}
                    <strong className="text-foreground">{host}</strong>?
                  </>
                ) : (
                  <>
                    You&apos;ll become the owner of the Nuni project on{" "}
                    <strong className="text-foreground">{host}</strong> and can
                    resolve and delete its comments, on the page and in the
                    dashboard. Only claim sites you control.
                  </>
                )}
              </CardDescription>
              <code className="w-fit max-w-full rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {project}
              </code>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button onClick={confirm} disabled={busy}>
                {view.mine ? "Allow on this site" : "Claim and allow"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => window.close()}
                disabled={busy}
              >
                Cancel
              </Button>
            </CardContent>
          </>
        )}
        {view.step === "done" && (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2Icon className="size-5 text-primary" /> All set
              </CardTitle>
              <CardDescription>
                {view.handedOff
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
        {view.step === "other" && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-destructive" /> Already
              claimed
            </CardTitle>
            <CardDescription>
              {host} is managed by {view.ownerName}. Ask them to resolve
              comments, or contact support if this is your site.
            </CardDescription>
          </CardHeader>
        )}
        {view.step === "error" && (
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{view.message}</CardDescription>
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
