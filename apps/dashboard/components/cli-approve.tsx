"use client"

import { api } from "@nuni/backend/api"
import { cliCommand, projectRoute } from "@nuni/shared"
import { useMutation, useQuery } from "convex/react"
import {
  CircleCheckIcon,
  CircleXIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "vadivam-react"
import Link from "next/link"

import { FlowCard, useFlowStep } from "@/components/flow"
import { Button, buttonVariants } from "@/components/ui/button"

type Done = { step: "approved"; publicId: string } | { step: "denied" }

const UNUSABLE = {
  approved: "It was already approved.",
  denied: "It was denied.",
  expired: `It has expired or does not exist. Run ${cliCommand("login")} again for a new one.`,
  signed_out: "Sign in first.",
}

/**
 * Approves a `nuni login` from a terminal. Nothing is granted until the
 * person checks that the code matches their terminal and clicks Allow.
 */
export function CliApprove({ code }: { code: string }) {
  const login = useQuery(api.cliAuth.pending, { userCode: code })
  const approve = useMutation(api.cliAuth.approve)
  const deny = useMutation(api.cliAuth.deny)
  const { result, busy, run } = useFlowStep<Done>()

  if (result?.step === "approved") {
    return (
      <FlowCard
        icon={CircleCheckIcon}
        title="Terminal signed in"
        description="Go back to your terminal. You can close this tab. Sign it out any time from the project settings."
      >
        <Link
          className={buttonVariants({ variant: "outline", className: "w-fit" })}
          href={projectRoute(result.publicId)}
        >
          Open dashboard
        </Link>
      </FlowCard>
    )
  }
  if (result?.step === "denied") {
    return (
      <FlowCard
        icon={CircleXIcon}
        tone="muted"
        title="Denied"
        description="The terminal was not signed in."
      />
    )
  }
  if (result?.step === "error") {
    return (
      <FlowCard title="Something went wrong" description={result.message} />
    )
  }
  if (login === undefined) {
    return <FlowCard title="Checking the code…" description="One moment." />
  }
  if (login.state !== "pending") {
    return (
      <FlowCard
        icon={TriangleAlertIcon}
        tone="destructive"
        title="This code can't be used"
        description={UNUSABLE[login.state]}
      />
    )
  }
  if (login.access === "other") {
    return (
      <FlowCard
        icon={TriangleAlertIcon}
        tone="destructive"
        title="Not your project"
        description={`${login.projectName} is managed by ${login.ownerName ?? "someone else"}. Only its owner can sign a terminal in to it.`}
      />
    )
  }

  const { publicId } = login
  return (
    <FlowCard
      icon={TerminalIcon}
      title="Sign in a terminal?"
      description={
        <>
          {login.client} wants to read, reply to and resolve comments on{" "}
          <strong className="text-foreground">{login.projectName}</strong>
          {login.access === "unclaimed"
            ? ". Nobody owns this project yet, so you'll claim it too."
            : "."}{" "}
          Only continue if you started this yourself.
        </>
      }
    >
      <div className="grid gap-1 rounded-lg border p-3 text-center">
        <span className="text-xs text-muted-foreground">
          Check that your terminal shows this code
        </span>
        <span className="font-mono text-2xl tracking-widest">{code}</span>
      </div>
      <code className="w-fit max-w-full rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
        {publicId}
      </code>
      <div className="grid gap-2">
        <Button
          onClick={() =>
            run(async () => {
              await approve({ userCode: code })
              return { step: "approved", publicId }
            })
          }
          disabled={busy}
        >
          {login.access === "unclaimed" ? "Claim and allow" : "Allow"}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            run(async () => {
              await deny({ userCode: code })
              return { step: "denied" }
            })
          }
          disabled={busy}
        >
          Deny
        </Button>
      </div>
    </FlowCard>
  )
}
