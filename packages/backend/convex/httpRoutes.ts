import {
  ERROR_STATUS,
  UPLOAD_HEADERS,
  type ErrorCode,
  type ErrorData,
} from "@nuni/shared"
import type { HttpRouter } from "convex/server"
import { ConvexError } from "convex/values"

import { httpAction, type ActionCtx } from "./_generated/server"

/**
 * Every HTTP route answers browsers (CORS, with a preflight) and maps errors
 * to `{ code, message }` with the status from `ERROR_STATUS`.
 */

function corsHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": [
      "Content-Type",
      ...Object.values(UPLOAD_HEADERS),
    ].join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

export function json(request: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  })
}

export function failure(request: Request, code: ErrorCode, message: string) {
  const body: ErrorData = { code, message }
  return json(request, ERROR_STATUS[code], body)
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

function errorResponse(request: Request, error: unknown, invalid: string) {
  if (error instanceof ConvexError) {
    const { code } = error.data as Partial<ErrorData>
    const status = code ? ERROR_STATUS[code] : undefined
    return json(request, status ?? 400, error.data)
  }
  const message = error instanceof Error ? error.message : String(error)
  // Convex rejects arguments that don't match the validators before the
  // function runs, with no code of ours.
  if (message.includes("ArgumentValidationError")) {
    return failure(request, "invalid", invalid)
  }
  console.error(error)
  return failure(request, "server_error", "Something went wrong")
}

/**
 * Read the body, stopping as soon as it passes `max` bytes, so a request
 * without (or with a false) Content-Length can't make us buffer it all.
 */
export async function readLimited(
  request: Request,
  max: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0")
  if (declared > max) return null
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

type Handler = (ctx: ActionCtx, request: Request) => Promise<Response>

/**
 * A POST route and its preflight. `invalid` is the message for arguments
 * that fail the functions' validators.
 */
export function postRoute(
  http: HttpRouter,
  path: string,
  invalid: string,
  handler: Handler
) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async (_ctx, request) => {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }),
  })
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        return await handler(ctx, request)
      } catch (error) {
        return errorResponse(request, error, invalid)
      }
    }),
  })
}

/** The fields of a JSON body, unchecked: the functions' validators check them. */
export type JsonBody<T> = Partial<Record<keyof T, unknown>>

/** A POST route whose body is a small JSON object of at most `maxBytes`. */
export function jsonRoute<T>(
  http: HttpRouter,
  path: string,
  { maxBytes, invalid }: { maxBytes: number; invalid: string },
  handler: (
    ctx: ActionCtx,
    body: JsonBody<T>,
    request: Request
  ) => Promise<Response>
) {
  postRoute(http, path, invalid, async (ctx, request) => {
    const bytes = await readLimited(request, maxBytes)
    if (!bytes) return failure(request, "too_large", "Too large")
    let body: unknown
    try {
      body = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      body = null
    }
    if (!body || typeof body !== "object") {
      return failure(request, "bad_json", "Invalid JSON")
    }
    return handler(ctx, body as JsonBody<T>, request)
  })
}

/** A JSON string field, or "" so the function's own checks reject it. */
export function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value)
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
