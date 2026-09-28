import { LIMITS } from "@nuni/shared"
import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import {
  assertProjectId,
  ensureProject,
  fail,
  parseOrigin,
  projectByPublicId,
  requireOwner,
  requireUser,
  currentUser,
} from "./lib"
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

    await ctx.db.patch(project._id, {
      ownerId: user._id,
      claimedAt: Date.now(),
      lastActivityAt: Date.now(),
    })
    await ctx.db.insert("claims", {
      projectId: project._id,
      userId: user._id,
      origin: cleanOrigin,
    })
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
    return projects.map((p) => ({
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
    return project
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
