import { LIMITS } from "@nuni/shared"
import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  actingOwner,
  cleanBody,
  cleanName,
  fail,
  imageUrls,
  projectByPublicId,
  requireOwner,
  sha256Hex,
} from "./lib"
import { ipKey, rateLimiter } from "./rateLimits"

/**
 * Replies in a comment's thread. Public like comments: anyone with the
 * project ID can read them. Authors edit and delete their own with the same
 * browser secret they comment with; the owner can remove any.
 */

export function toReplyView(r: Doc<"replies">) {
  return {
    _id: r._id,
    commentId: r.commentId,
    body: r.body,
    authorName: r.authorName,
    authorKeyHash: r.authorKeyHash,
    isOwner: Boolean(r.ownerId),
    createdAt: r.createdAt,
    editedAt: r.editedAt,
  }
}

export async function repliesFor(ctx: QueryCtx, commentId: Id<"comments">) {
  const replies = await ctx.db
    .query("replies")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .take(LIMITS.repliesPerComment)
  return replies.map(toReplyView)
}

/** The comment, checked to belong to the project. */
export async function commentInProject(
  ctx: QueryCtx | MutationCtx,
  publicId: string,
  commentId: string
) {
  const project = await projectByPublicId(ctx, publicId)
  const id = ctx.db.normalizeId("comments", commentId)
  const comment = id ? await ctx.db.get(id) : null
  if (!project || !comment || comment.projectId !== project._id) {
    fail("not_found", "Comment not found")
  }
  return { project, comment }
}

export function checkSecret(authorSecret: string) {
  if (authorSecret.length < 16 || authorSecret.length > 128) {
    fail("invalid_author", "Invalid author key")
  }
}

async function insertReply(
  ctx: MutationCtx,
  comment: Doc<"comments">,
  fields: {
    body: string
    authorName: string
    authorKeyHash: string
    ownerId?: Id<"users">
  }
) {
  const count = comment.replyCount ?? 0
  if (count >= LIMITS.repliesPerComment) {
    fail("cap_reached", "This thread has reached its reply limit")
  }
  const now = Date.now()
  const id = await ctx.db.insert("replies", {
    commentId: comment._id,
    projectId: comment.projectId,
    body: cleanBody(fields.body),
    authorName: cleanName(fields.authorName),
    authorKeyHash: fields.authorKeyHash,
    ownerId: fields.ownerId,
    createdAt: now,
  })
  await ctx.db.patch(comment._id, { replyCount: count + 1 })
  await ctx.db.patch(comment.projectId, { lastActivityAt: now })
  return id
}

/**
 * From the widget, through the HTTP action (which supplies the IP). With a
 * valid owner session it is an owner reply, under the owner's name.
 */
export const createFromWidget = internalMutation({
  args: {
    publicId: v.string(),
    commentId: v.string(),
    ip: v.string(),
    body: v.string(),
    authorName: v.string(),
    authorSecret: v.string(),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    checkSecret(args.authorSecret)
    const { ok } = await rateLimiter.limit(ctx, "replyPerIp", {
      key: ipKey(args.ip, args.publicId),
    })
    if (!ok) fail("rate_limited", "Slow down a little")
    const { project, comment } = await commentInProject(
      ctx,
      args.publicId,
      args.commentId
    )
    const ownerId = args.sessionToken
      ? await actingOwner(ctx, project, { sessionToken: args.sessionToken })
      : null
    const owner = ownerId ? await ctx.db.get(ownerId) : null
    return insertReply(ctx, comment, {
      body: args.body,
      authorName: owner?.name ?? args.authorName,
      authorKeyHash: await sha256Hex(args.authorSecret),
      ownerId: ownerId ?? undefined,
    })
  },
})

/** From the dashboard (JWT) or the CLI and MCP server (session token). */
export const replyAsOwner = mutation({
  args: {
    publicId: v.string(),
    commentId: v.string(),
    body: v.string(),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { publicId, commentId, body, sessionToken }) => {
    const { project, comment } = await commentInProject(
      ctx,
      publicId,
      commentId
    )
    const ownerId = await requireOwner(ctx, project._id, { sessionToken })
    const owner = await ctx.db.get(ownerId)
    return insertReply(ctx, comment, {
      body,
      authorName: owner?.name ?? "Owner",
      // Not a browser secret's hash, so no widget sees it as its own.
      authorKeyHash: `owner:${ownerId}`,
      ownerId,
    })
  },
})

