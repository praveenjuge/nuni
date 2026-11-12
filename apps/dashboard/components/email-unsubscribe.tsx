"use client"

import { api } from "@nuni/backend/api"
import { projectRoute } from "@nuni/shared"
import { useMutation, useQuery } from "convex/react"
import { CircleCheckIcon, MailMinusIcon } from "vadivam-react"
import Link from "next/link"
import { useState } from "react"

import { FlowCard, FlowSkeleton } from "@/components/flow"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/format"

/**
 * Turn a project's emails off from the link in one. Nothing changes until
 * the person clicks: mail scanners open links too.
 */
export function EmailUnsubscribe({ token }: { token: string }) {
  const status = useQuery(api.digests.unsubscribeStatus, { token })
  const unsubscribe = useMutation(api.digests.unsubscribe)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === undefined) return <FlowSkeleton />
  if (status === null) {
    return (
      <FlowCard
        title="This link no longer works"
        description="It expired, or the project has a new owner. You can change your emails in the project's settings."
      />
    )
  }
  const settings = (
    <Link
      href={`${projectRoute(status.publicId)}/settings`}
      className="underline"
    >
      project&apos;s settings
    </Link>
  )
  if (status.off) {
    return (
      <FlowCard
        icon={CircleCheckIcon}
        title={`Emails are off for ${status.name}`}
        description={<>You can turn them back on in the {settings}.</>}
      />
    )
  }
  return (
    <FlowCard
      icon={MailMinusIcon}
      tone="foreground"
      title={`Turn off emails for ${status.name}?`}
      description={
        <>
          You&apos;ll stop getting emails about new comments on this project. To
          get them less often instead, open the {settings}.
        </>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await unsubscribe({ token })
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        Turn off emails
      </Button>
    </FlowCard>
  )
}
