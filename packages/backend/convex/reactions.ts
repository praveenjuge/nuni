import { REACTIONS } from "@nuni/shared"
import { widgetAuthorArgs } from "@nuni/shared/validators"
import { v } from "convex/values"

import { mutation } from "./_generated/server"
import { widgetAuthor } from "./authors"
import { adjustThread } from "./lifecycle"
import { fail, requireComment, rowById } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { rateLimiter } from "./rateLimits"

/**
 * Add or remove one emoji on a comment or one of its replies. Each author
 * (signed-in commenter, or browser secret) has at most one of each emoji per
 * message. A signed-in commenter also removes the one this browser added
 * as a guest.
 */
export const toggle = mutation({
  args: {
    publicId: v.string(),
    commentId: v.string(),
    targetId: v.string(),
    emoji: v.string(),
    ...widgetAuthorArgs,
  },
  handler: async (ctx, args) => {
    if (!(REACTIONS as readonly string[]).includes(args.emoji)) {
      fail("invalid_reaction", "Unknown reaction")
    }
    const { comment } = await requireComment(ctx, args.publicId, args.commentId)
    if (args.targetId !== comment._id) {
      const reply = await rowById(ctx, "replies", args.targetId)
      if (reply?.commentId !== comment._id) {
        fail("not_found", "Reply not found")
      }
    }
    const author = await widgetAuthor(ctx, comment.projectId, args)
    const { ok } = await rateLimiter.limit(ctx, "reactPerAuthor", {
      key: author.key,
    })
    if (!ok) fail("rate_limited", "Slow down a little")

    for (const key of author.keys) {
      const existing = await ctx.db
        .query("reactions")
        .withIndex("by_target_author_emoji", (q) =>
          q
            .eq("targetId", args.targetId)
            .eq("authorKeyHash", key)
            .eq("emoji", args.emoji)
        )
        .unique()
      if (existing) {
        await ctx.db.delete(existing._id)
        await adjustThread(ctx, comment._id, { reactions: -1 })
        return { added: false }
      }
    }
    if ((comment.reactionCount ?? 0) >= SERVER_LIMITS.reactionsPerComment) {
      fail("cap_reached", "This thread has reached its reaction limit")
    }
    await ctx.db.insert("reactions", {
      commentId: comment._id,
      projectId: comment.projectId,
      targetId: args.targetId,
      emoji: args.emoji,
      authorKeyHash: author.key,
    })
    await adjustThread(ctx, comment._id, { reactions: 1 })
    return { added: true }
  },
})
