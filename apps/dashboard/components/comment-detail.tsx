"use client"

import { api } from "@nuni/backend/api"
import { buildCommentPrompt } from "@nuni/shared"
import { useMutation } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import {
  CheckIcon,
  ClipboardCopyIcon,
  ExternalLinkIcon,
  EllipsisIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { toast } from "sonner"

import { CommentContext } from "@/components/comment-context"
import { CommentThread } from "@/components/comment-thread"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  describeAgent,
  errorMessage,
  hostOf,
  initials,
  jumpUrl,
  timeAgo,
} from "@/lib/format"

export type OwnerComment = FunctionReturnType<
  typeof api.comments.listForOwner
>["page"][number]

/** Everything about one comment: what was said, where, the screenshot and the thread. */
export function CommentDetail({
  publicId,
  comment: c,
  onChanged,
}: {
  publicId: string
  comment: OwnerComment
  /** Called after the comment is resolved, reopened or deleted. */
  onChanged?: () => void
}) {
  const resolve = useMutation(api.comments.resolve)
  const reopen = useMutation(api.comments.reopen)
  const remove = useMutation(api.comments.remove)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const open = c.status === "open"

  async function toggleStatus() {
    try {
      if (open) {
        await resolve({ id: c._id })
        toast("Comment resolved", {
          action: { label: "Undo", onClick: () => void reopen({ id: c._id }) },
        })
      } else {
        await reopen({ id: c._id })
        toast("Comment reopened")
      }
      onChanged?.()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const element = [
    c.anchor.region ? "An area of" : "On",
    `<${c.anchor.tag}>`,
    c.anchor.text ? `“${c.anchor.text}”` : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <article aria-label="Selected comment" className="grid gap-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-4">
        <Avatar>
          <AvatarFallback className="bg-primary/10 font-medium text-primary">
            {initials(c.authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="grid min-w-40 flex-1 basis-40 gap-0.5">
          <span className="truncate font-medium">{c.authorName}</span>
          <span className="truncate text-xs text-muted-foreground">
            {timeAgo(c.createdAt)} · {describeAgent(c.userAgent)}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy for agent"
                  onClick={async () => {
                    await navigator.clipboard.writeText(buildCommentPrompt(c))
                    toast("Copied. Paste it into your agent.")
                  }}
                />
              }
            >
              <ClipboardCopyIcon />
            </TooltipTrigger>
            <TooltipContent>Copy for agent</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href={jumpUrl(c.page, c._id)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open on page"
                  className={buttonVariants({
                    variant: "ghost",
                    size: "icon-sm",
                  })}
                />
              }
            >
              <ExternalLinkIcon />
            </TooltipTrigger>
            <TooltipContent>Open on page</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="More actions"
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon /> Delete comment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant={open ? "default" : "outline"}
            className="ml-1"
            onClick={() => void toggleStatus()}
          >
            {open ? <CheckIcon /> : <RotateCcwIcon />}
            {open ? "Resolve" : "Reopen"}
          </Button>
        </div>
      </header>

      <div className="grid gap-3">
        {c.anchor.quote && (
          <blockquote className="border-l-2 border-primary/60 pl-3 text-sm text-muted-foreground italic">
            {c.anchor.quote.exact}
          </blockquote>
        )}
        <p className="text-[15px]/relaxed whitespace-pre-wrap">{c.body}</p>
      </div>

      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Page</dt>
        <dd className="min-w-0 truncate">
          <a
            href={jumpUrl(c.page, c._id)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs hover:underline"
          >
            {hostOf(c.page.origin)}
            {c.page.path}
          </a>
        </dd>
        <dt className="text-muted-foreground">Element</dt>
        <dd className="min-w-0 truncate text-xs/5">{element}</dd>
        <dt className="text-muted-foreground">Viewport</dt>
        <dd className="text-xs/5 tabular-nums">
          {c.viewport.w} × {c.viewport.h}
        </dd>
      </dl>

      {c.screenshotUrl && (
        <a
          href={c.screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/5 transition-opacity hover:opacity-90"
          title="Open the full screenshot"
        >
          <Image
            src={c.screenshotUrl}
            alt="Screenshot taken when the comment was left"
            width={640}
            height={360}
            unoptimized
            className="h-auto max-h-80 w-full object-cover object-top"
          />
        </a>
      )}

      <CommentContext context={c.context} userAgent={c.userAgent} />

      <Separator />

      <CommentThread
        key={c._id}
        publicId={publicId}
        commentId={c._id}
        replies={c.replies}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this comment?"
        description="The comment, its replies and its screenshot are deleted for everyone. This can't be undone."
        action="Delete comment"
        destructive
        onConfirm={async () => {
          try {
            await remove({ id: c._id })
            toast("Comment deleted")
            onChanged?.()
          } catch (err) {
            toast.error(errorMessage(err))
          }
        }}
      />
    </article>
  )
}
