import { LIMITS, REACTIONS } from "@nuni/shared"
import { v } from "convex/values"

import { mutation } from "./_generated/server"
import { fail, sha256Hex } from "./lib"
import { rateLimiter } from "./rateLimits"
import { checkSecret, commentInProject } from "./replies"

/**
 * Add or remove one emoji on a comment or one of its replies. Each author
 * (browser secret) has at most one of each emoji per message.
 */
export const toggle = mutation({
  args: {
    publicId: v.string(),
    commentId: v.string(),
    targetId: v.string(),
    emoji: v.string(),
    authorSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(REACTIONS as readonly string[]).includes(args.emoji)) {
      fail("invalid_reaction", "Unknown reaction")
    }
    checkSecret(args.authorSecret)
    const { comment } = await commentInProject(
      ctx,
      args.publicId,
      args.commentId
    )
    if (args.targetId !== comment._id) {
      const replyId = ctx.db.normalizeId("replies", args.targetId)
      const reply = replyId ? await ctx.db.get(replyId) : null
      if (!reply || reply.commentId !== comment._id) {
        fail("not_found", "Reply not found")
      }
    }
    const authorKeyHash = await sha256Hex(args.authorSecret)
    const { ok } = await rateLimiter.limit(ctx, "reactPerAuthor", {
      key: authorKeyHash,
    })
    if (!ok) fail("rate_limited", "Slow down a little")

    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_target_author_emoji", (q) =>
        q
          .eq("targetId", args.targetId)
          .eq("authorKeyHash", authorKeyHash)
          .eq("emoji", args.emoji)
      )
      .unique()
    const count = comment.reactionCount ?? 0
    if (existing) {
      await ctx.db.delete(existing._id)
      await ctx.db.patch(comment._id, { reactionCount: Math.max(0, count - 1) })
      return { added: false }
    }
    if (count >= LIMITS.reactionsPerComment) {
      fail("cap_reached", "This thread has reached its reaction limit")
    }
    await ctx.db.insert("reactions", {
      commentId: comment._id,
      projectId: comment.projectId,
      targetId: args.targetId,
      emoji: args.emoji,
      authorKeyHash,
    })
    await ctx.db.patch(comment._id, { reactionCount: count + 1 })
    return { added: true }
  },
})
