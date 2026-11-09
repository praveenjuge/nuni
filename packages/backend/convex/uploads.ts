import {
  IMAGE_TYPES_TEXT,
  LIMITS,
  UPLOAD_HEADERS,
  UPLOAD_ROUTES,
  type UploadKind,
  type WidgetAuthor,
} from "@nuni/shared"
import { widgetAuthorArgs } from "@nuni/shared/validators"
import type { HttpRouter } from "convex/server"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { widgetAuthor } from "./authors"
import { clientIp, failure, json, postRoute, readLimited } from "./httpRoutes"
import { fail, findComment } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { ipKey, rateLimiter } from "./rateLimits"

/**
 * The author attaches a file right after posting: the element's screenshot
 * (owner-only context) or an image for everyone (their own, or the
 * screenshot they marked up). The comment id and the author's secret travel
 * in headers; the body is the image.
 */
const UPLOADS = {
  screenshot: { maxBytes: LIMITS.screenshotMaxBytes, limit: "screenshotPerIp" },
  image: { maxBytes: LIMITS.imageMaxBytes, limit: "imagePerIp" },
} as const satisfies Record<UploadKind, unknown>

const uploadArgs = {
  kind: v.union(v.literal("screenshot"), v.literal("image")),
  publicId: v.string(),
  commentId: v.string(),
  ...widgetAuthorArgs,
}

type Target = {
  kind: UploadKind
  publicId: string
  commentId: string
} & WidgetAuthor

/** The real image type from the file's first bytes, whatever the header says. */
function sniffImage(bytes: Uint8Array): string | null {
  const at = (i: number, ...values: number[]) =>
    values.every((value, j) => bytes[i + j] === value)
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg"
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return "image/webp"
  }
  return null
}

/** The author's own, recent comment that can still take this upload. */
async function uploadTarget(ctx: MutationCtx, args: Target) {
  const found = await findComment(ctx, args.publicId, args.commentId)
  if (!found) fail("not_found", "Comment not found")
  const { project, comment } = found
  const { keys } = await widgetAuthor(ctx, project._id, args)
  if (!keys.includes(comment.authorKeyHash)) {
    fail("forbidden", "You can only add images to your own comment")
  }
  if (args.kind === "screenshot" && comment.screenshotId) {
    fail("conflict", "This comment has a screenshot")
  }
  if (args.kind === "image") {
    // Images are public, so an unclaimed project can't be used to host them.
    if (!project.ownerId) {
      fail("forbidden", "Images can be added once the site is claimed")
    }
    if ((comment.images?.length ?? 0) >= LIMITS.imagesPerComment) {
      fail(
        "conflict",
        `A comment can have up to ${LIMITS.imagesPerComment} images`
      )
    }
  }
  if (Date.now() - comment.createdAt > SERVER_LIMITS.uploadWindowMs) {
    fail("expired", "Too late to add an image")
  }
  return comment
}

/**
 * Before the file is stored: may this author still add it to this comment?
 * The file can only be stored by the HTTP action, between this and `attach`.
 */
export const check = internalMutation({
  args: { ...uploadArgs, ip: v.string() },
  handler: async (ctx, args) => {
    const { ok } = await rateLimiter.limit(ctx, UPLOADS[args.kind].limit, {
      key: ipKey(args.ip, args.publicId),
    })
    if (!ok) fail("rate_limited", "Slow down a little")
    await uploadTarget(ctx, args)
  },
})

/** After the file is stored: attach it, rechecked, or report why not. */
export const attach = internalMutation({
  args: { ...uploadArgs, storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const comment = await uploadTarget(ctx, args)
    await ctx.db.patch(
      comment._id,
      args.kind === "screenshot"
        ? { screenshotId: args.storageId }
        : { images: [...(comment.images ?? []), args.storageId] }
    )
  },
})

export function uploadRoutes(http: HttpRouter) {
  for (const kind of Object.keys(UPLOADS) as UploadKind[]) {
    postRoute(
      http,
      UPLOAD_ROUTES[kind],
      "Invalid image",
      async (ctx, request) => {
        const bytes = await readLimited(request, UPLOADS[kind].maxBytes)
        if (!bytes) return failure(request, "too_large", "Too large")
        const type = sniffImage(bytes)
        if (!type) {
          return failure(
            request,
            "invalid_type",
            `Images must be ${IMAGE_TYPES_TEXT}`
          )
        }
        const target: Target = {
          kind,
          publicId: request.headers.get(UPLOAD_HEADERS.project) ?? "",
          commentId: request.headers.get(UPLOAD_HEADERS.comment) ?? "",
          authorSecret: request.headers.get(UPLOAD_HEADERS.author) ?? "",
          commenterToken:
            request.headers.get(UPLOAD_HEADERS.commenter) ?? undefined,
        }
        await ctx.runMutation(internal.uploads.check, {
          ...target,
          ip: clientIp(request),
        })
        const storageId = await ctx.storage.store(new Blob([bytes], { type }))
        try {
          await ctx.runMutation(internal.uploads.attach, {
            ...target,
            storageId,
          })
        } catch (error) {
          await ctx.storage.delete(storageId)
          throw error
        }
        return json(request, 201, { ok: true })
      }
    )
  }
}
