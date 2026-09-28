import { httpRouter } from "convex/server"
import { ConvexError } from "convex/values"

import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"
import { authKit } from "./auth"

const http = httpRouter()

authKit.registerRoutes(http)

function corsHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

function json(request: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  })
}

const STATUS_BY_CODE: Record<string, number> = {
  rate_limited: 429,
  cap_reached: 403,
  forbidden: 403,
  not_found: 404,
}

http.route({
  path: "/widget/comments",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 204, headers: corsHeaders(request) })
  }),
})

http.route({
  path: "/widget/comments",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text()
    if (raw.length > 64_000) {
      return json(request, 413, { code: "too_large", message: "Too large" })
    }
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(raw)
    } catch {
      return json(request, 400, { code: "bad_json", message: "Invalid JSON" })
    }

    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-real-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown"

    try {
      const id = await ctx.runMutation(internal.comments.createFromWidget, {
        publicId: String(payload.publicId ?? ""),
        ip,
        body: String(payload.body ?? ""),
        authorName: String(payload.authorName ?? ""),
        authorSecret: String(payload.authorSecret ?? ""),
        // Shape is enforced by the mutation's validators.
        page: payload.page as never,
        anchor: payload.anchor as never,
        viewport: payload.viewport as never,
        userAgent: request.headers.get("User-Agent") ?? "",
      })
      return json(request, 201, { id })
    } catch (error) {
      if (error instanceof ConvexError) {
        const data = error.data as { code?: string; message?: string }
        return json(request, STATUS_BY_CODE[data.code ?? ""] ?? 400, data)
      }
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("ArgumentValidationError")) {
        return json(request, 400, { code: "invalid", message: "Invalid comment" })
      }
      console.error(error)
      return json(request, 500, { code: "server_error", message: "Something went wrong" })
    }
  }),
})

export default http
