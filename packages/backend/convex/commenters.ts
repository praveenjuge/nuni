import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { requireUser } from "./accounts"
import { checkSecret, commenterFromToken, userAuthorKey } from "./authors"
import { adjustThread, reauthorComment } from "./lifecycle"
import { cleanName, fail, projectByPublicId, sha256Hex } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { createSiteSession, findByToken } from "./tokens"

/**
 * Optional sign-in for people who comment. A signed-in commenter writes
 * under their account's name and avatar, and their comments follow them to
 * any browser. Commenter sessions are separate from owner sessions and
 * never grant owner tools.
 */

/**
 * Called by the dashboard sign-in page. The raw token is returned once and
 * handed to the widget via postMessage.
 */
export const create = mutation({
  args: { publicId: v.string(), origin: v.string() },
  handler: async (ctx, { publicId, origin }) => {
    const user = await requireUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!project || project.deletingAt) fail("not_found", "Project not found")
    return createSiteSession(ctx, "commenter", {
      userId: user._id,
      project,
      origin,
    })
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
        .take(SERVER_LIMITS.linkBrowserMax),
      ctx.db
        .query("replies")
        .withIndex("by_project_author", (q) =>
          q.eq("projectId", project._id).eq("authorKeyHash", from)
        )
        .take(SERVER_LIMITS.linkBrowserMax),
      ctx.db
        .query("reactions")
        .withIndex("by_project_author", (q) =>
          q.eq("projectId", project._id).eq("authorKeyHash", from)
        )
        .take(SERVER_LIMITS.linkBrowserMax),
    ])

    for (const comment of comments) {
      await reauthorComment(ctx, comment, {
        authorKeyHash: to,
        authorId: user._id,
        authorName,
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
      await adjustThread(ctx, reaction.commentId, { reactions: -1 })
    }
  },
})

export const signOut = mutation({
  args: { commenterToken: v.string() },
  handler: async (ctx, { commenterToken }) => {
    const session = await findByToken(ctx, "commenterSessions", commenterToken)
    if (session) await ctx.db.delete(session._id)
  },
})
