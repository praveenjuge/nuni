/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test"
import workOSAuthKit from "@convex-dev/workos-authkit/test"
import { generateSecret } from "@nuni/shared"
import { convexTest } from "convex-test"

import { api, internal } from "../convex/_generated/api"
import schema from "../convex/schema"

const modules = import.meta.glob("../convex/**/*.ts")

export function setup() {
  const t = convexTest(schema, modules)
  rateLimiter.register(t)
  workOSAuthKit.register(t)
  return t
}

export type T = ReturnType<typeof setup>

export const anchor = {
  v: 1 as const,
  selectors: { path: "body > main > button:nth-of-type(1)" },
  tag: "button",
  text: "Buy now",
  attrs: {},
  ancestors: [],
  siblingIndex: 0,
  siblingCount: 1,
  rect: { x: 10, y: 10, w: 100, h: 40 },
  offset: { x: 0.5, y: 0.5 },
  viewport: { w: 1280, h: 800, dpr: 2, scrollX: 0, scrollY: 0 },
  docSize: { w: 1280, h: 2000 },
}

export function page(path = "/pricing", origin = "http://localhost:3000") {
  return {
    origin,
    path,
    search: "",
    hash: "",
    title: "Pricing",
    url: origin + path,
  }
}

export async function addComment(
  t: T,
  publicId: string,
  opts: {
    ip?: string
    body?: string
    secret?: string
    path?: string
    origin?: string
    context?: Record<string, unknown>
    anchor?: Record<string, unknown>
    suggestion?: { before: string; after: string }
  } = {}
) {
  return t.mutation(internal.comments.createFromWidget, {
    ...(opts.context ? { context: opts.context as never } : {}),
    ...(opts.suggestion ? { suggestion: opts.suggestion } : {}),
    publicId,
    ip: opts.ip ?? "1.1.1.1",
    body: opts.body ?? "Make this bigger",
    authorName: "Sam",
    authorSecret: opts.secret ?? generateSecret(),
    page: page(opts.path, opts.origin),
    anchor: { ...anchor, ...opts.anchor },
    viewport: { w: 1280, h: 800, dpr: 2 },
    userAgent: "test",
  })
}

export async function signIn(t: T, subject: string, name: string) {
  const user = t.withIdentity({ subject, name })
  await user.mutation(api.users.store, {})
  return user
}
