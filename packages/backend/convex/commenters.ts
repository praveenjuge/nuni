import { LIMITS, randomBase58 } from "@nuni/shared"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation, mutation, query } from "./_generated/server"
import { searchTextFor } from "./comments"
import {
  checkSecret,
  cleanName,
  commenterFromToken,
  fail,
  parseOrigin,
  projectByPublicId,
  requireUser,
  sha256Hex,
  userAuthorKey,
} from "./lib"
import { rateLimiter } from "./rateLimits"

/**
 * Optional sign-in for people who comment. A signed-in commenter writes
 * under their account's name and avatar, and their comments follow them to
 * any browser. Commenter sessions are separate from owner sessions and
 * never grant owner tools.
 */

/**
 * Called by the dashboard sign-in page. The raw token is returned once and
 * handed to the widget via postMessage; only its hash is stored.
 */
export const create = mutation({
  args: { publicId: v.string(), origin: v.string() },
  handler: async (ctx, { publicId, origin }) => {
    const user = await requireUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!project || project.deletingAt) fail("not_found", "Project not found")
    // The token is postMessage'd to this origin, so it must be one the
    // project is used on.
    const cleanOrigin = parseOrigin(origin)
    if (!project.origins.includes(cleanOrigin)) {
      fail("unknown_origin", "Nuni isn't set up on this site")
    }
    const { ok } = await rateLimiter.limit(ctx, "sessionPerUser", {
      key: user._id,
    })
    if (!ok) fail("rate_limited", "Too many sign-ins, try again later")

    const token = `nuni_c_${randomBase58(40)}`
    const expiresAt = Date.now() + LIMITS.sessionTtlMs
    await ctx.db.insert("commenterSessions", {
      tokenHash: await sha256Hex(token),
      userId: user._id,
      projectId: project._id,
      origin: cleanOrigin,
      expiresAt,
    })
    return { token, expiresAt }
  },
})

/** Widget check: who is this stored token signed in as? */
export const validate = query({
  args: { publicId: v.string(), commenterToken: v.string() },
  handler: async (ctx, { publicId, commenterToken }) => {
    const project = await projectByPublicId(ctx, publicId)
    const user = project
      ? await commenterFromToken(ctx, project._id, commenterToken)
      : null
    if (!user) return { valid: false as const }
    return {
      valid: true as const,
      name: user.name,
      avatarUrl: user.avatarUrl,
      /** The author key on their comments, so the widget knows its own. */
      authorKey: userAuthorKey(user._id),
    }
  },
})

/** Most of a browser's guest comments, replies and reactions moved at once. */
const LINK_LIMIT = 200

/**
 * Right after signing in: this browser's guest comments, replies and
 * reactions on the project become the account's. Proven by holding both
 * the browser key and the commenter token.
 */
export const linkBrowser = mutation({
  args: {
    publicId: v.string(),
    authorSecret: v.string(),
    commenterToken: v.string(),
  },
  handler: async (ctx, { publicId, authorSecret, commenterToken }) => {
    checkSecret(authorSecret)
    const project = await projectByPublicId(ctx, publicId)
    const user = project
      ? await commenterFromToken(ctx, project._id, commenterToken)
      : null
    if (!project || !user) {
      fail("signed_out", "You've been signed out. Sign in again.")
    }
    const from = await sha256Hex(authorSecret)
    const to = userAuthorKey(user._id)
    const authorName = cleanName(user.name)
    const [comments, replies, reactions] = await Promise.all([
      ctx.db
        .query("comments")
        .withIndex("by_project_author", (q) =>
          q.eq("projectId", project._id).eq("authorKeyHash", from)
        )
        .take(LINK_LIMIT),
      ctx.db
        .query("replies")
        .withIndex("by_project_author", (q) =>
          q.eq("projectId", project._id).eq("authorKeyHash", from)
        )
        .take(LINK_LIMIT),
      ctx.db
        .query("reactions")
        .withIndex("by_project_author", (q) =>
          q.eq("projectId", project._id).eq("authorKeyHash", from)
        )
        .take(LINK_LIMIT),
    ])

    for (const comment of comments) {
      await ctx.db.patch(comment._id, {
        authorKeyHash: to,
        authorId: user._id,
        authorName,
        searchText: searchTextFor({ ...comment, authorName }),
      })
    }
    for (const reply of replies) {
      // A reply written as the owner keeps the owner's name.
      const mine = !reply.ownerId || reply.ownerId === user._id
      await ctx.db.patch(reply._id, {
        authorKeyHash: to,
        ...(mine ? { authorId: user._id, authorName } : {}),
      })
    }
    for (const reaction of reactions) {
      const duplicate = await ctx.db
        .query("reactions")
        .withIndex("by_target_author_emoji", (q) =>
          q
            .eq("targetId", reaction.targetId)
            .eq("authorKeyHash", to)
            .eq("emoji", reaction.emoji)
        )
        .unique()
      if (!duplicate) {
        await ctx.db.patch(reaction._id, { authorKeyHash: to })
        continue
      }
      // The account already has this emoji here: keep one.
      await ctx.db.delete(reaction._id)
      const comment = await ctx.db.get(reaction.commentId)
      if (comment) {
        await ctx.db.patch(comment._id, {
          reactionCount: Math.max(0, (comment.reactionCount ?? 1) - 1),
        })
      }
    }
  },
})

/** Widget sign-out: the widget revokes its own token. */
export const signOut = mutation({
  args: { commenterToken: v.string() },
  handler: async (ctx, { commenterToken }) => {
    if (!commenterToken || commenterToken.length > 200) return
    const tokenHash = await sha256Hex(commenterToken)
    const session = await ctx.db
      .query("commenterSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique()
    if (session) await ctx.db.delete(session._id)
  },
})

const CLEANUP_BATCH = 500

/** Daily cron: delete expired commenter sessions. */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("commenterSessions")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH)
    for (const session of expired) await ctx.db.delete(session._id)
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.commenters.cleanupExpired, {})
    }
    return expired.length
  },
})
