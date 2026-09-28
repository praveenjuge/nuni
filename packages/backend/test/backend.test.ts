/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test"
import workOSAuthKit from "@convex-dev/workos-authkit/test"
import { generateProjectId, generateSecret, LIMITS } from "@nuni/shared"
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../convex/_generated/api"
import schema from "../convex/schema"

const modules = import.meta.glob("../convex/**/*.ts")

function setup() {
  const t = convexTest(schema, modules)
  rateLimiter.register(t)
  workOSAuthKit.register(t)
  return t
}

type T = ReturnType<typeof setup>

const anchor = {
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

function page(path = "/pricing", origin = "http://localhost:3000") {
  return {
    origin,
    path,
    search: "",
    hash: "",
    title: "Pricing",
    url: origin + path,
  }
}

async function addComment(
  t: T,
  publicId: string,
  opts: { ip?: string; secret?: string; path?: string; origin?: string } = {}
) {
  return t.mutation(internal.comments.createFromWidget, {
    publicId,
    ip: opts.ip ?? "1.1.1.1",
    body: "Make this bigger",
    authorName: "Sam",
    authorSecret: opts.secret ?? generateSecret(),
    page: page(opts.path, opts.origin),
    anchor,
    viewport: { w: 1280, h: 800, dpr: 2 },
    userAgent: "test",
  })
}

async function signIn(t: T, subject: string, name: string) {
  const user = t.withIdentity({ subject, name })
  await user.mutation(api.users.store, {})
  return user
}

describe("widget comments", () => {
  it("creates the unclaimed project lazily and lists by path", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    await addComment(t, publicId, { origin: "https://prod.example.com" })
    await addComment(t, publicId, { path: "/about" })

    const pricing = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(pricing).toHaveLength(2)
    expect(pricing.map((c) => c.page.origin).sort()).toEqual([
      "http://localhost:3000",
      "https://prod.example.com",
    ])
    expect(pricing[0]).not.toHaveProperty("userAgent")

    const status = await t.query(api.projects.status, { publicId })
    expect(status).toMatchObject({ exists: true, claimed: false, openCount: 3 })

    const pages = await t.query(api.comments.pagesWithComments, { publicId })
    expect(pages).toEqual([
      expect.objectContaining({ path: "/pricing", count: 2 }),
      expect.objectContaining({ path: "/about", count: 1 }),
    ])
  })

  it("rejects invalid project ids and empty bodies", async () => {
    const t = setup()
    await expect(addComment(t, "nuni_nope")).rejects.toThrow()
    await expect(
      t.mutation(internal.comments.createFromWidget, {
        publicId: generateProjectId(),
        ip: "1.1.1.1",
        body: "   ",
        authorName: "Sam",
        authorSecret: generateSecret(),
        page: page(),
        anchor,
        viewport: { w: 1, h: 1, dpr: 1 },
        userAgent: "",
      })
    ).rejects.toThrow(/empty/)
  })

  it("rate limits per IP", async () => {
    const t = setup()
    const publicId = generateProjectId()
    for (let i = 0; i < 10; i++)
      await addComment(t, publicId, { ip: "9.9.9.9" })
    await expect(addComment(t, publicId, { ip: "9.9.9.9" })).rejects.toThrow(
      /Slow down/
    )
    await addComment(t, publicId, { ip: "8.8.8.8" })
  })

  it("caps unclaimed projects", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    await t.run(async (ctx) => {
      const p = await ctx.db
        .query("projects")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique()
      await ctx.db.patch(p!._id, { commentCount: LIMITS.unclaimedCommentCap })
    })
    await expect(addComment(t, publicId)).rejects.toThrow(/limit/)
  })

  it("lets authors edit and delete only their own comments", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const secret = generateSecret()
    const id = await addComment(t, publicId, { secret })

    await expect(
      t.mutation(api.comments.editOwn, {
        id,
        authorSecret: generateSecret(),
        body: "hacked",
      })
    ).rejects.toThrow(/own comments/)

    await t.mutation(api.comments.editOwn, {
      id,
      authorSecret: secret,
      body: "Edited",
    })
    const [comment] = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(comment?.body).toBe("Edited")
    expect(comment?.editedAt).toBeTypeOf("number")

    await t.mutation(api.comments.deleteOwn, { id, authorSecret: secret })
    expect(
      await t.query(api.comments.listForPage, { publicId, path: "/pricing" })
    ).toHaveLength(0)
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 0,
    })
  })

  it("does not let commenters resolve", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    await expect(t.mutation(api.comments.resolve, { id })).rejects.toThrow(
      /owner/
    )
  })
})

