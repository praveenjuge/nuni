import { LIMITS } from "@nuni/shared"
import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { currentUser, requireUser } from "./accounts"
import { fail, type Ctx } from "./lib"
import {
  clearTransfers,
  dashboardProject,
  projectRef,
  requireDashboardProject,
  setOwner,
} from "./ownership"
import { findByToken, mintToken } from "./tokens"

/**
 * A link's project, while the person who made the link still owns it (not
 * released, deleted or handed on).
 */
async function linkedProject(ctx: Ctx, token: string) {
  const transfer = await findByToken(ctx, "transfers", token)
  const project = transfer ? await ctx.db.get(transfer.projectId) : null
  if (
    !transfer ||
    !project ||
    project.deletingAt ||
    project.ownerId !== transfer.fromUserId
  ) {
    return null
  }
  return { transfer, project }
}

/**
 * Make a link that hands the project to whoever opens it signed in. Any
 * earlier link stops working. The token is returned once.
 */
export const create = mutation({
  args: projectRef,
  handler: async (ctx, ref) => {
    const { userId, project } = await requireDashboardProject(ctx, ref)
    await clearTransfers(ctx, project._id)
    const { token, hash } = await mintToken("transfers")
    const expiresAt = Date.now() + LIMITS.transferTtlMs
    await ctx.db.insert("transfers", {
      projectId: project._id,
      fromUserId: userId,
      tokenHash: hash,
      expiresAt,
    })
    return { token, expiresAt }
  },
})

export const cancel = mutation({
  args: projectRef,
  handler: async (ctx, ref) => {
    const { project } = await requireDashboardProject(ctx, ref)
    await clearTransfers(ctx, project._id)
  },
})

/** The owner's open transfer link, if any (its expiry; not the token). */
export const active = query({
  args: projectRef,
  handler: async (ctx, ref) => {
    const project = await dashboardProject(ctx, ref)
    if (!project) return null
    const transfers = await ctx.db
      .query("transfers")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect()
    const open = transfers.find((t) => t.expiresAt > Date.now())
    return open ? { expiresAt: open.expiresAt } : null
  },
})

/** What the recipient sees before accepting. */
export const get = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const linked = await linkedProject(ctx, token)
    if (!linked) return null
    const { transfer, project } = linked
    const [from, user] = await Promise.all([
      ctx.db.get(transfer.fromUserId),
      currentUser(ctx),
    ])
    return {
      publicId: project.publicId,
      name: project.name,
      commentCount: project.commentCount,
      fromName: from?.name ?? "The owner",
      expiresAt: transfer.expiresAt,
      isOwner: user?._id === project.ownerId,
    }
  },
})

/**
 * Take over the project. Every session of the old owner is signed out,
 * so their widgets and CLI lose owner access right away.
 */
export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx)
    const linked = await linkedProject(ctx, token)
    if (!linked) fail("not_found", "This transfer link expired or was used")
    const { project } = linked
    if (project.ownerId === user._id) {
      fail("already_owner", "You already own this project")
    }
    await setOwner(ctx, project, user._id)
    return { publicId: project.publicId }
  },
})
