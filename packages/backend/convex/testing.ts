import { LIMITS, randomBase58 } from "@nuni/shared"
import { v } from "convex/values"

import { internalMutation, internalQuery } from "./_generated/server"
import {
  ensureProject,
  fail,
  parseOrigin,
  projectByPublicId,
  sha256Hex,
} from "./lib"

/**
 * E2E helper: create an owner, claim a project and return a widget session
 * token. Internal (CLI/admin only) and refused unless NUNI_ALLOW_TESTING=1.
 *
 *   npx convex run testing:seedOwner '{"publicId":"nuni_...","origin":"http://127.0.0.1:5173"}'
 */
export const seedOwner = internalMutation({
  args: {
    publicId: v.string(),
    origin: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { publicId, origin, name }) => {
    if (process.env.NUNI_ALLOW_TESTING !== "1")
      fail("forbidden", "Testing helpers are disabled")
    const cleanOrigin = parseOrigin(origin)
    const userId = await ctx.db.insert("users", {
      workosId: `test_${randomBase58(12)}`,
      name: name ?? "Test Owner",
    })
    const project = await ensureProject(ctx, publicId, cleanOrigin)
    await ctx.db.patch(project._id, { ownerId: userId, claimedAt: Date.now() })
    const token = `nuni_s_${randomBase58(40)}`
    await ctx.db.insert("widgetSessions", {
      tokenHash: await sha256Hex(token),
      userId,
      projectId: project._id,
      origin: cleanOrigin,
      expiresAt: Date.now() + LIMITS.sessionTtlMs,
    })
    return { token }
  },
})

/**
 * E2E helper: approve a pending `nuni login` as the project's owner, in
 * place of the dashboard page. Refused unless NUNI_ALLOW_TESTING=1.
 */
export const approveCliLogin = internalMutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    if (process.env.NUNI_ALLOW_TESTING !== "1")
      fail("forbidden", "Testing helpers are disabled")
    const login = await ctx.db
      .query("cliLogins")
      .withIndex("by_userCode", (q) => q.eq("userCode", userCode))
      .first()
    if (!login) fail("not_found", "No such login")
    const project = await projectByPublicId(ctx, login.publicId)
    if (!project?.ownerId) fail("forbidden", "Project has no owner")
    await ctx.db.patch(login._id, {
      status: "approved",
      userId: project.ownerId,
    })
  },
})

/** Inspect webhook delivery without signing in (which would upsert the user). */
export const authUser = internalQuery({
  args: { workosId: v.string() },
  handler: async (ctx, { workosId }) => {
    if (process.env.NUNI_ALLOW_TESTING !== "1")
      fail("forbidden", "Testing helpers are disabled")
    return ctx.db
      .query("users")
      .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
      .unique()
  },
})

/** Explicit local cleanup only; unique IDs are preferred for ordinary tests. */
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.NUNI_ALLOW_TESTING !== "1")
      fail("forbidden", "Testing helpers are disabled")
    const tables = [
      "reactions",
      "replies",
      "comments",
      "pageStats",
      "widgetSessions",
      "cliLogins",
      "transfers",
      "claims",
      "projects",
      "users",
    ] as const
    for (const table of tables) {
      for (const row of await ctx.db.query(table).collect()) {
        if (table === "comments" && "screenshotId" in row && row.screenshotId)
          await ctx.storage.delete(row.screenshotId)
        await ctx.db.delete(row._id)
      }
    }
  },
})