describe("claiming and owner actions", () => {
  it("is first come, first served", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await t.mutation(api.projects.touch, {
      publicId,
      origin: "https://site.example.com",
    })

    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")

    expect(
      await alice.mutation(api.projects.claim, { publicId })
    ).toMatchObject({
      status: "claimed",
    })
    expect(
      await alice.mutation(api.projects.claim, { publicId })
    ).toMatchObject({
      status: "already_owner",
    })
    expect(await bob.mutation(api.projects.claim, { publicId })).toEqual({
      status: "claimed_by_other",
      ownerName: "Alice",
    })
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: true,
      ownerName: "Alice",
    })
    expect(await alice.query(api.projects.listMine, {})).toHaveLength(1)
    expect(await bob.query(api.projects.listMine, {})).toHaveLength(0)
  })

  it("requires sign-in to claim", async () => {
    const t = setup()
    await expect(
      t.mutation(api.projects.claim, { publicId: generateProjectId() })
    ).rejects.toThrow(/Sign in/)
  })

  it("claims a project that has never been touched when an origin is given", async () => {
    const t = setup()
    const alice = await signIn(t, "user_alice", "Alice")
    const publicId = generateProjectId()
    await expect(
      alice.mutation(api.projects.claim, { publicId })
    ).rejects.toThrow(/not been used/)
    expect(
      await alice.mutation(api.projects.claim, {
        publicId,
        origin: "http://localhost:3000",
      })
    ).toMatchObject({ status: "claimed" })
  })

  it("lets the owner resolve, reopen and delete from the dashboard", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    await alice.mutation(api.projects.claim, { publicId })

    await expect(bob.mutation(api.comments.resolve, { id })).rejects.toThrow()
    await alice.mutation(api.comments.resolve, { id })
    expect(
      await alice.query(api.comments.listForOwner, {
        publicId,
        status: "resolved",
      })
    ).toHaveLength(1)
    expect(
      await bob.query(api.comments.listForOwner, { publicId, status: "open" })
    ).toBeNull()
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 0,
    })

    await alice.mutation(api.comments.reopen, { id })
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 1,
    })

    await alice.mutation(api.comments.remove, { id })
    expect(
      await alice.query(api.comments.listForOwner, { publicId, status: "open" })
    ).toHaveLength(0)
  })

  it("supports widget session tokens, scoped to one project, revocable", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const otherId = generateProjectId()
    const id = await addComment(t, publicId)
    const otherComment = await addComment(t, otherId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    await alice.mutation(api.projects.claim, { publicId: otherId })

    const bob = await signIn(t, "user_bob", "Bob")
    await expect(
      bob.mutation(api.sessions.create, {
        publicId,
        origin: "http://localhost:3000",
      })
    ).rejects.toThrow(/owner/)

    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: token })
    ).toEqual({ valid: true, ownerName: "Alice" })
    expect(
      await t.query(api.sessions.validate, {
        publicId: otherId,
        sessionToken: token,
      })
    ).toEqual({ valid: false })

    // Anonymous caller with the token can act as owner on this project only.
    await t.mutation(api.comments.resolve, { id, sessionToken: token })
    await expect(
      t.mutation(api.comments.resolve, {
        id: otherComment,
        sessionToken: token,
      })
    ).rejects.toThrow()

    const [session] = await alice.query(api.sessions.listMine, { publicId })
    await alice.mutation(api.sessions.revoke, { id: session!._id })
    await expect(
      t.mutation(api.comments.reopen, { id, sessionToken: token })
    ).rejects.toThrow()
  })

  it("expires widget sessions", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    await t.run(async (ctx) => {
      for (const s of await ctx.db.query("widgetSessions").collect()) {
        await ctx.db.patch(s._id, { expiresAt: Date.now() - 1 })
      }
    })
    await expect(
      t.mutation(api.comments.resolve, { id, sessionToken: token })
    ).rejects.toThrow()
  })
})
