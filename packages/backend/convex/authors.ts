import type { WidgetAuthor } from "@nuni/shared"

import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { fail, sha256Hex, type Ctx } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { rateLimiter } from "./rateLimits"
import { findByToken } from "./tokens"

/**
 * The `authorKeyHash` on comments, replies and reactions is one of three
 * forms: the sha256 of a browser's secret, `user:<id>` for a signed-in
 * commenter, or `owner:<id>` for an owner reply from the dashboard or an
 * agent. Only the first comes from a secret, so no browser can claim the
 * other two as its own.
 */
export function userAuthorKey(userId: Id<"users">) {
  return `user:${userId}`
}

export function ownerAuthorKey(userId: Id<"users">) {
  return `owner:${userId}`
}

export function validSecret(authorSecret: string) {
  return (
    authorSecret.length >= SERVER_LIMITS.authorSecretMinLength &&
    authorSecret.length <= SERVER_LIMITS.authorSecretMaxLength
  )
}

export function checkSecret(authorSecret: string) {
  if (!validSecret(authorSecret)) fail("invalid_author", "Invalid author key")
}

/** The signed-in commenter of a live commenter token for this project. */
export async function commenterFromToken(
  ctx: Ctx,
  projectId: Id<"projects">,
  token: string
): Promise<Doc<"users"> | null> {
  const session = await findByToken(ctx, "commenterSessions", token)
  return session?.projectId === projectId ? ctx.db.get(session.userId) : null
}

export interface Author {
  /** The key new rows are written with. */
  key: string
  user: Doc<"users"> | null
  /** Every key whose rows this author may change. */
  keys: string[]
}

/**
 * Who is writing from the widget: the signed-in commenter when there is a
 * commenter token, otherwise this browser's key. Null when the secret is
 * malformed or the commenter token no longer works.
 */
export async function findAuthor(
  ctx: Ctx,
  projectId: Id<"projects">,
  { authorSecret, commenterToken }: WidgetAuthor
): Promise<Author | "invalid_author" | "signed_out"> {
  if (!validSecret(authorSecret)) return "invalid_author"
  const browserKey = await sha256Hex(authorSecret)
  if (!commenterToken)
    return { key: browserKey, user: null, keys: [browserKey] }
  const user = await commenterFromToken(ctx, projectId, commenterToken)
  if (!user) return "signed_out"
  const key = userAuthorKey(user._id)
  // This browser's guest comments stay editable while signed in.
  return { key, user, keys: [key, browserKey] }
}

/** Like `findAuthor`, but a token that no longer works fails instead of quietly writing as a guest. */
export async function widgetAuthor(
  ctx: Ctx,
  projectId: Id<"projects">,
  auth: WidgetAuthor
): Promise<Author> {
  const author = await findAuthor(ctx, projectId, auth)
  if (author === "invalid_author") fail(author, "Invalid author key")
  if (author === "signed_out") {
    fail(author, "You've been signed out. Sign in again.")
  }
  return author
}

/**
 * A comment or reply the widget's author may change, within their edit
 * allowance.
 */
export async function requireOwnRow<T extends Doc<"comments" | "replies">>(
  ctx: MutationCtx,
  row: T | null,
  auth: WidgetAuthor,
  noun: "comments" | "replies"
): Promise<T> {
  if (!row)
    fail(
      "not_found",
      noun === "comments" ? "Comment not found" : "Reply not found"
    )
  const { keys } = await widgetAuthor(ctx, row.projectId, auth)
  if (!keys.includes(row.authorKeyHash)) {
    fail("forbidden", `You can only change your own ${noun}`)
  }
  const { ok } = await rateLimiter.limit(ctx, "editPerAuthor", {
    key: row.authorKeyHash,
  })
  if (!ok) fail("rate_limited", "Slow down a little")
  return row
}

/**
 * The name and avatar to show for a comment or reply. Signed-in authors
 * show their account's current ones; each user is read once per call.
 */
export function authorLookup(ctx: QueryCtx) {
  const users = new Map<Id<"users">, Promise<Doc<"users"> | null>>()
  return async (row: { authorId?: Id<"users">; authorName: string }) => {
    if (!row.authorId) return { authorName: row.authorName }
    let user = users.get(row.authorId)
    if (!user) {
      user = ctx.db.get(row.authorId)
      users.set(row.authorId, user)
    }
    const found = await user
    if (!found) return { authorName: row.authorName }
    return {
      authorName: found.name,
      signedIn: true as const,
      avatarUrl: found.avatarUrl,
    }
  }
}

export type AuthorLookup = ReturnType<typeof authorLookup>
