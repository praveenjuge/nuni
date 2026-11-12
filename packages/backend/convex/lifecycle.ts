import type { CommentStatus, Resolution } from "@nuni/shared"
import type { WithoutSystemFields } from "convex/server"

import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { nameOf } from "./accounts"
import { ownerAuthorKey } from "./authors"
import { recordActivity } from "./digests"
import { cleanBody, cleanName, fail } from "./lib"
import { SERVER_LIMITS } from "./limits"

/**
 * Every write that creates, changes the status of, re-authors or deletes a
 * comment or a reply. The numbers derived from them are only written here:
 * the project's `commentCount`/`openCount`/`lastActivityAt`, the per-page
 * `pageStats.openCount`, each comment's `searchText`, and its thread's
 * `replyCount`/`reactionCount`. New comments, replies and status changes
 * are also noted here for the owner's next email.
 */

type Comment = Doc<"comments">

function searchText(c: Pick<Comment, "body" | "authorName" | "suggestion">) {
  return [c.authorName, c.body, c.suggestion?.after].filter(Boolean).join("\n")
}

/** A comment entering (`from: null`), changing status, or leaving (`to: null`). */
interface Change {
  path: string
  from: CommentStatus | null
  to: CommentStatus | null
}

async function bumpPage(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  path: string,
  delta: number
) {
  const stats = await ctx.db
    .query("pageStats")
    .withIndex("by_project_path", (q) =>
      q.eq("projectId", projectId).eq("path", path)
    )
    .unique()
  if (stats) {
    await ctx.db.patch(stats._id, {
      openCount: Math.max(0, stats.openCount + delta),
    })
  } else {
    // Rows are kept at 0 too, so the dashboard can offer every page as a filter.
    await ctx.db.insert("pageStats", {
      projectId,
      path,
      openCount: Math.max(0, delta),
    })
  }
}

async function applyCounts(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  changes: Change[]
) {
  if (!changes.length) return
  const isOpen = (s: CommentStatus | null) => (s === "open" ? 1 : 0)
  const exists = (s: CommentStatus | null) => (s ? 1 : 0)
  const pages = new Map<string, number>()
  let open = 0
  let total = 0
  for (const { path, from, to } of changes) {
    const delta = isOpen(to) - isOpen(from)
    pages.set(path, (pages.get(path) ?? 0) + delta)
    open += delta
    total += exists(to) - exists(from)
  }
  for (const [path, delta] of pages) {
    if (delta) await bumpPage(ctx, projectId, path, delta)
  }
  const project = await ctx.db.get(projectId)
  if (!project) return
  await ctx.db.patch(projectId, {
    commentCount: Math.max(0, project.commentCount + total),
    openCount: Math.max(0, project.openCount + open),
    lastActivityAt: Date.now(),
  })
}

export type NewComment = Omit<
  WithoutSystemFields<Comment>,
  "status" | "searchText" | "createdAt"
>

export async function insertComment(ctx: MutationCtx, fields: NewComment) {
  const id = await ctx.db.insert("comments", {
    ...fields,
    status: "open",
    searchText: searchText(fields),
    createdAt: Date.now(),
  })
  await applyCounts(ctx, fields.projectId, [
    { path: fields.page.path, from: null, to: "open" },
  ])
  await recordActivity(
    ctx,
    fields.projectId,
    { kind: "comment", commentId: id },
    fields.authorId
  )
  return id
}

export async function editComment(
  ctx: MutationCtx,
  comment: Comment,
  edit: Pick<Comment, "body" | "suggestion">
) {
  await ctx.db.patch(comment._id, {
    ...edit,
    searchText: searchText({ ...comment, ...edit }),
    editedAt: Date.now(),
  })
}

/** A guest's comment becomes a signed-in commenter's. */
export async function reauthorComment(
  ctx: MutationCtx,
  comment: Comment,
  author: Required<Pick<Comment, "authorKeyHash" | "authorId" | "authorName">>
) {
  await ctx.db.patch(comment._id, {
    ...author,
    searchText: searchText({ ...comment, ...author }),
  })
}

/**
 * Resolve or reopen comments. One that already has the status is left as
 * it is, except that closing a resolved one as outdated changes its reason.
 * Returns how many changed status.
 */