/** The thread for an open card in the widget: replies and reactions. */
export const listForComment = query({
  args: { publicId: v.string(), commentId: v.string() },
  handler: async (ctx, { publicId, commentId }) => {
    const project = await projectByPublicId(ctx, publicId)
    const id = ctx.db.normalizeId("comments", commentId)
    const comment = id ? await ctx.db.get(id) : null
    if (!project || !comment || comment.projectId !== project._id) {
      return { replies: [], reactions: [], images: [] }
    }
    const [replies, rows, images] = await Promise.all([
      repliesFor(ctx, comment._id),
      ctx.db
        .query("reactions")
        .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
        .take(LIMITS.reactionsPerComment),
      imageUrls(ctx, comment),
    ])
    const groups = new Map<
      string,
      { targetId: string; emoji: string; authorKeyHashes: string[] }
    >()
    for (const row of rows) {
      const key = `${row.targetId} ${row.emoji}`
      const group = groups.get(key) ?? {
        targetId: row.targetId,
        emoji: row.emoji,
        authorKeyHashes: [],
      }
      group.authorKeyHashes.push(row.authorKeyHash)
      groups.set(key, group)
    }
    return {
      replies,
      reactions: Array.from(groups.values(), (g) => ({
        ...g,
        count: g.authorKeyHashes.length,
      })),
      images,
    }
  },
})

async function loadOwnReply(
  ctx: MutationCtx,
  id: Id<"replies">,
  authorSecret: string
) {
  const reply = await ctx.db.get(id)
  if (!reply) fail("not_found", "Reply not found")
  if ((await sha256Hex(authorSecret)) !== reply.authorKeyHash) {
    fail("forbidden", "You can only change your own replies")
  }
  const { ok } = await rateLimiter.limit(ctx, "editPerAuthor", {
    key: reply.authorKeyHash,
  })
  if (!ok) fail("rate_limited", "Slow down a little")
  return reply
}

async function removeReply(ctx: MutationCtx, reply: Doc<"replies">) {
  const reactions = await ctx.db
    .query("reactions")
    .withIndex("by_target_author_emoji", (q) => q.eq("targetId", reply._id))
    .collect()
  for (const r of reactions) await ctx.db.delete(r._id)
  await ctx.db.delete(reply._id)
  const comment = await ctx.db.get(reply.commentId)
  if (comment) {
    await ctx.db.patch(comment._id, {
      replyCount: Math.max(0, (comment.replyCount ?? 1) - 1),
      reactionCount: Math.max(
        0,
        (comment.reactionCount ?? reactions.length) - reactions.length
      ),
    })
  }
}

/** When a comment is deleted, its whole thread goes with it. */
export async function deleteThread(
  ctx: MutationCtx,
  commentId: Id<"comments">
) {
  const [replies, reactions] = await Promise.all([
    ctx.db
      .query("replies")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect(),
    ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect(),
  ])
  for (const doc of [...replies, ...reactions]) await ctx.db.delete(doc._id)
}

export const editOwn = mutation({
  args: { id: v.id("replies"), authorSecret: v.string(), body: v.string() },
  handler: async (ctx, { id, authorSecret, body }) => {
    await loadOwnReply(ctx, id, authorSecret)
    await ctx.db.patch(id, { body: cleanBody(body), editedAt: Date.now() })
  },
})

export const deleteOwn = mutation({
  args: { id: v.id("replies"), authorSecret: v.string() },
  handler: async (ctx, { id, authorSecret }) => {
    await removeReply(ctx, await loadOwnReply(ctx, id, authorSecret))
  },
})

/** The owner removes any reply (dashboard JWT or widget session). */
export const remove = mutation({
  args: { id: v.id("replies"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { id, sessionToken }) => {
    const reply = await ctx.db.get(id)
    if (!reply) return
    await requireOwner(ctx, reply.projectId, { sessionToken })
    await removeReply(ctx, reply)
  },
})
