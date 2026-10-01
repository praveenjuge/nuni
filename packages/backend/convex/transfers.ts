import { LIMITS, randomBase58 } from "@nuni/shared"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  currentUser,
  fail,
  requireDashboardOwner,
  requireUser,
  revokeSessions,
  sha256Hex,
} from "./lib"

const TOKEN_PREFIX = "nuni_t_"

async function transferByToken(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<Doc<"transfers"> | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null
  const tokenHash = await sha256Hex(token)
  const transfer = await ctx.db
    .query("transfers")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique()
  return transfer && transfer.expiresAt > Date.now() ? transfer : null
}

async function clearTransfers(ctx: MutationCtx, project: Doc<"projects">) {
  const old = await ctx.db
    .query("transfers")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect()
  for (const transfer of old) await ctx.db.delete(transfer._id)
}

/**
 * Make a link that hands the project to whoever opens it signed in. Any
 * earlier link stops working. The token is returned once.
 */
export const create = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { user, project } = await requireDashboardOwner(ctx, projectId)
    await clearTransfers(ctx, project)
    const token = `${TOKEN_PREFIX}${randomBase58(32)}`
    const expiresAt = Date.now() + LIMITS.transferTtlMs
    await ctx.db.insert("transfers", {
      projectId,
      fromUserId: user._id,
      tokenHash: await sha256Hex(token),
      expiresAt,
    })
    return { token, expiresAt }
  },
})

export const cancel = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { project } = await requireDashboardOwner(ctx, projectId)
    await clearTransfers(ctx, project)
  },
})

/** The owner's open transfer link, if any (its expiry; not the token). */
export const active = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await currentUser(ctx)
    const project = await ctx.db.get(projectId)
    if (!user || project?.ownerId !== user._id) return null
    const transfers = await ctx.db
      .query("transfers")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
    const open = transfers.find((t) => t.expiresAt > Date.now())
    return open ? { expiresAt: open.expiresAt } : null
  },
})

/** What the recipient sees before accepting. */
export const get = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const transfer = await transferByToken(ctx, token)
    if (!transfer) return null
    const project = await ctx.db.get(transfer.projectId)
    // The sender no longer owns it (released, deleted or handed on).
    if (
      !project ||
      project.deletingAt ||
      project.ownerId !== transfer.fromUserId
    ) {
      return null
    }
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
    const transfer = await transferByToken(ctx, token)
    if (!transfer) fail("not_found", "This transfer link expired or was used")
    const project = await ctx.db.get(transfer.projectId)
    if (
      !project ||
      project.deletingAt ||
      project.ownerId !== transfer.fromUserId
    ) {
      fail("not_found", "This transfer link expired or was used")
    }
    if (project.ownerId === user._id) {
      fail("already_owner", "You already own this project")
    }
    await ctx.db.patch(project._id, {
      ownerId: user._id,
      claimedAt: Date.now(),
      lastActivityAt: Date.now(),
    })
    await revokeSessions(ctx, project._id)
    await clearTransfers(ctx, project)
    await ctx.db.insert("claims", { projectId: project._id, userId: user._id })
    return { publicId: project.publicId }
  },
})

const CLEANUP_BATCH = 500

/** Daily cron: delete expired transfer links. */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("transfers")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH)
    for (const transfer of expired) await ctx.db.delete(transfer._id)
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.transfers.cleanupExpired, {})
    }
    return expired.length
  },
})
