/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test"
import workOSAuthKit from "@convex-dev/workos-authkit/test"
import { generateProjectId, generateSecret, LIMITS } from "@nuni/shared"
import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../convex/_generated/api"
import schema from "../convex/schema"
import { deleteUserData } from "../convex/users"

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
    // Other environments' full URLs are never exposed publicly.
    expect(pricing[0]!.page).toEqual({
      origin: expect.any(String),
      path: "/pricing",
      title: "Pricing",
    })

    const status = await t.query(api.projects.status, { publicId })
    expect(status).toMatchObject({ exists: true, claimed: false, openCount: 3 })

    const pages = await t.query(api.comments.pagesWithComments, { publicId })
    expect(pages).toEqual([
      { path: "/pricing", count: 2 },
      { path: "/about", count: 1 },
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

  it("rejects page paths that would hijack the origin in links", async () => {
    const t = setup()
    const publicId = generateProjectId()
    let n = 0
    for (const bad of [
      ".evil.example/verify",
      "@evil.example/",
      "//evil.example/x",
      "/\\evil.example/x",
      "\t@evil.example/login",
    ]) {
      n += 1
      await expect(
        t.mutation(internal.comments.createFromWidget, {
          publicId,
          ip: `10.0.0.${n}`,
          body: "Hi",
          authorName: "Sam",
          authorSecret: generateSecret(),
          // The attacker supplies a url consistent with the origin, so the
          // payload reaches the path check.
          page: { ...page(), path: bad },
          anchor,
          viewport: { w: 1, h: 1, dpr: 1 },
          userAgent: "",
        })
      ).rejects.toThrow(/continue the host/)
    }
    // Normal, hash-router and custom getPageKey paths still work.
    await addComment(t, publicId, { path: "/docs" })
    await addComment(t, publicId, { path: "/#/settings" })
    await t.mutation(internal.comments.createFromWidget, {
      publicId,
      ip: "10.0.0.99",
      body: "Hi",
      authorName: "Sam",
      authorSecret: generateSecret(),
      // Custom keys are opaque: the real URL stays a normal page URL.
      page: { ...page(), path: "product-123" },
      anchor,
      viewport: { w: 1, h: 1, dpr: 1 },
      userAgent: "",
    })
    const pages = await t.query(api.comments.pagesWithComments, { publicId })
    expect(pages.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "/#/settings", count: 1 },
      { path: "/docs", count: 1 },
      { path: "product-123", count: 1 },
    ])
  })

  it("rejects a page URL that does not match its origin", async () => {
    const t = setup()
    await expect(
      t.mutation(internal.comments.createFromWidget, {
        publicId: generateProjectId(),
        ip: "1.1.1.1",
        body: "Hi",
        authorName: "Sam",
        authorSecret: generateSecret(),
        page: { ...page(), url: "https://other.example.com/pricing?token=x" },
        anchor,
        viewport: { w: 1, h: 1, dpr: 1 },
        userAgent: "",
      })
    ).rejects.toThrow(/does not match/)
  })

  it("keeps page counts in sync through resolve, reopen and delete", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    await addComment(t, publicId, { path: "/about" })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    await alice.mutation(api.comments.resolve, { id })
    expect(await t.query(api.comments.pagesWithComments, { publicId })).toEqual(
      [{ path: "/about", count: 1 }]
    )
    await alice.mutation(api.comments.reopen, { id })
    await alice.mutation(api.comments.remove, { id })
    expect(await t.query(api.comments.pagesWithComments, { publicId })).toEqual(
      [{ path: "/about", count: 1 }]
    )
    // Resolved comments still come back for the page, newest open first.
    const newer = await addComment(t, publicId)
    const list = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(list[0]?._id).toBe(newer)
  })
  it("returns a single comment by id for deep links", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    expect(await t.query(api.comments.getById, { publicId, id })).toMatchObject(
      { _id: id }
    )
    expect(
      await t.query(api.comments.getById, { publicId: generateProjectId(), id })
    ).toBeNull()
    expect(
      await t.query(api.comments.getById, { publicId, id: "not-an-id" })
    ).toBeNull()
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
      (
        await alice.query(api.comments.listForOwner, {
          publicId,
          status: "resolved",
          paginationOpts: { numItems: 50, cursor: null },
        })
      ).page
    ).toHaveLength(1)
    expect(
      (
        await bob.query(api.comments.listForOwner, {
          publicId,
          status: "open",
          paginationOpts: { numItems: 50, cursor: null },
        })
      ).page
    ).toHaveLength(0)
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 0,
    })

    await alice.mutation(api.comments.reopen, { id })
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 1,
    })

    await alice.mutation(api.comments.remove, { id })
    expect(
      (
        await alice.query(api.comments.listForOwner, {
          publicId,
          status: "open",
          paginationOpts: { numItems: 50, cursor: null },
        })
      ).page
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
      await t.query(api.sessions.validate, {
        publicId,
        sessionToken: token,
      })
    ).toEqual({ valid: true, ownerName: "Alice" })
    expect(
      await t.query(api.sessions.validate, {
        publicId: otherId,
        sessionToken: token,
      })
    ).toEqual({ valid: false })

    // Anonymous caller with the token can act as owner on this project only.
    await t.mutation(api.comments.resolve, {
      id,
      sessionToken: token,
    })
    await expect(
      t.mutation(api.comments.resolve, {
        id: otherComment,
        sessionToken: token,
      })
    ).rejects.toThrow()

    const [session] = await alice.query(api.sessions.listMine, { publicId })
    await alice.mutation(api.sessions.revoke, { id: session!._id })
    await expect(
      t.mutation(api.comments.reopen, {
        id,
        sessionToken: token,
      })
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
      t.mutation(api.comments.resolve, {
        id,
        sessionToken: token,
      })
    ).rejects.toThrow()
  })
  it("cleans up expired sessions", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    await t.run(async (ctx) => {
      const [first] = await ctx.db.query("widgetSessions").collect()
      await ctx.db.patch(first!._id, { expiresAt: Date.now() - 1 })
    })
    expect(await t.mutation(internal.sessions.cleanupExpired, {})).toBe(1)
    const left = await t.run((ctx) => ctx.db.query("widgetSessions").collect())
    expect(left).toHaveLength(1)
  })

  it("releases projects when their owner is deleted in WorkOS", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })

    await t.run((ctx) => deleteUserData(ctx as never, "user_alice"))

    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: false,
    })
    expect(
      await t.run((ctx) => ctx.db.query("widgetSessions").collect())
    ).toHaveLength(0)
    const bob = await signIn(t, "user_bob", "Bob")
    expect(await bob.mutation(api.projects.claim, { publicId })).toMatchObject({
      status: "claimed",
    })
  })

  it("shows the claim state without claiming", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    expect(await alice.query(api.projects.claimStatus, { publicId })).toEqual({
      state: "unclaimed",
    })
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: false,
    })
    await alice.mutation(api.projects.claim, { publicId })
    expect(await alice.query(api.projects.claimStatus, { publicId })).toEqual({
      state: "mine",
    })
    expect(await bob.query(api.projects.claimStatus, { publicId })).toEqual({
      state: "other",
      ownerName: "Alice",
    })
  })
  it("filters the owner list server-side, including unloaded pages", async () => {
    const t = setup()
    const publicId = generateProjectId()
    for (let i = 0; i < 3; i++) await addComment(t, publicId)
    await addComment(t, publicId, {
      path: "/about",
      origin: "https://prod.example.com",
    })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const list = (args: Record<string, string>) =>
      alice.query(api.comments.listForOwner, {
        publicId,
        status: "open",
        paginationOpts: { numItems: 2, cursor: null },
        ...args,
      })
    expect((await list({ path: "/about" })).page).toHaveLength(1)
    expect(
      (await list({ origin: "https://prod.example.com" })).page
    ).toHaveLength(1)
    const filters = await alice.query(api.comments.ownerFilters, { publicId })
    expect(filters.paths.sort()).toEqual(["/about", "/pricing"])
    expect(filters.origins).toContain("https://prod.example.com")
  })

  it("rebuilds page counts from existing comments", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    await addComment(t, publicId)
    await addComment(t, publicId, { path: "/about" })
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("pageStats").collect())
        await ctx.db.delete(row._id)
    })
    expect(await t.query(api.comments.pagesWithComments, { publicId })).toEqual(
      []
    )
    await t.mutation(internal.comments.rebuildPageStats, {})
    await t.finishAllScheduledFunctions(() => {})
    expect(await t.query(api.comments.pagesWithComments, { publicId })).toEqual(
      [
        { path: "/pricing", count: 2 },
        { path: "/about", count: 1 },
      ]
    )
  })

  it("rebuilds exactly, even when run twice or over wrong counts", async () => {
    const t = setup()
    const a = generateProjectId()
    const b = generateProjectId()
    await addComment(t, a)
    await addComment(t, b, { path: "/b" })
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("pageStats").collect())
        await ctx.db.patch(row._id, { openCount: 7 })
    })
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.comments.rebuildPageStats, {})
      await t.finishAllScheduledFunctions(() => {})
    }
    expect(
      await t.query(api.comments.pagesWithComments, { publicId: a })
    ).toEqual([{ path: "/pricing", count: 1 }])
    expect(
      await t.query(api.comments.pagesWithComments, { publicId: b })
    ).toEqual([{ path: "/b", count: 1 }])
  })

  it("rebuild zeroes stale pages and backfills search text", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId, { path: "/a" })
    await addComment(t, publicId, { path: "/b" })
    await addComment(t, publicId, { path: "/c" })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    await t.run(async (ctx) => {
      const b = (await ctx.db.query("comments").collect()).find(
        (c) => c.page.path === "/b"
      )!
      await ctx.db.patch(b._id, { status: "resolved" })
      const projectId = b.projectId
      await ctx.db.insert("pageStats", {
        projectId,
        path: "/gone",
        openCount: 3,
      })
      for (const c of await ctx.db.query("comments").collect())
        await ctx.db.patch(c._id, { searchText: undefined })
    })
    await t.mutation(internal.comments.rebuildPageStats, {})
    await t.finishAllScheduledFunctions(() => {})
    const rows = await t.run((ctx) => ctx.db.query("pageStats").collect())
    expect(Object.fromEntries(rows.map((r) => [r.path, r.openCount]))).toEqual({
      "/a": 1,
      "/b": 0,
      "/c": 1,
      "/gone": 0,
    })
    const comments = await t.run((ctx) => ctx.db.query("comments").collect())
    expect(comments.every((c) => c.searchText?.includes("Sam"))).toBe(true)
  })

  it("never lowers a page count from a capped read", async () => {
    const t = setup()
    const publicId = generateProjectId()
    for (let i = 0; i < 3; i++) await addComment(t, publicId)
    const set = (openCount: number) =>
      t.run(async (ctx) => {
        const row = (await ctx.db.query("pageStats").collect())[0]!
        await ctx.db.patch(row._id, { openCount })
      })
    const rebuild = async () => {
      await t.mutation(internal.comments.rebuildProjectStats, { pathCap: 2 })
      await t.finishAllScheduledFunctions(() => {})
      return (await t.run((ctx) => ctx.db.query("pageStats").collect()))[0]!
        .openCount
    }
    expect(await rebuild()).toBe(3)
    await set(1)
    expect(await rebuild()).toBe(2)
  })

  it("searches by author name as well as body", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const search = (q: string) =>
      alice.query(api.comments.listForOwner, {
        publicId,
        status: "open",
        search: q,
        paginationOpts: { numItems: 10, cursor: null },
      })
    expect((await search("Sam")).page).toHaveLength(1)
    expect((await search("bigger")).page).toHaveLength(1)
    expect((await search("nobody")).page).toHaveLength(0)
  })

  it("keeps cleaning up while expired sessions remain", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    await t.run(async (ctx) => {
      const project = await ctx.db.query("projects").first()
      const user = await ctx.db.query("users").first()
      for (let i = 0; i < 520; i++) {
        await ctx.db.insert("widgetSessions", {
          tokenHash: `h${i}`,
          userId: user!._id,
          projectId: project!._id,
          origin: "http://localhost:3000",
          expiresAt: Date.now() - 1,
        })
      }
    })
    vi.useFakeTimers()
    await t.mutation(internal.sessions.cleanupExpired, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()
    expect(
      await t.run((ctx) => ctx.db.query("widgetSessions").collect())
    ).toHaveLength(0)
  })
})
