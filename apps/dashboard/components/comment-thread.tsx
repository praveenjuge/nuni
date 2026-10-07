"use client"

import { api } from "@nuni/backend/api"
import type { Id } from "@nuni/backend/dataModel"
import { LIMITS, type ReplyView } from "@nuni/shared"
import { useMutation } from "convex/react"
import { ArrowUpIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { errorMessage, initials, timeAgo } from "@/lib/format"

/** A comment's replies and the owner's reply box. */
export function CommentThread({
  publicId,
  commentId,
  replies,
}: {
  publicId: string
  commentId: string
  replies: ReplyView[]
}) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const reply = useMutation(api.replies.replyAsOwner)
  const remove = useMutation(api.replies.remove)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await reply({ publicId, commentId, body })
      setBody("")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      {replies.length > 0 && (
        <ul className="grid gap-4" aria-label="Replies">
          {replies.map((r) => (
            <li key={r._id} className="group/reply flex gap-3 text-sm">
              <Avatar size="sm">
                <AvatarFallback>{initials(r.authorName)}</AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex min-h-6 items-center gap-2">
                  <span className="truncate font-medium">{r.authorName}</span>
                  {r.isOwner && <Badge variant="secondary">Owner</Badge>}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(r.createdAt)}
                    {r.editedAt ? " · edited" : ""}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="ml-auto text-muted-foreground opacity-0 group-hover/reply:opacity-100 hover:text-destructive focus-visible:opacity-100"
                    aria-label="Delete reply"
                    onClick={() => setDeleting(r._id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <p className="whitespace-pre-wrap">{r.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-2" onSubmit={send}>
        <InputGroup>
          <InputGroupTextarea
            className="field-sizing-content max-h-48 min-h-10"
            placeholder="Reply as the owner"
            value={body}
            maxLength={LIMITS.bodyMaxLength}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e)
            }}
            aria-label="Reply"
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <KbdGroup className="hidden sm:inline-flex">
              <Kbd>⌘</Kbd>
              <Kbd>Enter</Kbd>
            </KbdGroup>
            <InputGroupButton
              type="submit"
              size="icon-xs"
              variant="default"
              className="ml-auto rounded-full"
              disabled={busy || !body.trim()}
              aria-label="Send reply"
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this reply?"
        description="It disappears from the thread for everyone."
        action="Delete reply"
        destructive
        onConfirm={() => {
          if (deleting) void remove({ id: deleting as Id<"replies"> })
        }}
      />
    </div>
  )
}
