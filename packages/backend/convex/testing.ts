import { LIMITS, randomBase58 } from "@nuni/shared"
import { v } from "convex/values"

import { internalMutation } from "./_generated/server"
import { ensureProject, fail, parseOrigin, sha256Hex } from "./lib"

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
