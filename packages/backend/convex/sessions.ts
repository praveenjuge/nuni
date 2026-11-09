import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { nameOf, requireUser } from "./accounts"
import { fail, parseOrigin, projectByPublicId } from "./lib"
import {
  dashboardProject,
  ensureProject,
  ownerOf,
  projectRef,
  requireDashboardProject,
  claimFor,
  revokeSessions,
} from "./ownership"
import { createSiteSession, findByToken } from "./tokens"

/**
 * Owner sessions: the widget's owner tools on one of the project's sites,
 * and the CLI and MCP server (see cliAuth.ts).
 */

/**
 * Create a widget owner session for one origin. The raw token is returned
 * once and handed to the widget via postMessage.
 */
export const create = mutation({
  args: {
    publicId: v.string(),
    origin: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { publicId, origin, userAgent }) => {
    const { userId, project } = await requireDashboardProject(ctx, {
      publicId,
    })
    return createSiteSession(ctx, "owner", {
      userId,
      project,
      origin,
      userAgent,
    })
  },
})

/**
 * The claim page's one step: claim the project if nobody owns it, then
 * create a widget owner session for `origin`, which the widget registers
 * while the project is unclaimed.
 */
export const allowOwnerTools = mutation({
  args: {
    publicId: v.string(),
    origin: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { publicId, origin, userAgent }) => {
    const user = await requireUser(ctx)
    const cleanOrigin = parseOrigin(origin)
    const project = await ensureProject(ctx, publicId, cleanOrigin)
    const claim = await claimFor(ctx, project, user._id, cleanOrigin)
    if (claim.status === "claimed_by_other") return claim
    const session = await createSiteSession(ctx, "owner", {
      userId: user._id,
      project,
      origin: cleanOrigin,
      userAgent,
    })
    return { ...claim, ...session }
  },
})

/** Widget check: is this stored token still an owner session for the project? */
export const validate = query({
  args: { publicId: v.string(), sessionToken: v.string() },
  handler: async (ctx, { publicId, sessionToken }) => {
    const project = await projectByPublicId(ctx, publicId)
    const ownerId = await ownerOf(ctx, project, sessionToken)
    if (!ownerId) return { valid: false as const }
    return { valid: true as const, ownerName: await nameOf(ctx, ownerId) }
  },
})

export const listMine = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await dashboardProject(ctx, { publicId })
    if (!project) return []
    const sessions = await ctx.db
      .query("widgetSessions")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect()
    return sessions
      .filter((s) => s.expiresAt > Date.now())
      .map((s) => ({
        _id: s._id,
        _creationTime: s._creationTime,
        kind: s.kind ?? "widget",
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

export const revokeAll = mutation({
  args: projectRef,
  handler: async (ctx, ref) => {
    const { project } = await requireDashboardProject(ctx, ref)
    return await revokeSessions(ctx, project._id)
  },
})

/** Widget and CLI sign-out: revoke this token. */
export const revokeOwn = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await findByToken(ctx, "widgetSessions", sessionToken)
    if (session) await ctx.db.delete(session._id)
  },
})
