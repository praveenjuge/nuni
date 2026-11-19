import {
  HTTP_ROUTES,
  LIMITS,
  queryHash,
  type PinReportPayload,
} from "@nuni/shared"
import type { HttpRouter } from "convex/server"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import { internalMutation } from "./_generated/server"
import { pageKey } from "./commentInput"
import { clientIp, json, jsonRoute, text } from "./httpRoutes"
import { fail, liveProject } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { ipKey, rateLimiter } from "./rateLimits"

/**
 * What a visitor's widget saw on one page: open comments whose element it
 * couldn't find, and ones it found. Only changes are written, so a page
 * view with nothing new writes nothing.
 *
 * A pin is only marked lost when nobody has found its element for a while
 * (`LIMITS.pinLostAfterMs`), and only by a visitor on the comment's own
 * query string: elements that only show sometimes (an open form, another
 * tab or filter) would otherwise be flagged by every visitor who didn't
 * open them.
 */
export const report = internalMutation({
  args: {
    publicId: v.string(),
    ip: v.string(),
    path: v.string(),
    lost: v.array(v.string()),
    found: v.array(v.string()),
    /** The visitor's `queryHash`; older widgets don't send it. */
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.lost.length + args.found.length > LIMITS.pinReportMax) {
      fail("too_many", "Too many pins in one report")
    }
    const { ok } = await rateLimiter.limit(ctx, "pinReportPerIp", {
      key: ipKey(args.ip, args.publicId),
    })
    if (!ok) fail("rate_limited", "Slow down a little")
    const project = await liveProject(ctx, args.publicId)
    if (!project) return 0
    const path = pageKey(args.path)
    const openHere = async (raw: string) => {
      const id = ctx.db.normalizeId("comments", raw)
      const comment = id ? await ctx.db.get(id) : null
      return comment &&
        comment.projectId === project._id &&
        comment.page.path === path &&
        comment.status === "open"
        ? comment
        : null
    }
    const now = Date.now()
    const lastFound = (c: Doc<"comments">) => c.pinFoundAt ?? c.createdAt
    let changed = 0
    for (const raw of args.found) {
      const comment = await openHere(raw)
      if (
        !comment ||
        (comment.pinLostAt === undefined &&
          now - lastFound(comment) < LIMITS.pinFoundRefreshMs)
      ) {
        continue
      }
      await ctx.db.patch(comment._id, { pinLostAt: undefined, pinFoundAt: now })
      changed++
    }
    for (const raw of args.lost) {
      const comment = await openHere(raw)
      if (
        !comment ||
        comment.pinLostAt !== undefined ||
        now - lastFound(comment) < LIMITS.pinLostAfterMs ||
        (args.query !== undefined &&
          args.query !== (await queryHash(comment.page.search)))
      ) {
        continue
      }
      await ctx.db.patch(comment._id, { pinLostAt: now })
      changed++
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
        // A SHA-256 hex digest: 64 characters.
        query:
          typeof body.query === "string" ? body.query.slice(0, 64) : undefined,
      })
      return json(request, 200, { changed })
    }
  )
}
