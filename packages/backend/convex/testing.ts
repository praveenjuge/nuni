import { randomBase58 } from "@nuni/shared"
import { v } from "convex/values"

import { internalMutation, internalQuery } from "./_generated/server"
import { userByWorkosId } from "./accounts"
import { loginByCode } from "./cliAuth"
import { fail, parseOrigin, projectByPublicId } from "./lib"
import { ensureProject, setOwner } from "./ownership"
import { issueSession } from "./tokens"

/**
 * Helpers for the e2e suite, run with `npx convex run testing:<name>`.
 * Internal, and refused unless the deployment sets NUNI_ALLOW_TESTING=1.
 */
function allowTesting() {
  if (process.env.NUNI_ALLOW_TESTING !== "1") {
    fail("forbidden", "Testing helpers are disabled")
  }
}

/**
 * Create an owner, claim a project and return a widget session token.
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
    allowTesting()
    const cleanOrigin = parseOrigin(origin)
    const userId = await ctx.db.insert("users", {
      workosId: `test_${randomBase58(12)}`,
      name: name ?? "Test Owner",
    })
    const project = await ensureProject(ctx, publicId, cleanOrigin)
    await setOwner(ctx, project, userId, cleanOrigin)
    const { token } = await issueSession(ctx, "owner", {
      userId,
      projectId: project._id,
      origin: cleanOrigin,
    })
    return { token }
  },
})

/** Approve a pending `nuni login` as the project's owner, in place of the dashboard page. */
export const approveCliLogin = internalMutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    allowTesting()
    const login = await loginByCode(ctx, userCode)
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
    allowTesting()
    return userByWorkosId(ctx, workosId)
  },
})
