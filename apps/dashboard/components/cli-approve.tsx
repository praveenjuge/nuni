"use client"

import { api } from "@nuni/backend/api"
import { useMutation, useQuery } from "convex/react"
import {
  CheckCircle2Icon,
  TerminalIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react"
import { useState } from "react"

import { FlowShell } from "@/components/flow-shell"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useStoreUser } from "@/components/use-store-user"

type Done =
  | { step: "approved"; publicId: string }
  | { step: "denied" }
  | { step: "error"; message: string }

/**
 * Approves a `nuni login` from a terminal. Nothing is granted until the
 * person checks that the code matches their terminal and clicks Allow.
 */
export function CliApprove({ code }: { code: string }) {
  const { ready } = useStoreUser()
  const login = useQuery(
    api.cliAuth.pending,
    ready ? { userCode: code } : "skip"
  )
  const approve = useMutation(api.cliAuth.approve)
  const deny = useMutation(api.cliAuth.deny)
  const [done, setDone] = useState<Done | null>(null)
  const [busy, setBusy] = useState(false)

  async function act(allow: boolean, publicId: string) {
    setBusy(true)
    try {
      if (allow) await approve({ userCode: code })
      else await deny({ userCode: code })
      setDone(allow ? { step: "approved", publicId } : { step: "denied" })
    } catch (error) {
      setDone({ step: "error", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <FlowShell>
      <Card className="w-full min-w-0 [overflow-wrap:anywhere]">
        {done?.step === "approved" ? (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2Icon className="size-5 text-primary" /> Terminal
                signed in
              </CardTitle>
              <CardDescription>
                Go back to your terminal. You can close this tab. Sign it out
                any time from the project settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                className={buttonVariants({ variant: "outline" })}
                href={`/dashboard/p/${done.publicId}`}
              >
                Open dashboard
              </a>
            </CardContent>
          </>
        ) : done?.step === "denied" ? (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircleIcon className="size-5 text-muted-foreground" /> Denied
            </CardTitle>
            <CardDescription>The terminal was not signed in.</CardDescription>
          </CardHeader>
        ) : done ? (
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{done.message}</CardDescription>
          </CardHeader>
        ) : !ready || login === undefined ? (
          <CardHeader>
            <CardTitle>Checking the code…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </CardHeader>
        ) : login.state !== "pending" ? (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-destructive" /> This
              code can&apos;t be used
            </CardTitle>
            <CardDescription>
              {login.state === "approved"
                ? "It was already approved."
                : login.state === "denied"
                  ? "It was denied."
                  : "It has expired or does not exist. Run nuni login again for a new one."}
            </CardDescription>
          </CardHeader>
        ) : login.access === "other" ? (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-destructive" /> Not your
              project
            </CardTitle>
            <CardDescription>
              {login.projectName} is managed by{" "}
              {login.ownerName ?? "someone else"}. Only its owner can sign a
              terminal in to it.
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader className="min-w-0">
              <CardTitle className="flex items-start gap-2">
                <TerminalIcon className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="min-w-0">Sign in a terminal?</span>
              </CardTitle>
              <CardDescription>
                {login.client} wants to read, reply to and resolve comments on{" "}
                <strong className="text-foreground">{login.projectName}</strong>
                {login.access === "unclaimed"
                  ? ". Nobody owns this project yet, so you'll claim it too."
                  : "."}{" "}
                Only continue if you started this yourself.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1 rounded-lg border p-3 text-center">
                <span className="text-xs text-muted-foreground">
                  Check that your terminal shows this code
                </span>
                <span className="font-mono text-2xl tracking-widest">
                  {code}
                </span>
              </div>
              <code className="w-fit max-w-full rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {login.publicId}
              </code>
              <div className="grid gap-2">
                <Button
                  onClick={() => act(true, login.publicId)}
                  disabled={busy}
                >
                  {login.access === "unclaimed" ? "Claim and allow" : "Allow"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => act(false, login.publicId)}
                  disabled={busy}
                >
                  Deny
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </FlowShell>
  )
}

function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data
  return (
    data?.message ??
    (error instanceof Error ? error.message : "Please try again.")
  )
}
