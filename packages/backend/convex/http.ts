import { LIMITS } from "@nuni/shared"
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
    "Access-Control-Allow-Headers":
      "Content-Type, X-Nuni-Project, X-Nuni-Comment, X-Nuni-Author",
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
  conflict: 409,
  expired: 410,
  too_large: 413,
  invalid_type: 415,
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

/** Map thrown errors to JSON responses with the matching status. */
function errorResponse(request: Request, error: unknown, invalid: string) {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string; message?: string }
    return json(request, STATUS_BY_CODE[data.code ?? ""] ?? 400, data)
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("ArgumentValidationError")) {
    return json(request, 400, { code: "invalid", message: invalid })
  }
  console.error(error)
  return json(request, 500, {
    code: "server_error",
    message: "Something went wrong",
  })
}

/**
 * Read the body, stopping as soon as it passes `max` bytes, so a request
 * without (or with a false) Content-Length can't make us buffer it all.
 */
async function readLimited(
  request: Request,
  max: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

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

    const ip = clientIp(request)

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
        context: (payload.context ?? undefined) as never,
        userAgent: request.headers.get("User-Agent") ?? "",
      })
      return json(request, 201, { id })
    } catch (error) {
      return errorResponse(request, error, "Invalid comment")
    }
  }),
})

http.route({
  path: "/widget/screenshot",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 204, headers: corsHeaders(request) })
  }),
})

/**
 * The author attaches an image of the element right after posting. The
 * comment id and the author's secret travel in headers; the body is the image.
 */
http.route({
  path: "/widget/screenshot",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const declared = Number(request.headers.get("Content-Length") ?? "0")
    if (declared > LIMITS.screenshotMaxBytes) {
      return json(request, 413, { code: "too_large", message: "Too large" })
    }
    const bytes = await readLimited(request, LIMITS.screenshotMaxBytes)
    if (!bytes) {
      return json(request, 413, { code: "too_large", message: "Too large" })
    }
    const type = sniffImage(bytes)
    if (!type) {
      return json(request, 415, {
        code: "invalid_type",
        message: "Screenshots must be WebP, JPEG or PNG",
      })
    }
    const target = {
      publicId: request.headers.get("X-Nuni-Project") ?? "",
      commentId: request.headers.get("X-Nuni-Comment") ?? "",
      authorSecret: request.headers.get("X-Nuni-Author") ?? "",
    }
    try {
      await ctx.runMutation(internal.comments.checkScreenshot, {
        ...target,
        ip: clientIp(request),
        contentType: type,
        size: bytes.byteLength,
      })
      const storageId = await ctx.storage.store(new Blob([bytes], { type }))
      try {
        await ctx.runMutation(internal.comments.attachScreenshot, {
          ...target,
          storageId,
        })
      } catch (error) {
        await ctx.storage.delete(storageId)
        throw error
      }
      return json(request, 201, { ok: true })
    } catch (error) {
      return errorResponse(request, error, "Invalid screenshot")
    }
  }),
})

export default http
