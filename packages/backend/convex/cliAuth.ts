import {
  generateUserCode,
  isUserCode,
  LIMITS,
  randomBase58,
} from "@nuni/shared"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { internalMutation, mutation, query } from "./_generated/server"
import {
  assertProjectId,
  claimFor,
  currentUser,
  fail,
  projectByPublicId,
  requireUser,
  sha256Hex,
} from "./lib"
import { ipKey, rateLimiter } from "./rateLimits"

/**
 * `nuni login` is a device-code sign-in, so it also works for agents in
 * remote sandboxes where a localhost callback can't reach the browser:
 *
 * 1. The CLI starts a login for one project (`/cli/login/start`) and gets a
 *    device secret plus a short user code.
 * 2. The owner opens `/dashboard/cli?code=…`, checks the code matches the
 *    terminal, and approves (claiming the project first if nobody owns it).
 * 3. The CLI polls with its secret (`/cli/login/poll`) and receives a
 *    session token once, the same kind the widget uses (project-scoped,
 *    hashed at rest, revocable from the dashboard).
 */

async function loginByCode(ctx: QueryCtx | MutationCtx, userCode: string) {
  const code = userCode.trim().toUpperCase()
  if (!isUserCode(code)) return null
  return ctx.db
    .query("cliLogins")
    .withIndex("by_userCode", (q) => q.eq("userCode", code))
    .first()
}

/** Step 1, from the HTTP action. */
export const start = internalMutation({
  args: { publicId: v.string(), client: v.string(), ip: v.string() },
  handler: async (ctx, { publicId, client, ip }) => {
    assertProjectId(publicId)
    const { ok } = await rateLimiter.limit(ctx, "cliLoginPerIp", {
      key: ipKey(ip, publicId),
    })
    if (!ok) fail("rate_limited", "Too many sign-ins, try again later")
    const project = await projectByPublicId(ctx, publicId)
    if (!project) {
      fail(
        "not_found",
        "Nuni hasn't been used with this project ID yet. Open your site with Nuni installed first."
      )
    }

    let userCode = generateUserCode()
    // Codes are short: make sure no other login is waiting with this one.
    while (await loginByCode(ctx, userCode)) userCode = generateUserCode()
    const deviceSecret = `nuni_d_${randomBase58(40)}`
    const expiresAt = Date.now() + LIMITS.cliLoginTtlMs
    await ctx.db.insert("cliLogins", {
      secretHash: await sha256Hex(deviceSecret),
      userCode,
      publicId,
      status: "pending",
      client: client.slice(0, 200) || "Nuni CLI",
      expiresAt,
    })
    return { deviceSecret, userCode, expiresAt }
  },
})

/**
 * Step 3, from the HTTP action. Returns a status instead of throwing for
 * the final states, so deleting the finished login is not rolled back.
 */
export const poll = internalMutation({
  args: { deviceSecret: v.string(), ip: v.string() },
  handler: async (ctx, { deviceSecret, ip }) => {
    const { ok } = await rateLimiter.limit(ctx, "cliPollPerIp", { key: ip })
    if (!ok) fail("rate_limited", "Polling too fast")
    const secretHash = await sha256Hex(deviceSecret)
    const login = deviceSecret
      ? await ctx.db
          .query("cliLogins")
          .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
          .unique()
      : null
    if (!login) return { status: "expired" as const }
    if (login.expiresAt < Date.now()) {
      await ctx.db.delete(login._id)
      return { status: "expired" as const }
    }
    if (login.status === "pending") return { status: "pending" as const }
    await ctx.db.delete(login._id)
    if (login.status === "denied") return { status: "denied" as const }

    const project = await projectByPublicId(ctx, login.publicId)
    if (
      !project ||
      project.deletingAt ||
      !login.userId ||
      project.ownerId !== login.userId
    ) {
      return { status: "denied" as const }
    }
    const token = `nuni_s_${randomBase58(40)}`
    const expiresAt = Date.now() + LIMITS.cliSessionTtlMs
    await ctx.db.insert("widgetSessions", {
      tokenHash: await sha256Hex(token),
      userId: login.userId,
      projectId: project._id,
      kind: "cli",
      origin: "cli",
      userAgent: login.client,
      expiresAt,
    })
    const owner = await ctx.db.get(login.userId)
    return {
      status: "approved" as const,
      token,
      expiresAt,
      ownerName: owner?.name ?? "Owner",
      projectName: project.name,
    }
  },
})

/** Step 2: what the approval page shows. Read-only. */
export const pending = query({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    const user = await currentUser(ctx)
    if (!user) return { state: "signed_out" as const }
    const login = await loginByCode(ctx, userCode)
    if (!login || login.expiresAt < Date.now()) {
      return { state: "expired" as const }
    }
    if (login.status !== "pending") return { state: login.status }
    const project = await projectByPublicId(ctx, login.publicId)
    if (!project) return { state: "expired" as const }
    const owner = project.ownerId ? await ctx.db.get(project.ownerId) : null
    return {
      state: "pending" as const,
      publicId: project.publicId,
      projectName: project.name,
      client: login.client,
      expiresAt: login.expiresAt,
      access: !project.ownerId
        ? ("unclaimed" as const)
        : project.ownerId === user._id
          ? ("mine" as const)
          : ("other" as const),
      ownerName: owner?.name ?? null,
    }
  },
})

/** Step 2: the owner approves. Claims the project first if nobody owns it. */
export const approve = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    const user = await requireUser(ctx)
    const login = await loginByCode(ctx, userCode)
    if (!login || login.expiresAt < Date.now() || login.status !== "pending") {
      fail("expired", "This code has expired. Run nuni login again.")
    }
    const project = await projectByPublicId(ctx, login.publicId)
    if (!project || project.deletingAt) fail("not_found", "Project not found")
    if (!project.ownerId) await claimFor(ctx, project, user._id)
    else if (project.ownerId !== user._id) {
      fail("forbidden", "Only the project owner can sign in to it")
    }
    await ctx.db.patch(login._id, { status: "approved", userId: user._id })
  },
})

export const deny = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    await requireUser(ctx)
    const login = await loginByCode(ctx, userCode)
    if (login?.status === "pending") {
      await ctx.db.patch(login._id, { status: "denied" })
    }
  },
})

const CLEANUP_BATCH = 500

/** Daily cron: delete logins nobody finished. */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("cliLogins")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH)
    for (const login of expired) await ctx.db.delete(login._id)
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cliAuth.cleanupExpired, {})
    }
    return expired.length
  },
})