export async function setStatus(
  ctx: MutationCtx,
  comments: Comment[],
  status: CommentStatus,
  by: { userId: Id<"users">; resolution?: Resolution }
): Promise<number> {
  const resolved = status === "resolved"
  const resolution = resolved ? by.resolution : undefined
  const now = Date.now()
  const changes = new Map<Id<"projects">, Change[]>()
  for (const comment of comments) {
    if (comment.status === status) {
      if (resolved && comment.resolution !== resolution) {
        await ctx.db.patch(comment._id, { resolution })
      }
      continue
    }
    await ctx.db.patch(comment._id, {
      status,
      resolvedAt: resolved ? now : undefined,
      resolvedBy: resolved ? by.userId : undefined,
      resolution,
    })
    const list = changes.get(comment.projectId) ?? []
    list.push({ path: comment.page.path, from: comment.status, to: status })
    changes.set(comment.projectId, list)
    await recordActivity(ctx, comment.projectId, {
      kind: resolved ? "resolved" : "reopened",
      commentId: comment._id,
    })
  }
  let changed = 0
  for (const [projectId, list] of changes) {
    await applyCounts(ctx, projectId, list)
    changed += list.length
  }
  return changed
}

/** Delete comments with their threads and files, and count them out. */
export async function deleteComments(ctx: MutationCtx, comments: Comment[]) {
  const changes = new Map<Id<"projects">, Change[]>()
  for (const comment of comments) {
    await deleteCommentRows(ctx, comment)
    const list = changes.get(comment.projectId) ?? []
    list.push({ path: comment.page.path, from: comment.status, to: null })
    changes.set(comment.projectId, list)
  }
  for (const [projectId, list] of changes) {
    await applyCounts(ctx, projectId, list)
  }
}

/**
 * The comment, its replies and reactions, and its stored files. Counters
 * are left alone: `deleteComments` updates them, and a project being
 * deleted doesn't need them.
 */
export async function deleteCommentRows(ctx: MutationCtx, comment: Comment) {
  const [replies, reactions] = await Promise.all([
    ctx.db
      .query("replies")
      .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
      .collect(),
    ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
      .collect(),
  ])
  for (const row of [...replies, ...reactions]) await ctx.db.delete(row._id)
  for (const file of commentFiles(comment)) await ctx.storage.delete(file)
  await ctx.db.delete(comment._id)
}

function commentFiles(c: Comment): Id<"_storage">[] {
  return [...(c.screenshotId ? [c.screenshotId] : []), ...(c.images ?? [])]
}

export async function adjustThread(
  ctx: MutationCtx,
  commentId: Id<"comments">,
  delta: { replies?: number; reactions?: number }
) {
  const comment = await ctx.db.get(commentId)
  if (!comment) return
  await ctx.db.patch(commentId, {
    replyCount: Math.max(0, (comment.replyCount ?? 0) + (delta.replies ?? 0)),
    reactionCount: Math.max(
      0,
      (comment.reactionCount ?? 0) + (delta.reactions ?? 0)
    ),
  })
}

export function threadIsFull(comment: Comment) {
  return (comment.replyCount ?? 0) >= SERVER_LIMITS.repliesPerComment
}

export async function insertReply(
  ctx: MutationCtx,
  comment: Comment,
  fields: {
    body: string
    authorName: string
    authorKeyHash: string
    authorId?: Id<"users">
    ownerId?: Id<"users">
  }
) {
  if (threadIsFull(comment)) {
    fail("cap_reached", "This thread has reached its reply limit")
  }
  const now = Date.now()
  const id = await ctx.db.insert("replies", {
    ...fields,
    commentId: comment._id,
    projectId: comment.projectId,
    body: cleanBody(fields.body),
    authorName: cleanName(fields.authorName),
    createdAt: now,
  })
  await adjustThread(ctx, comment._id, { replies: 1 })
  await ctx.db.patch(comment.projectId, { lastActivityAt: now })
  await recordActivity(
    ctx,
    comment.projectId,
    { kind: "reply", commentId: comment._id, replyId: id },
    fields.ownerId ?? fields.authorId
  )
  return id
}

/** A reply as the project owner, from the dashboard or an agent. */
export async function insertOwnerReply(
  ctx: MutationCtx,
  comment: Comment,
  ownerId: Id<"users">,
  body: string
) {
  return insertReply(ctx, comment, {
    body,
    authorName: await nameOf(ctx, ownerId),
    authorKeyHash: ownerAuthorKey(ownerId),
    ownerId,
  })
}

/** A reply and the reactions on it. */
export async function deleteReply(ctx: MutationCtx, reply: Doc<"replies">) {
  const reactions = await ctx.db
    .query("reactions")
    .withIndex("by_target_author_emoji", (q) => q.eq("targetId", reply._id))
    .collect()
  for (const r of reactions) await ctx.db.delete(r._id)
  await ctx.db.delete(reply._id)
  await adjustThread(ctx, reply.commentId, {
    replies: -1,
    reactions: -reactions.length,
  })
}
