"use client"

import { api } from "@nuni/backend/api"
import { useMutation } from "convex/react"
import { ArchiveIcon, CheckIcon, RotateCcwIcon, TrashIcon } from "vadivam-react"
import { useState } from "react"
import { toast } from "sonner"

import { errorMessage, plural } from "@/lib/format"

/**
 * What the owner can do to comments, from the bulk toolbar or one comment's
 * panel. `undo` offers to reopen them from the toast.
 */
export const COMMENT_ACTIONS = {
  resolve: { label: "Resolve", icon: CheckIcon, done: "resolved", undo: true },
  outdated: {
    label: "Close as outdated",
    icon: ArchiveIcon,
    done: "closed as outdated",
    undo: true,
  },
  reopen: {
    label: "Reopen",
    icon: RotateCcwIcon,
    done: "reopened",
    undo: false,
  },
  delete: { label: "Delete", icon: TrashIcon, done: "deleted", undo: false },
} as const

export type CommentAction = keyof typeof COMMENT_ACTIONS

export function useCommentActions() {
  const setStatus = useMutation(api.comments.bulkSetStatus)
  const remove = useMutation(api.comments.bulkRemove)
  const [busy, setBusy] = useState(false)

  function call(action: CommentAction, ids: string[]) {
    switch (action) {
      case "delete":
        return remove({ ids })
      case "reopen":
        return setStatus({ ids, status: "open" })
      case "resolve":
        return setStatus({ ids, status: "resolved" })
      case "outdated":
        return setStatus({ ids, status: "resolved", resolution: "outdated" })
    }
  }

  /** Runs `action` on `ids` and says how it went; true when it worked. */
  async function run(action: CommentAction, ids: string[]): Promise<boolean> {
    setBusy(true)
    try {
      await call(action, ids)
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
    const { done, undo } = COMMENT_ACTIONS[action]
    toast(`${plural(ids.length, "comment")} ${done}`, {
      action: undo
        ? { label: "Undo", onClick: () => void run("reopen", ids) }
        : undefined,
    })
    return true
  }

  return { run, busy }
}
