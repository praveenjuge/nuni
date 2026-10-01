import { LIMITS } from "@nuni/shared"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation, mutation, query } from "./_generated/server"
import {
  assertProjectId,
  claimFor,
  ensureProject,
  fail,
  parseOrigin,
  projectByPublicId,
  requireDashboardOwner,
  requireOwner,
  requireUser,
  revokeSessions,
  currentUser,
} from "./lib"
import { deleteThread } from "./replies"
import { rateLimiter } from "./rateLimits"

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

/** Claim an unclaimed project. First come, first served. */
export const claim = mutation({
  args: { publicId: v.string(), origin: v.optional(v.string()) },
  handler: async (ctx, { publicId, origin }) => {
    assertProjectId(publicId)
    const user = await requireUser(ctx)
    const cleanOrigin = origin ? parseOrigin(origin) : undefined
    const project = cleanOrigin
      ? await ensureProject(ctx, publicId, cleanOrigin)
      : ((await projectByPublicId(ctx, publicId)) ??
        fail("not_found", "This project has not been used yet"))

    if (project.ownerId === user._id) {
      return { status: "already_owner" as const, projectId: project._id }
    }
    if (project.ownerId) {
      const owner = await ctx.db.get(project.ownerId)
      return {
        status: "claimed_by_other" as const,
        ownerName: owner?.name ?? "someone else",
      }
    }

    await claimFor(ctx, project, user._id, cleanOrigin)
    return { status: "claimed" as const, projectId: project._id }
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
      .take(200)
    return projects
      .filter((p) => !p.deletingAt)
      .map((p) => ({
        _id: p._id,
        publicId: p.publicId,
        name: p.name,
        origins: p.origins,
        commentCount: p.commentCount,
        openCount: p.openCount,
        lastActivityAt: p.lastActivityAt,
        claimedAt: p.claimedAt,
      }))
  },
})

export const getMine = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const user = await currentUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!user || !project || project.ownerId !== user._id) return null
    if (project.deletingAt) return null
    return project
  },
})

/**
 * Register a new origin for a claimed project, so the owner can allow owner
 * tools on it. Unclaimed projects collect origins automatically; claimed
 * ones only grow here, because widget owner sessions are bound to this list.
 */
export const addOrigin = mutation({
  args: { projectId: v.id("projects"), origin: v.string() },
  handler: async (ctx, { projectId, origin }) => {
    await requireOwner(ctx, projectId)
    const project = await ctx.db.get(projectId)
    if (!project) fail("not_found", "Project not found")
    const clean = parseOrigin(origin)
    if (project.origins.includes(clean)) return
    if (project.origins.length >= LIMITS.maxOriginsPerProject) {
      fail(
        "cap_reached",
        `A project can have at most ${LIMITS.maxOriginsPerProject} origins`
      )
    }
    await ctx.db.patch(projectId, { origins: [...project.origins, clean] })
  },
})

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    await requireOwner(ctx, projectId)
    const clean = name.trim().slice(0, LIMITS.nameMaxLength * 2)
    if (!clean) fail("invalid_name", "Name cannot be empty")
    await ctx.db.patch(projectId, { name: clean })
  },
})

/**
 * Give the project up: it becomes unclaimed again, so anyone can claim it
 * from the widget. Comments stay; every owner session is signed out.
 */
export const release = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { project } = await requireDashboardOwner(ctx, projectId)
    await ctx.db.patch(project._id, {
      ownerId: undefined,
      claimedAt: undefined,
    })
    await revokeSessions(ctx, project._id)
    const transfers = await ctx.db
      .query("transfers")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect()
    for (const transfer of transfers) await ctx.db.delete(transfer._id)
  },
})

/**
 * Delete the project and everything in it. The name has to be typed to
 * confirm. Runs in batches in the background; until it is done the project
 * is hidden and takes no new comments.
 */
export const remove = mutation({
  args: { projectId: v.id("projects"), confirmName: v.string() },
  handler: async (ctx, { projectId, confirmName }) => {
    const { project } = await requireDashboardOwner(ctx, projectId)
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

const DELETE_BATCH = 100

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
      .take(DELETE_BATCH)
    for (const comment of comments) {
      await deleteThread(ctx, comment._id)
      if (comment.screenshotId) await ctx.storage.delete(comment.screenshotId)
      await ctx.db.delete(comment._id)
    }
    if (comments.length) {
      await again()
      return "comments"
    }

    const rest = await Promise.all([
      ctx.db
        .query("pageStats")
        .withIndex("by_project_path", (q) => q.eq("projectId", projectId))
        .take(DELETE_BATCH),
      ctx.db
        .query("widgetSessions")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(DELETE_BATCH),
      ctx.db
        .query("transfers")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(DELETE_BATCH),
      ctx.db
        .query("claims")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(DELETE_BATCH),
      // A CLI sign-in waiting for approval must not carry over to a new
      // project the widget starts later with the same ID.
      ctx.db
        .query("cliLogins")
        .withIndex("by_publicId", (q) => q.eq("publicId", project.publicId))
        .take(DELETE_BATCH),
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
