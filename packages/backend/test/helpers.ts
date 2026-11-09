/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test"
import workOSAuthKit from "@convex-dev/workos-authkit/test"
import {
  generateProjectId,
  generateSecret,
  type PageInfo,
  type UploadKind,
} from "@nuni/shared"
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

export const ORIGIN = "http://localhost:3000"

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

export function page(path = "/pricing", origin = ORIGIN): PageInfo {
  return {
    origin,
    path,
    search: "",
    hash: "",
    title: "Pricing",
    url: origin + path,
  }
}

/** A comment from the widget, as the HTTP route passes it on. */
export async function addComment(
  t: T,
  publicId: string,
  opts: {
    ip?: string
    body?: string
    secret?: string
    commenterToken?: string
    path?: string
    origin?: string
    /** Overrides the page built from `path` and `origin`. */
    page?: Partial<PageInfo>
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
    commenterToken: opts.commenterToken,
    page: { ...page(opts.path, opts.origin), ...opts.page },
    anchor: { ...anchor, ...opts.anchor },
    viewport: { w: 1280, h: 800, dpr: 2 },
    userAgent: "test",
  })
}

/**
 * A dashboard sign-in, storing the user as `users.storeFresh` does when
 * WorkOS can't be reached (from the sign-in token).
 */
export async function signIn(t: T, subject: string, name: string) {
  const user = t.withIdentity({ subject, name })
  await user.mutation(internal.users.storeProfile, {})
  return user
}

type User = Awaited<ReturnType<typeof signIn>>

/**
 * The claim popup on the project's site: claims it unless someone else
 * owns it, and gives the owner a widget session there.
 */
export function claim(user: User, publicId: string, origin = ORIGIN) {
  return user.mutation(api.sessions.allowOwnerTools, { publicId, origin })
}

/**
 * A project with a comment on each of `paths`, claimed by Alice on its site
 * (`token` is the widget session that gives her).
 */
export async function ownedProject(t: T, paths = ["/pricing"]) {
  const publicId = generateProjectId()
  const ids: Awaited<ReturnType<typeof addComment>>[] = []
  for (const path of paths) ids.push(await addComment(t, publicId, { path }))
  const alice = await signIn(t, "user_alice", "Alice")
  const token = await ownerToken(alice, publicId)
  return { publicId, alice, ids, id: ids[0]!, token }
}

/** An owner session for the project's site, as the widget gets it. */
export async function ownerToken(
  owner: User,
  publicId: string,
  origin = ORIGIN
) {
  const allowed = await claim(owner, publicId, origin)
  if (allowed.status === "claimed_by_other") throw new Error("Not the owner")
  return allowed.token
}

/** A visitor signs in with GitHub (via the dashboard) to comment on the site. */
export async function signInToComment(
  t: T,
  publicId: string,
  subject = "user_ada"
) {
  const user = t.withIdentity({
    subject,
    name: "Ada Lovelace",
    pictureUrl: "https://avatars.githubusercontent.com/u/1",
  })
  await user.mutation(internal.users.storeProfile, {})
  const { token } = await user.mutation(api.commenters.create, {
    publicId,
    origin: ORIGIN,
  })
  return token
}

export function postJson(t: T, path: string, body: unknown, ip = "5.5.5.5") {
  return t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": ip },
    body: JSON.stringify(body),
  })
}

// A minimal valid WebP header: RIFF....WEBP
export const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
  0x38, 0x4c, 0x0d, 0, 0, 0, 0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88,
  0x88, 0xfe, 0x07, 0,
])

/**
 * The author attaches a file to their comment, like the widget does. The
 * route and headers are spelled out: published widgets send exactly these.
 */
export function upload(
  t: T,
  kind: UploadKind,
  target: { publicId: string; id: string; secret: string },
  body: BodyInit = WEBP
) {
  return t.fetch(`/widget/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "image/webp",
      "X-Nuni-Project": target.publicId,
      "X-Nuni-Comment": target.id,
      "X-Nuni-Author": target.secret,
    },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit)
}

export const storedFiles = (t: T) =>
  t.run((ctx) => ctx.db.system.query("_storage").collect())
