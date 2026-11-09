"use client"

import { api } from "@nuni/backend/api"
import { handoffMessage } from "@nuni/shared"
import { useMutation } from "convex/react"
import { CircleCheckIcon } from "vadivam-react"

import { FlowCard, useFlowStep } from "@/components/flow"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useMe } from "@/components/user"
import { hostOf, initials } from "@/lib/format"
import { handOff } from "@/lib/handoff"

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
  const me = useMe()
  const create = useMutation(api.commenters.create)
  const { result, busy, run } = useFlowStep<{
    step: "done"
    handedOff: boolean
  }>()
  const host = hostOf(origin)

  const confirm = () =>
    run(async () => {
      const { token } = await create({ publicId: project, origin })
      const message = handoffMessage("commenter", project, token)
      return { step: "done", handedOff: handOff(origin, message) }
    })

  if (!result) {
    return (
      <FlowCard
        media={
          <Avatar>
            {me.avatarUrl ? <AvatarImage src={me.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials(me.name)}</AvatarFallback>
          </Avatar>
        }
        title={`Comment on ${host} as ${me.name}?`}
        description={
          <>
            Your name and photo show on the comments you leave on{" "}
            <strong className="text-foreground">{host}</strong>, and you can
            edit them from any browser. Sign out from the comments panel any
            time.
          </>
        }
      >
        <div className="grid gap-2">
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
        </div>
      </FlowCard>
    )
  }
  if (result.step === "error") {
    return (
      <FlowCard title="Couldn't sign you in" description={result.message} />
    )
  }
  return (
    <FlowCard
      icon={CircleCheckIcon}
      title="You're signed in"
      description={
        result.handedOff
          ? `Go ahead and comment on ${host}. This window will close.`
          : `Go back to ${host} and sign in from the comments again.`
      }
    />
  )
}
