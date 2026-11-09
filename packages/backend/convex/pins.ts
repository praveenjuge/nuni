import { HTTP_ROUTES, LIMITS, type PinReportPayload } from "@nuni/shared"
import type { HttpRouter } from "convex/server"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
import { pageKey } from "./commentInput"
import { clientIp, json, jsonRoute, text } from "./httpRoutes"
import { fail, projectByPublicId } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { ipKey, rateLimiter } from "./rateLimits"

/**
 * What a visitor's widget saw on one page: open comments whose element it
 * couldn't find, and ones it found again. Only changes are written, so a
 * page view with nothing new writes nothing.
 */
export const report = internalMutation({
  args: {
    publicId: v.string(),
    ip: v.string(),
    path: v.string(),
    lost: v.array(v.string()),
    found: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.lost.length + args.found.length > LIMITS.pinReportMax) {
      fail("too_many", "Too many pins in one report")
    }
    const { ok } = await rateLimiter.limit(ctx, "pinReportPerIp", {
      key: ipKey(args.ip, args.publicId),
    })
    if (!ok) fail("rate_limited", "Slow down a little")
    const project = await projectByPublicId(ctx, args.publicId)
    if (!project || project.deletingAt) return 0
    const path = pageKey(args.path)
    const now = Date.now()
    let changed = 0
    for (const [ids, lost] of [
      [args.lost, true],
      [args.found, false],
    ] as const) {
      for (const raw of ids) {
        const id = ctx.db.normalizeId("comments", raw)
        const comment = id ? await ctx.db.get(id) : null
        if (
          !comment ||
          comment.projectId !== project._id ||
          comment.page.path !== path ||
          comment.status !== "open" ||
          (comment.pinLostAt !== undefined) === lost
        ) {
          continue
        }
        await ctx.db.patch(comment._id, { pinLostAt: lost ? now : undefined })
        changed++
      }
    }
    return changed
  },
})

export function pinRoutes(http: HttpRouter) {
  jsonRoute<PinReportPayload>(
    http,
    HTTP_ROUTES.pins,
    { maxBytes: SERVER_LIMITS.pinReportBodyMax, invalid: "Invalid report" },
    async (ctx, body, request) => {
      const ids = (value: unknown) =>
        Array.isArray(value)
          ? value.filter((id): id is string => typeof id === "string")
          : []
      const changed = await ctx.runMutation(internal.pins.report, {
        publicId: text(body.publicId),
        ip: clientIp(request),
        path: text(body.path),
        lost: ids(body.lost),
        found: ids(body.found),
      })
      return json(request, 200, { changed })
    }
  )
}
