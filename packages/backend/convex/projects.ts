import { LIMITS } from "@nuni/shared"
import { emailFrequencyValidator } from "@nuni/shared/validators"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, mutation, query } from "./_generated/server"
import { currentUser } from "./accounts"
import { emailFrequencyOf, setEmailFrequency } from "./digests"
import { deleteCommentRows } from "./lifecycle"
import { assertProjectId, fail, parseOrigin, projectByPublicId } from "./lib"
import { SERVER_LIMITS } from "./limits"
import {
  dashboardProject,
  ensureProject,
  requireDashboardProject,
  revokeSessions,
  setOwner,
} from "./ownership"
import { rateLimiter } from "./rateLimits"

/** A project as its owner sees it in the dashboard. */
function forOwner(p: Doc<"projects">) {
  return {
    _id: p._id,
    _creationTime: p._creationTime,
    publicId: p.publicId,
    name: p.name,
    origins: p.origins,
    commentCount: p.commentCount,
    openCount: p.openCount,
    lastActivityAt: p.lastActivityAt,
  }
}

/** Called by the widget on load. Creates the unclaimed project lazily. */
export const touch = mutation({
  args: { publicId: v.string(), origin: v.string() },
  handler: async (ctx, { publicId, origin }) => {
    assertProjectId(publicId)
    const cleanOrigin = parseOrigin(origin)
    const { ok } = await rateLimiter.limit(ctx, "touchPerProject", {
      key: publicId,
    })
    if (!ok) return null
    const project = await ensureProject(ctx, publicId, cleanOrigin)
    return { claimed: Boolean(project.ownerId) }
  },
})

/** Public project status for the widget. */
export const status = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) {
      return { exists: false, claimed: false, ownerName: null, openCount: 0 }
    }
    const owner = project.ownerId ? await ctx.db.get(project.ownerId) : null
    return {
      exists: true,
      claimed: Boolean(project.ownerId),
      ownerName: owner?.name ?? null,
      openCount: project.openCount,
    }
  },
})

/** What the claim page shows before the user confirms. Read-only. */
export const claimStatus = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const user = await currentUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!project?.ownerId) return { state: "unclaimed" as const }
    if (user && project.ownerId === user._id) return { state: "mine" as const }
    const owner = await ctx.db.get(project.ownerId)
    return { state: "other" as const, ownerName: owner?.name ?? "someone else" }
  },
})

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(SERVER_LIMITS.projectsListMax)
    return projects.filter((p) => !p.deletingAt).map(forOwner)
  },
})

export const getMine = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await dashboardProject(ctx, publicId)
    return project && forOwner(project)
  },
})

/**
 * Register a new origin for a claimed project, so the owner can allow owner
 * tools on it. Unclaimed projects collect origins automatically; claimed
 * ones only grow here, because widget owner sessions are bound to this list.
 */
export const addOrigin = mutation({
  args: { publicId: v.string(), origin: v.string() },
  handler: async (ctx, { origin, publicId }) => {
    const { project } = await requireDashboardProject(ctx, publicId)
    const clean = parseOrigin(origin)
    if (project.origins.includes(clean)) return
    if (project.origins.length >= SERVER_LIMITS.maxOriginsPerProject) {
      fail(
        "cap_reached",
        `A project can have at most ${SERVER_LIMITS.maxOriginsPerProject} origins`
      )
    }
    await ctx.db.patch(project._id, { origins: [...project.origins, clean] })
  },
})

/**
 * Stop treating a site as the project's. Owner and commenter sign-ins made
 * on it are signed out. Its comments stay, and the widget there still loads,
 * but owner tools need the site added again.
 */
export const removeOrigin = mutation({
  args: { publicId: v.string(), origin: v.string() },
  handler: async (ctx, { origin, publicId }) => {
    const { project } = await requireDashboardProject(ctx, publicId)
    const clean = parseOrigin(origin)
    if (!project.origins.includes(clean)) return
    await ctx.db.patch(project._id, {
      origins: project.origins.filter((o) => o !== clean),
    })
    for (const table of ["widgetSessions", "commenterSessions"] as const) {
      const sessions = await ctx.db
        .query(table)
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect()
      for (const session of sessions) {
        if (session.origin === clean) await ctx.db.delete(session._id)
      }
    }
  },
})

