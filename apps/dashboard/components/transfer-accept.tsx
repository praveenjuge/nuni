"use client"

import { api } from "@nuni/backend/api"
import { projectRoute } from "@nuni/shared"
import { useMutation, useQuery } from "convex/react"
import { ArrowRightLeftIcon } from "vadivam-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { FlowCard, FlowSkeleton } from "@/components/flow"
import { Button } from "@/components/ui/button"
import { errorMessage, plural, timeLeft } from "@/lib/format"

/** The recipient's side of a project transfer. */
export function TransferAccept({ token }: { token: string }) {
  const transfer = useQuery(api.transfers.get, { token })
  const accept = useMutation(api.transfers.accept)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (transfer === undefined) return <FlowSkeleton />
  if (transfer === null) {
    return (
      <FlowCard
        title="This link no longer works"
        description="It expired, was used, or the owner cancelled it. Ask them for a new one."
      />
    )
  }
  if (transfer.isOwner) {
    return (
      <FlowCard
        title={`You own ${transfer.name}`}
        description={
          <>
            Send this link to the person who should take it over.{" "}
            <Link href={projectRoute(transfer.publicId)} className="underline">
              Open the project
            </Link>
          </>
        }
      />
    )
  }
  return (
    <FlowCard
      icon={ArrowRightLeftIcon}
      tone="foreground"
      title={`Take over ${transfer.name}`}
      description={`${transfer.fromName} wants to hand you this project and its ${plural(transfer.commentCount, "comment")}. You become the owner and they lose access. The link expires ${timeLeft(transfer.expiresAt)}.`}
    >
      <code className="w-fit rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
        {transfer.publicId}
      </code>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const { publicId } = await accept({ token })
            router.push(projectRoute(publicId))
          } catch (err) {
            setError(errorMessage(err))
            setBusy(false)
          }
        }}
      >
        Accept and become the owner
      </Button>
    </FlowCard>
  )
}
