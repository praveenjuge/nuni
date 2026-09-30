import { LIMITS, randomBase58 } from "@nuni/shared"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation, mutation, query } from "./_generated/server"
import {
  fail,
  parseOrigin,
  projectByPublicId,
  requireUser,
  sessionFromToken,
  sha256Hex,
  currentUser,
} from "./lib"
import { rateLimiter } from "./rateLimits"

/**
 * Create a widget owner session for one origin. The raw token is returned
 * once and handed to the widget via postMessage; only its hash is stored.
 */
export const create = mutation({
  args: {
    publicId: v.string(),
    origin: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { publicId, origin, userAgent }) => {
    const user = await requireUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!project) fail("not_found", "Project not found")
    if (project.ownerId !== user._id) {
      fail("forbidden", "Only the project owner can do this")
    }
    // The token is postMessage'd to this origin verbatim, so it must be one
    // of the project's registered origins - otherwise a crafted claim link
    // could deliver an owner session to any host.
    const cleanOrigin = parseOrigin(origin)
    if (!project.origins.includes(cleanOrigin)) {
      fail(
        "unknown_origin",
        "This origin is not registered for the project. Add it from the dashboard first."
      )
    }
    const { ok } = await rateLimiter.limit(ctx, "sessionPerUser", {
      key: user._id,
    })
    if (!ok) fail("rate_limited", "Too many sign-ins, try again later")

    const token = `nuni_s_${randomBase58(40)}`
    await ctx.db.insert("widgetSessions", {
      tokenHash: await sha256Hex(token),
      userId: user._id,
      projectId: project._id,
      origin: cleanOrigin,
      userAgent: userAgent?.slice(0, 400),
      expiresAt: Date.now() + LIMITS.sessionTtlMs,
    })
    return { token, expiresAt: Date.now() + LIMITS.sessionTtlMs }
  },
})

/** Widget check: is this stored token still an owner session for the project? */
export const validate = query({
  args: { publicId: v.string(), sessionToken: v.string() },
  handler: async (ctx, { publicId, sessionToken }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return { valid: false as const }
    const session = await sessionFromToken(ctx, sessionToken)
    if (
      !session ||
      session.projectId !== project._id ||
      project.ownerId !== session.userId
    ) {
      return { valid: false as const }
    }
    const user = await ctx.db.get(session.userId)
    return { valid: true as const, ownerName: user?.name ?? "Owner" }
  },
})

export const listMine = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const user = await currentUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!user || !project || project.ownerId !== user._id) return []
    const sessions = await ctx.db
      .query("widgetSessions")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect()
    return sessions
      .filter((s) => s.expiresAt > Date.now())
      .map((s) => ({
        _id: s._id,
        _creationTime: s._creationTime,
        origin: s.origin,
        userAgent: s.userAgent,
        expiresAt: s.expiresAt,
      }))
  },
})

export const revoke = mutation({
  args: { id: v.id("widgetSessions") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const session = await ctx.db.get(id)
    if (!session) return
    const project = await ctx.db.get(session.projectId)
    if (project?.ownerId !== user._id) fail("forbidden", "Not your session")
    await ctx.db.delete(id)
  },
})

/** Widget sign-out: the widget revokes its own token. */
export const revokeOwn = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await sessionFromToken(ctx, sessionToken)
    if (session) await ctx.db.delete(session._id)
  },
})

const CLEANUP_BATCH = 500

/** Daily cron: delete expired widget sessions, continuing until none are left. */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("widgetSessions")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH)
    for (const session of expired) await ctx.db.delete(session._id)
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.sessions.cleanupExpired, {})
    }
    return expired.length
  },
})
