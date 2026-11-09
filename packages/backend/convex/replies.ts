import type { Thread } from "@nuni/shared"
import { widgetAuthorArgs } from "@nuni/shared/validators"
import { v } from "convex/values"

import { internalMutation, mutation, query } from "./_generated/server"
import { requireOwnRow, widgetAuthor } from "./authors"
import { deleteReply, insertOwnerReply, insertReply } from "./lifecycle"
import { cleanBody, fail, findComment, requireComment, rowById } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { ownerOf, requireOwner } from "./ownership"
import { ipKey, rateLimiter } from "./rateLimits"
import { imageUrls, repliesFor } from "./views"

/**
 * Replies in a comment's thread. Public like comments: anyone with the
 * project ID can read them. Authors edit and delete their own with the same
 * browser secret (or commenter sign-in) they comment with; the owner can
 * remove any.
 */

/**
 * From the widget, through the HTTP action (which supplies the IP). With a
 * valid owner session it is an owner reply, under the owner's name; with a
 * commenter sign-in, it is under the commenter's account.
 */
export const createFromWidget = internalMutation({
  args: {
    publicId: v.string(),
    commentId: v.string(),
    ip: v.string(),
    body: v.string(),
    authorName: v.string(),
    ...widgetAuthorArgs,
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { ok } = await rateLimiter.limit(ctx, "replyPerIp", {
      key: ipKey(args.ip, args.publicId),
    })
    if (!ok) fail("rate_limited", "Slow down a little")
    const { project, comment } = await requireComment(
      ctx,
      args.publicId,
      args.commentId
    )
    const ownerId = args.sessionToken
      ? await ownerOf(ctx, project, args.sessionToken)
      : null
    const owner = ownerId ? await ctx.db.get(ownerId) : null
    const author = await widgetAuthor(ctx, project._id, args)
    // The account's name and avatar are shown unless the reply is under
    // another person's owner name.
    const authorId =
      author.user && (!owner || owner._id === author.user._id)
        ? author.user._id
        : undefined
    return insertReply(ctx, comment, {
      body: args.body,
      authorName: owner?.name ?? author.user?.name ?? args.authorName,
      authorKeyHash: author.key,
      authorId,
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
    const { project, comment } = await requireComment(ctx, publicId, commentId)
    const ownerId = await requireOwner(ctx, project, sessionToken)
    return insertOwnerReply(ctx, comment, ownerId, body)
  },
})

/** The thread for an open card in the widget: replies and reactions. */
export const listForComment = query({
  args: { publicId: v.string(), commentId: v.string() },
  handler: async (ctx, { publicId, commentId }): Promise<Thread> => {
    const found = await findComment(ctx, publicId, commentId)
    if (!found) return { replies: [], reactions: [], images: [] }
    const { comment } = found
    const [replies, rows, images] = await Promise.all([
      repliesFor(ctx, comment._id),
      ctx.db
        .query("reactions")
        .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
        .take(SERVER_LIMITS.reactionsPerComment),
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

export const editOwn = mutation({
  args: { id: v.string(), ...widgetAuthorArgs, body: v.string() },
  handler: async (ctx, { id, body, ...auth }) => {
    const reply = await requireOwnRow(
      ctx,
      await rowById(ctx, "replies", id),
      auth,
      "replies"
    )
    await ctx.db.patch(reply._id, {
      body: cleanBody(body),
      editedAt: Date.now(),
    })
  },
})

export const deleteOwn = mutation({
  args: { id: v.string(), ...widgetAuthorArgs },
  handler: async (ctx, { id, ...auth }) => {
    const reply = await requireOwnRow(
      ctx,
      await rowById(ctx, "replies", id),
      auth,
      "replies"
    )
    await deleteReply(ctx, reply)
  },
})

/** The owner removes any reply. Removing one that is already gone does nothing. */
export const remove = mutation({
  args: { id: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { id, sessionToken }) => {
    const reply = await rowById(ctx, "replies", id)
    if (!reply) return
    await requireOwner(ctx, await ctx.db.get(reply.projectId), sessionToken)
    await deleteReply(ctx, reply)
  },
})
