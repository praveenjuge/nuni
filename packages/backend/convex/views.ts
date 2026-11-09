import type { OwnerComment, ReplyView, WidgetComment } from "@nuni/shared"

import type { Doc, Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { authorLookup, type AuthorLookup } from "./authors"
import { SERVER_LIMITS } from "./limits"

/** What clients receive for comments and replies. */

export async function toPublic(
  c: Doc<"comments">,
  author: AuthorLookup
): Promise<WidgetComment> {
  return {
    _id: c._id,
    _creationTime: c._creationTime,
    status: c.status,
    body: c.body,
    suggestion: c.suggestion,
    authorKeyHash: c.authorKeyHash,
    // Public listings share comments across origins by path, so never expose
    // another environment's full URL (its query string may be sensitive).
    page: { origin: c.page.origin, path: c.page.path, title: c.page.title },
    anchor: c.anchor,
    viewport: c.viewport,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    resolvedAt: c.resolvedAt,
    resolution: c.resolution,
    imageCount: c.images?.length ?? 0,
    pinLost: c.pinLostAt !== undefined,
    replyCount: c.replyCount ?? 0,
    ...(await author(c)),
  }
}

/** Full shape for the owner: page URL, user agent and captured context. */
export async function toOwner(
  ctx: QueryCtx,
  c: Doc<"comments">,
  author: AuthorLookup = authorLookup(ctx)
): Promise<OwnerComment> {
  return {
    ...(await toPublic(c, author)),
    page: c.page,
    pinLostAt: c.pinLostAt,
    userAgent: c.userAgent,
    context: c.context,
    screenshotUrl: c.screenshotId
      ? await ctx.storage.getUrl(c.screenshotId)
      : null,
    imageUrls: await imageUrls(ctx, c),
    replies: c.replyCount ? await repliesFor(ctx, c._id, author) : [],
  }
}

export async function imageUrls(
  ctx: QueryCtx,
  c: Doc<"comments">
): Promise<string[]> {
  const urls = await Promise.all(
    (c.images ?? []).map((id) => ctx.storage.getUrl(id))
  )
  return urls.filter((url): url is string => url !== null)
}

async function toReplyView(
  r: Doc<"replies">,
  author: AuthorLookup
): Promise<ReplyView> {
  return {
    _id: r._id,
    commentId: r.commentId,
    body: r.body,
    authorKeyHash: r.authorKeyHash,
    isOwner: Boolean(r.ownerId),
    createdAt: r.createdAt,
    editedAt: r.editedAt,
    ...(await author(r)),
  }
}

export async function repliesFor(
  ctx: QueryCtx,
  commentId: Id<"comments">,
  author: AuthorLookup = authorLookup(ctx)
) {
  const replies = await ctx.db
    .query("replies")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .take(SERVER_LIMITS.repliesPerComment)
  return Promise.all(replies.map((r) => toReplyView(r, author)))
}
