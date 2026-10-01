"use client"

import { api } from "@nuni/backend/api"
import type { Id } from "@nuni/backend/dataModel"
import type { ReplyView } from "@nuni/shared"
import { useMutation } from "convex/react"
import { MessageSquareIcon, SendIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { initials, timeAgo } from "@/lib/format"

/** A comment's replies, collapsed by default, with a reply box for the owner. */
export function CommentThread({
  publicId,
  commentId,
  replies,
}: {
  publicId: string
  commentId: string
  replies: ReplyView[]
}) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reply = useMutation(api.replies.replyAsOwner)
  const remove = useMutation(api.replies.remove)

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="w-fit px-0 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-expanded="false"
      >
        <MessageSquareIcon />
        {replies.length
          ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
          : "Reply"}
      </Button>
    )
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    try {
      await reply({ publicId, commentId, body })
      setBody("")
    } catch (err) {
      const data = (err as { data?: { message?: string } })?.data
      setError(data?.message ?? "Couldn't post the reply")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 border-l-2 pl-3">
      {replies.map((r) => (
        <div key={r._id} className="grid gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Avatar className="size-5">
              <AvatarFallback className="bg-primary/15 text-[9px] font-semibold text-primary">
                {initials(r.authorName)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium">{r.authorName}</span>
            {r.isOwner && <Badge variant="secondary">Owner</Badge>}
            <span className="text-muted-foreground">
              {timeAgo(r.createdAt)}
              {r.editedAt ? " · edited" : ""}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              className="ml-auto text-muted-foreground hover:text-destructive"
              aria-label="Delete reply"
              title="Delete reply"
              onClick={() => {
                if (confirm("Delete this reply?"))
                  void remove({ id: r._id as Id<"replies"> })
              }}
            >
              <Trash2Icon />
            </Button>
          </div>
          <p className="whitespace-pre-wrap">{r.body}</p>
        </div>
      ))}
      <form className="grid gap-2" onSubmit={send}>
        <textarea
          className="min-h-16 w-full rounded-2xl border border-transparent bg-input/50 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          placeholder="Reply as the owner"
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e)
          }}
          aria-label="Reply"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={busy || !body.trim()}>
            <SendIcon /> Reply
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Hide
          </Button>
        </div>
      </form>
    </div>
  )
}
