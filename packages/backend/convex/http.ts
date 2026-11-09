import {
  HTTP_ROUTES,
  LOGIN_POLL_STATUS,
  type NewCommentPayload,
  type NewReplyPayload,
} from "@nuni/shared"
import { httpRouter } from "convex/server"

import { internal } from "./_generated/api"
import { authKit } from "./auth"
import { clientIp, json, jsonRoute, optionalText, text } from "./httpRoutes"
import { SERVER_LIMITS } from "./limits"
import { pinRoutes } from "./pins"
import { uploadRoutes } from "./uploads"

const http = httpRouter()

authKit.registerRoutes(http)

jsonRoute<NewCommentPayload>(
  http,
  HTTP_ROUTES.comments,
  { maxBytes: SERVER_LIMITS.commentBodyMax, invalid: "Invalid comment" },
  async (ctx, body, request) => {
    const id = await ctx.runMutation(internal.comments.createFromWidget, {
      publicId: text(body.publicId),
      ip: clientIp(request),
      body: text(body.body),
      authorName: text(body.authorName),
      authorSecret: text(body.authorSecret),
      commenterToken: optionalText(body.commenterToken),
      // Shape is enforced by the mutation's validators.
      suggestion: (body.suggestion ?? undefined) as never,
      page: body.page as never,
      anchor: body.anchor as never,
      viewport: body.viewport as never,
      context: (body.context ?? undefined) as never,
      userAgent: request.headers.get("User-Agent") ?? "",
    })
    return json(request, 201, { id })
  }
)

/** A reply in a comment's thread, rate limited per IP like comments. */
jsonRoute<NewReplyPayload>(
  http,
  HTTP_ROUTES.replies,
  { maxBytes: SERVER_LIMITS.replyBodyMax, invalid: "Invalid reply" },
  async (ctx, body, request) => {
    const id = await ctx.runMutation(internal.replies.createFromWidget, {
      publicId: text(body.publicId),
      commentId: text(body.commentId),
      ip: clientIp(request),
      body: text(body.body),
      authorName: text(body.authorName),
      authorSecret: text(body.authorSecret),
      commenterToken: optionalText(body.commenterToken),
      sessionToken: optionalText(body.sessionToken),
    })
    return json(request, 201, { id })
  }
)

pinRoutes(http)
uploadRoutes(http)

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

export default http
