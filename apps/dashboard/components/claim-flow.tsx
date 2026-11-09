"use client"

import { api } from "@nuni/backend/api"
import { handoffMessage, projectRoute } from "@nuni/shared"
import { useMutation, useQuery } from "convex/react"
import {
  CircleCheckIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "vadivam-react"
import Link from "next/link"

import { FlowCard, useFlowStep } from "@/components/flow"
import { Button, buttonVariants } from "@/components/ui/button"
import { hostOf } from "@/lib/format"
import { handOff } from "@/lib/handoff"

type Result =
  { step: "done"; handedOff: boolean } | { step: "other"; ownerName: string }

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
  const status = useQuery(api.projects.claimStatus, { publicId: project })
  const allowOwnerTools = useMutation(api.sessions.allowOwnerTools)
  const { result, busy, run } = useFlowStep<Result>()
  const host = hostOf(origin)

  const confirm = () =>
    run(async () => {
      const allowed = await allowOwnerTools({
        publicId: project,
        origin,
        userAgent: navigator.userAgent,
      })
      if (allowed.status === "claimed_by_other") {
        return { step: "other", ownerName: allowed.ownerName }
      }
      const message = handoffMessage("session", project, allowed.token)
      return { step: "done", handedOff: handOff(origin, message) }
    })

  const view =
    result ??
    (status === undefined
      ? ({ step: "loading" } as const)
      : status.state === "other"
        ? ({ step: "other", ownerName: status.ownerName } as const)
        : ({ step: "confirm", mine: status.state === "mine" } as const))

  switch (view.step) {
    case "loading":
      return <FlowCard title={`Checking ${host}…`} description="One moment." />
    case "confirm":
      return (
        <FlowCard
          icon={ShieldCheckIcon}
          title={view.mine ? "Welcome back" : `Claim ${host}?`}
          description={
            view.mine ? (
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
            )
          }
        >
          <code className="w-fit max-w-full rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {project}
          </code>
          <div className="grid gap-2">
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
          </div>
        </FlowCard>
      )
    case "done":
      return (
        <FlowCard
          icon={CircleCheckIcon}
          title="All set"
          description={
            view.handedOff
              ? `You're signed in as the owner on ${host}. This window will close.`
              : `Go back to ${host} and open Nuni again, or manage comments from the dashboard.`
          }
        >
          <Link
            className={buttonVariants({
              variant: "outline",
              className: "w-fit",
            })}
            href={projectRoute(project)}
          >
            Open dashboard
          </Link>
        </FlowCard>
      )
    case "other":
      return (
        <FlowCard
          icon={TriangleAlertIcon}
          tone="destructive"
          title="Already claimed"
          description={`${host} is managed by ${view.ownerName}. Ask them to resolve comments, or to transfer the project to you from its settings if this is your site.`}
        />
      )
    case "error":
      return (
        <FlowCard title="Something went wrong" description={view.message} />
      )
  }
}
