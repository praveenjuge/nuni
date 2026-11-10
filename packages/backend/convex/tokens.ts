import {
  LIMITS,
  randomBase58,
  sha256Hex,
  TOKEN_PREFIX,
  type ErrorData,
} from "@nuni/shared"

import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { clampString, fail, parseOrigin, type Ctx } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { rateLimiter } from "./rateLimits"

/**
 * Every bearer token Nuni hands out, by the table that keeps its hash. The
 * raw token is returned once; only its hash is stored. All of them expire,
 * and the daily cleanup deletes them.
 */
const TOKENS = {
  widgetSessions: { prefix: TOKEN_PREFIX.session, length: 40 },
  commenterSessions: { prefix: TOKEN_PREFIX.commenter, length: 40 },
  transfers: { prefix: TOKEN_PREFIX.transfer, length: 32 },
  cliLogins: { prefix: TOKEN_PREFIX.device, length: 40 },
} as const

type TokenTable = keyof typeof TOKENS

export async function mintToken(table: TokenTable) {
  const { prefix, length } = TOKENS[table]
  const token = `${prefix}${randomBase58(length)}`
  return { token, hash: await sha256Hex(token) }
}

/** The stored hash to look a token up by, or null when it can't be ours. */
export async function hashOf(
  table: TokenTable,
  token: string
): Promise<string | null> {
  if (
    !token.startsWith(TOKENS[table].prefix) ||
    token.length > SERVER_LIMITS.tokenMaxLength
  ) {
    return null
  }
  return sha256Hex(token)
}

type HashedTable = Exclude<TokenTable, "cliLogins">

/** The row of a token that is ours and hasn't expired. */
export async function findByToken<T extends HashedTable>(
  ctx: Ctx,
  table: T,
  token: string
): Promise<Doc<T> | null> {
  const tokenHash = await hashOf(table, token)
  if (!tokenHash) return null
  const row = (await ctx.db
    .query(table as HashedTable)
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique()) as Doc<T> | null
  return row && row.expiresAt > Date.now() ? row : null
}

/**
 * Owner sessions (the widget's owner tools, or `nuni login` for the CLI and
 * MCP server) and commenter sign-ins. Owner sessions record their `kind`
 * and the browser or client they were made for.
 */
const SESSIONS = {
  owner: {
    table: "widgetSessions",
    ttlMs: LIMITS.sessionTtlMs,
    kind: "widget",
  },
  cli: { table: "widgetSessions", ttlMs: LIMITS.cliSessionTtlMs, kind: "cli" },
  commenter: { table: "commenterSessions", ttlMs: LIMITS.sessionTtlMs },
} as const

type SessionKind = keyof typeof SESSIONS

/** Only owner sessions record the browser or client they are for. */
type UserAgentOf<K extends SessionKind> = K extends "commenter"
  ? { userAgent?: never }
  : { userAgent?: string }

export async function issueSession<K extends SessionKind>(
  ctx: MutationCtx,
  kind: K,
  fields: {
    userId: Id<"users">
    projectId: Id<"projects">
    origin: string
  } & UserAgentOf<K>
): Promise<{ token: string; expiresAt: number }> {
  const session: (typeof SESSIONS)[SessionKind] = SESSIONS[kind]
  const { token, hash } = await mintToken(session.table)
  const expiresAt = Date.now() + session.ttlMs
  const { userId, projectId, origin, userAgent } = fields
  const row = { tokenHash: hash, expiresAt, userId, projectId, origin }
  if (session.table === "commenterSessions") {
    await ctx.db.insert(session.table, row)
  } else {
    await ctx.db.insert(session.table, {
      ...row,
      kind: session.kind,
      userAgent:
        userAgent && clampString(userAgent, SERVER_LIMITS.userAgentMaxLength),
    })
  }
  return { token, expiresAt }
}

const UNKNOWN_ORIGIN = {
  owner:
    "This origin is not registered for the project. Add it from the dashboard first.",
  commenter: "Nuni isn't set up on this site",
}

type SiteKind = "owner" | "commenter"

type SiteSession<K extends SiteKind> = {
  userId: Id<"users">
  project: Doc<"projects">
  origin: string
} & UserAgentOf<K>

/**
 * A session the dashboard hands to the widget on one of the project's sites,
 * or why there can't be one now. The caller has checked who may have it.
 */
export async function siteSession<K extends SiteKind>(
  ctx: MutationCtx,
  kind: K,
  { userId, project, origin, userAgent }: SiteSession<K>
): Promise<{ token: string; expiresAt: number } | { refused: ErrorData }> {
  // The token is postMessage'd to this origin verbatim, so it must be one
  // of the project's registered origins - otherwise a crafted link could
  // deliver it to any host.
  const cleanOrigin = parseOrigin(origin)
  if (!project.origins.includes(cleanOrigin)) {
    return {
      refused: { code: "unknown_origin", message: UNKNOWN_ORIGIN[kind] },
    }
  }
  const { ok } = await rateLimiter.limit(ctx, "sessionPerUser", {
    key: userId,
  })
  if (!ok) {
    return {
      refused: {
        code: "rate_limited",
        message: "Too many sign-ins, try again later",
      },
    }
  }
  const fields = { userId, projectId: project._id, origin: cleanOrigin }
  return kind === "commenter"
    ? issueSession(ctx, "commenter", fields)
    : issueSession(ctx, "owner", { ...fields, userAgent })
}

/** `siteSession`, failing when there can't be one. */
export async function createSiteSession<K extends SiteKind>(
  ctx: MutationCtx,
  kind: K,
  fields: SiteSession<K>
) {
  const session = await siteSession(ctx, kind, fields)
  if ("refused" in session) {
    fail(session.refused.code, session.refused.message)
  }
  return session
}

/** Daily cron: delete expired tokens, continuing until none are left. */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0
    let more = false
    for (const table of Object.keys(TOKENS) as TokenTable[]) {
      const expired = await ctx.db
        .query(table)
        .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
        .take(SERVER_LIMITS.cleanupBatch)
      for (const row of expired) await ctx.db.delete(row._id)
      deleted += expired.length
      more ||= expired.length === SERVER_LIMITS.cleanupBatch
    }
    if (more) {
      await ctx.scheduler.runAfter(0, internal.tokens.cleanupExpired, {})
    }
    return deleted
  },
})
