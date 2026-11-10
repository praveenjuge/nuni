import {
  cliCommand,
  generateUserCode,
  HTTP_ROUTES,
  isUserCode,
  LOGIN_POLL_STATUS,
  normalizeUserCode,
  type LoginPoll,
  type LoginStart,
} from "@nuni/shared"
import type { HttpRouter } from "convex/server"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation, mutation, query } from "./_generated/server"
import { currentUser, nameOf, requireUser } from "./accounts"
import { clientIp, json, jsonRoute, text } from "./httpRoutes"
import {
  assertProjectId,
  fail,
  liveProject,
  projectByPublicId,
  type Ctx,
} from "./lib"
import { SERVER_LIMITS } from "./limits"
import { claimFor } from "./ownership"
import { ipKey, rateLimiter } from "./rateLimits"
import { hashOf, issueSession, mintToken } from "./tokens"

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

async function loginByCode(ctx: Ctx, userCode: string) {
  const code = normalizeUserCode(userCode)
  if (!isUserCode(code)) return null
  return ctx.db
    .query("cliLogins")
    .withIndex("by_userCode", (q) => q.eq("userCode", code))
    .first()
}

/** Step 1, from the HTTP action. */
export const start = internalMutation({
  args: { publicId: v.string(), client: v.string(), ip: v.string() },
  handler: async (ctx, { publicId, client, ip }): Promise<LoginStart> => {
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
    const { token: deviceSecret, hash } = await mintToken("cliLogins")
    const expiresAt = Date.now() + SERVER_LIMITS.cliLoginTtlMs
    await ctx.db.insert("cliLogins", {
      secretHash: hash,
      userCode,
      publicId,
      status: "pending",
      client: client.slice(0, SERVER_LIMITS.cliClientMaxLength) || "Nuni CLI",
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
  handler: async (ctx, { deviceSecret, ip }): Promise<LoginPoll> => {
    const { ok } = await rateLimiter.limit(ctx, "cliPollPerIp", { key: ip })
    if (!ok) fail("rate_limited", "Polling too fast")
    const secretHash = await hashOf("cliLogins", deviceSecret)
    const login = secretHash
      ? await ctx.db
          .query("cliLogins")
          .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
          .unique()
      : null
    if (!login) return { status: "expired" }
    if (login.expiresAt < Date.now()) {
      await ctx.db.delete(login._id)
      return { status: "expired" }
    }
    if (login.status === "pending") return { status: "pending" }
    await ctx.db.delete(login._id)
    if (login.status === "denied" || !login.userId) return { status: "denied" }

    const project = await liveProject(ctx, login.publicId)
    if (!project || project.ownerId !== login.userId) {
      return { status: "denied" }
    }
    const { token, expiresAt } = await issueSession(ctx, "cli", {
      userId: login.userId,
      projectId: project._id,
      origin: "cli",
      userAgent: login.client,
    })
    return {
      status: "approved",
      token,
      expiresAt,
      ownerName: await nameOf(ctx, login.userId),
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
    // A project being deleted can't be approved: see `approve`.
    const project = await liveProject(ctx, login.publicId)
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
      fail(
        "expired",
        `This code has expired. Run ${cliCommand("login")} again.`
      )
    }
    const project = await liveProject(ctx, login.publicId)
    if (!project) fail("not_found", "Project not found")
    const claim = await claimFor(ctx, project, user._id)
    if (claim.status === "claimed_by_other") {
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

export function cliLoginRoutes(http: HttpRouter) {
  /** `nuni login`, step 1: see cliAuth.ts. */
  jsonRoute<{ publicId: string; client: string }>(
    http,
    HTTP_ROUTES.cliLoginStart,
    {
      maxBytes: SERVER_LIMITS.cliLoginBodyMax,
      invalid: "Invalid sign-in request",
    },
    async (ctx, body, request) => {
      const login = await ctx.runMutation(internal.cliAuth.start, {
        publicId: text(body.publicId),
        client: text(body.client),
        ip: clientIp(request),
      })
      return json(request, 201, login)
    }
  )

  /** `nuni login`, step 3: the CLI waits for the owner to approve. */
  jsonRoute<{ deviceSecret: string }>(
    http,
    HTTP_ROUTES.cliLoginPoll,
    {
      maxBytes: SERVER_LIMITS.cliLoginBodyMax,
      invalid: "Invalid sign-in request",
    },
    async (ctx, body, request) => {
      const result = await ctx.runMutation(internal.cliAuth.poll, {
        deviceSecret: text(body.deviceSecret),
        ip: clientIp(request),
      })
      return json(request, LOGIN_POLL_STATUS[result.status], result)
    }
  )
}