export const rename = mutation({
  args: { publicId: v.string(), name: v.string() },
  handler: async (ctx, { name, publicId }) => {
    const { project } = await requireDashboardProject(ctx, publicId)
    const clean = name.trim().slice(0, LIMITS.projectNameMaxLength)
    if (!clean) fail("invalid_name", "Name cannot be empty")
    await ctx.db.patch(project._id, { name: clean })
  },
})

/** How often the owner is emailed about this project, and where. */
export const emailSettings = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await dashboardProject(ctx, publicId)
    if (!project?.ownerId) return null
    const owner = await ctx.db.get(project.ownerId)
    return {
      frequency: emailFrequencyOf(project),
      email: owner?.email ?? null,
    }
  },
})

export const setEmails = mutation({
  args: { publicId: v.string(), frequency: emailFrequencyValidator },
  handler: async (ctx, { publicId, frequency }) => {
    const { project } = await requireDashboardProject(ctx, publicId)
    await setEmailFrequency(ctx, project, frequency)
  },
})

/**
 * Give the project up: it becomes unclaimed again, so anyone can claim it
 * from the widget. Comments stay; every owner session is signed out.
 */
export const release = mutation({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const { project } = await requireDashboardProject(ctx, publicId)
    await setOwner(ctx, project, null)
  },
})

/**
 * Delete the project and everything in it. The name has to be typed to
 * confirm. Runs in batches in the background; until it is done the project
 * is hidden and takes no new comments.
 */
export const remove = mutation({
  args: { publicId: v.string(), confirmName: v.string() },
  handler: async (ctx, { confirmName, publicId }) => {
    const { project } = await requireDashboardProject(ctx, publicId)
    if (confirmName.trim() !== project.name.trim()) {
      fail("invalid_name", "Type the project name to confirm")
    }
    await ctx.db.patch(project._id, { deletingAt: Date.now() })
    await revokeSessions(ctx, project._id)
    await ctx.scheduler.runAfter(0, internal.projects.deleteBatch, {
      projectId: project._id,
    })
  },
})

/** One step of a project delete; schedules the next until nothing is left. */
export const deleteBatch = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId)
    if (!project?.deletingAt) return "done"
    const again = () =>
      ctx.scheduler.runAfter(0, internal.projects.deleteBatch, { projectId })

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_project_status", (q) => q.eq("projectId", projectId))
      .take(SERVER_LIMITS.deleteBatch)
    for (const comment of comments) await deleteCommentRows(ctx, comment)
    if (comments.length) {
      await again()
      return "comments"
    }

    const rest = await Promise.all([
      ctx.db
        .query("pageStats")
        .withIndex("by_project_path", (q) => q.eq("projectId", projectId))
        .take(SERVER_LIMITS.deleteBatch),
      ctx.db
        .query("widgetSessions")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(SERVER_LIMITS.deleteBatch),
      ctx.db
        .query("commenterSessions")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(SERVER_LIMITS.deleteBatch),
      ctx.db
        .query("transfers")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(SERVER_LIMITS.deleteBatch),
      ctx.db
        .query("claims")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(SERVER_LIMITS.deleteBatch),
      ctx.db
        .query("emailActivity")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(SERVER_LIMITS.deleteBatch),
      ctx.db
        .query("emailUnsubscribes")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(SERVER_LIMITS.deleteBatch),
      // A CLI sign-in waiting for approval must not carry over to a new
      // project the widget starts later with the same ID.
      ctx.db
        .query("cliLogins")
        .withIndex("by_publicId", (q) => q.eq("publicId", project.publicId))
        .take(SERVER_LIMITS.deleteBatch),
    ])
    const rows = rest.flat()
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length) {
      await again()
      return "rest"
    }
    await ctx.db.delete(projectId)
    return "done"
  },
})
