"use client"

import { api } from "@nuni/backend/api"
import { useAction, useMutation, useQuery } from "convex/react"
import { CircleCheckIcon } from "vadivam-react"
import { useEffect, useState } from "react"

import { FlowShell } from "@/components/flow-shell"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useStoreUser } from "@/components/use-store-user"
import { errorMessage, hostOf, initials } from "@/lib/format"

type Result =
  { step: "done"; handedOff: boolean } | { step: "error"; message: string }

/**
 * Signs a visitor in to comment under their account on one site. Nothing is
 * handed to the site until they click Continue.
 */
export function CommentSignIn({
  project,
  origin,
}: {
  project: string
  origin: string
}) {
  const { ready } = useStoreUser()
  const refreshProfile = useAction(api.users.refreshProfile)
  const [profileReady, setProfileReady] = useState(false)
  // The name and photo go on their comments, so read them fresh first.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void refreshProfile({})
      .catch(() => null)
      .then(() => !cancelled && setProfileReady(true))
    return () => {
      cancelled = true
    }
  }, [ready, refreshProfile])
  const me = useQuery(api.users.me, profileReady ? {} : "skip")
  const create = useMutation(api.commenters.create)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const host = hostOf(origin)

  async function confirm() {
    setBusy(true)
    try {
      const { token } = await create({ publicId: project, origin })
      const opener = window.opener as Window | null
      if (opener && !opener.closed) {
        // The server checked that this origin belongs to the project.
        opener.postMessage({ type: "nuni:commenter", project, token }, origin)
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

  return (
    <FlowShell>
      <Card className="w-full min-w-0 [overflow-wrap:anywhere]">
        {!result && !me && (
          <CardHeader>
            <CardTitle>Signing you in…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </CardHeader>
        )}
        {!result && me && (
          <>
            <CardHeader className="min-w-0">
              <div className="flex items-center gap-3">
                <Avatar>
                  {me.avatarUrl ? (
                    <AvatarImage src={me.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback>{initials(me.name)}</AvatarFallback>
                </Avatar>
                <CardTitle className="min-w-0">
                  Comment on {host} as {me.name}?
                </CardTitle>
              </div>
              <CardDescription>
                Your name and photo show on the comments you leave on{" "}
                <strong className="text-foreground">{host}</strong>, and you can
                edit them from any browser. Sign out from the comments panel any
                time.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button onClick={confirm} disabled={busy}>
                Continue
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
        {result?.step === "done" && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheckIcon className="size-5 text-primary" /> You&apos;re
              signed in
            </CardTitle>
            <CardDescription>
              {result.handedOff
                ? `Go ahead and comment on ${host}. This window will close.`
                : `Go back to ${host} and sign in from the comments again.`}
            </CardDescription>
          </CardHeader>
        )}
        {result?.step === "error" && (
          <CardHeader>
            <CardTitle>Couldn&apos;t sign you in</CardTitle>
            <CardDescription>{result.message}</CardDescription>
          </CardHeader>
        )}
      </Card>
    </FlowShell>
  )
}
