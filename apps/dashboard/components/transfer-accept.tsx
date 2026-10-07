"use client"

import { api } from "@nuni/backend/api"
import { useMutation, useQuery } from "convex/react"
import { ArrowRightLeftIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { FlowShell } from "@/components/flow-shell"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStoreUser } from "@/components/use-store-user"
import { errorMessage, timeLeft } from "@/lib/format"

/** The recipient's side of a project transfer. */
export function TransferAccept({ token }: { token: string }) {
  const { ready } = useStoreUser()
  const transfer = useQuery(api.transfers.get, ready ? { token } : "skip")
  const accept = useMutation(api.transfers.accept)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <FlowShell>
      <Card className="w-full min-w-0 [overflow-wrap:anywhere]">
        {!ready || transfer === undefined ? (
          <CardContent className="py-6">
            <Skeleton className="h-24" />
          </CardContent>
        ) : transfer === null ? (
          <CardHeader>
            <CardTitle>This link no longer works</CardTitle>
            <CardDescription>
              It expired, was used, or the owner cancelled it. Ask them for a
              new one.
            </CardDescription>
          </CardHeader>
        ) : transfer.isOwner ? (
          <CardHeader>
            <CardTitle>You own {transfer.name}</CardTitle>
            <CardDescription>
              Send this link to the person who should take it over.{" "}
              <Link href={`/p/${transfer.publicId}`} className="underline">
                Open the project
              </Link>
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRightLeftIcon className="size-5" /> Take over{" "}
                {transfer.name}
              </CardTitle>
              <CardDescription>
                {transfer.fromName} wants to hand you this project and its{" "}
                {transfer.commentCount} comment
                {transfer.commentCount === 1 ? "" : "s"}. You become the owner
                and they lose access. The link expires{" "}
                {timeLeft(transfer.expiresAt)}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
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
                    router.push(`/p/${publicId}`)
                  } catch (err) {
                    setError(errorMessage(err))
                    setBusy(false)
                  }
                }}
              >
                Accept and become the owner
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </FlowShell>
  )
}
