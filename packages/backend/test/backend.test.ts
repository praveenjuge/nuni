import { generateProjectId, generateSecret, LIMITS } from "@nuni/shared"
import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../convex/_generated/api"
import { deleteUserData } from "../convex/users"
import { addComment, anchor, page, setup, signIn, type T } from "./helpers"

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
    // The address is the whole key: another project doesn't reset it.
    await expect(
      addComment(t, generateProjectId(), { ip: "9.9.9.9" })
    ).rejects.toThrow(/Slow down/)
  })

  it("keys per-IP limits by project on test deployments", async () => {
    vi.stubEnv("NUNI_ALLOW_TESTING", "1")
    try {
      const t = setup()
      const publicId = generateProjectId()
      for (let i = 0; i < 10; i++)
        await addComment(t, publicId, { ip: "9.9.9.9" })
      await expect(addComment(t, publicId, { ip: "9.9.9.9" })).rejects.toThrow(
        /Slow down/
      )
      // e2e browsers share one address; each test has its own project.
      await addComment(t, generateProjectId(), { ip: "9.9.9.9" })
    } finally {
      vi.unstubAllEnvs()
    }
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

  it("keeps text and area comments within limits", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId, {
      anchor: {
        quote: {
          exact: ` ${"x".repeat(LIMITS.quoteMaxLength + 50)}`,
          prefix: "p".repeat(100),
          suffix: "s".repeat(100),
        },
        region: { x: -0.5, y: 0.8, w: 3, h: 0.5 },
      },
    })
    const comment = await t.query(api.comments.getById, { publicId, id })
    expect(comment?.anchor.quote?.exact).toHaveLength(LIMITS.quoteMaxLength)
    expect(comment?.anchor.quote?.prefix).toHaveLength(
      LIMITS.quoteContextLength
    )
    expect(comment?.anchor.region).toMatchObject({ x: 0, y: 0.8, w: 1 })
    expect(comment?.anchor.region?.h).toBeCloseTo(0.2)

    // A quote with no words is dropped, not stored empty.
    const blank = await addComment(t, publicId, {
      anchor: { quote: { exact: "  ", prefix: "", suffix: "" } },
    })
    expect(
      (await t.query(api.comments.getById, { publicId, id: blank }))?.anchor
        .quote
    ).toBeUndefined()
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

  it("only mints owner sessions for origins registered to the project", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId) // registers http://localhost:3000
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })

    // A crafted claim link naming an outside origin cannot mint a session.
    await expect(
      alice.mutation(api.sessions.create, {
        publicId,
        origin: "https://attacker.example",
      })
    ).rejects.toThrow(/not registered/)
    // The registered origin still works.
    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: token })
    ).toMatchObject({ valid: true })
  })

  it("stops anonymous traffic from registering origins on claimed projects", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })

    // Neither widget loads nor new comments append origins once claimed,
    // so the session origin check cannot be pre-defeated by pollution.
    await t.mutation(api.projects.touch, {
      publicId,
      origin: "https://attacker.example",
    })
    await addComment(t, publicId, { origin: "https://attacker.example" })
    const project = await alice.query(api.projects.getMine, { publicId })
    expect(project?.origins).toEqual(["http://localhost:3000"])
    await expect(
      alice.mutation(api.sessions.create, {
        publicId,
        origin: "https://attacker.example",
      })
    ).rejects.toThrow(/not registered/)
  })

  it("lets only the owner register origins", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    await alice.mutation(api.projects.claim, { publicId })
    const projectId = (await alice.query(api.projects.getMine, { publicId }))!
      ._id

    await expect(
      bob.mutation(api.projects.addOrigin, {
        projectId,
        origin: "https://attacker.example",
      })
    ).rejects.toThrow()
    await alice.mutation(api.projects.addOrigin, {
      projectId,
      origin: "https://staging.example.com",
    })
    // Adding the same origin twice is a no-op.
    await alice.mutation(api.projects.addOrigin, {
      projectId,
      origin: "https://staging.example.com",
    })
    const project = await alice.query(api.projects.getMine, { publicId })
    expect(project?.origins).toEqual([
      "http://localhost:3000",
      "https://staging.example.com",
    ])
    // Sessions can now be minted for the newly registered origin.
    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "https://staging.example.com",
    })
    expect(
      (await t.query(api.sessions.validate, { publicId, sessionToken: token }))
        .valid
    ).toBe(true)
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

// A minimal valid WebP header: RIFF....WEBP
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
  0x38, 0x4c, 0x0d, 0, 0, 0, 0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88,
  0x88, 0xfe, 0x07, 0,
])

function uploadScreenshot(
  t: T,
  target: { publicId: string; id: string; secret: string },
  body: Uint8Array<ArrayBuffer> = WEBP
) {
  return t.fetch("/widget/screenshot", {
    method: "POST",
    headers: {
      "Content-Type": "image/webp",
      "X-Nuni-Project": target.publicId,
      "X-Nuni-Comment": target.id,
      "X-Nuni-Author": target.secret,
    },
    body,
  })
}

describe("captured context and screenshots", () => {
  const context = {
    console: [
      { level: "error", message: "x".repeat(5000), at: 1 },
      ...Array.from({ length: 30 }, (_, i) => ({
        level: "warn",
        message: `warn ${i}`,
        at: i,
      })),
      { level: "error", message: "POST /reset?token=secret failed", at: 40 },
    ],
    network: [
      {
        method: "get",
        url: "https://api.example.com/v1?token=secret#frag",
        status: 500,
        at: 2,
      },
    ],
    dom: {
      html:
        '<a href="/reset?token=secret">Reset</a>' +
        '<img data-src="i.png?sig=secret" style="background: url(/bg.png?t=secret)">' +
        "<button>" +
        "y".repeat(9000) +
        "</button>",
      styles: {
        "font-size": "14px",
        color: "rgb(0, 0, 0)",
        "background-image": 'url("https://cdn.example.com/bg.png?t=secret")',
      },
    },
  }

  it("clamps context and shows it to the owner only", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId, { context })
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    await alice.mutation(api.projects.claim, { publicId })

    const [pub] = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(pub).not.toHaveProperty("context")
    expect(
      await t.query(api.comments.getById, { publicId, id })
    ).not.toHaveProperty("context")
    expect(
      await bob.query(api.comments.getForOwner, { publicId, id })
    ).toBeNull()
    expect(await t.query(api.comments.getForOwner, { publicId, id })).toBeNull()

    const mine = await alice.query(api.comments.getForOwner, { publicId, id })
    expect(mine?.context?.console).toHaveLength(LIMITS.contextEntryMax)
    expect(mine?.context?.console?.[0]?.message).toBe("warn 11")
    expect(mine?.context?.network?.[0]?.method).toBe("GET")
    // Stripped on the server, whatever the client sent.
    expect(mine?.context?.network?.[0]?.url).toBe("https://api.example.com/v1")
    expect(mine?.context?.dom?.html).toHaveLength(LIMITS.domSnippetMaxLength)
    expect(mine?.context?.dom?.html).toContain('<a href="/reset">')
    expect(mine?.context?.dom?.html).toContain('<img data-src="i.png"')
    expect(mine?.context?.console?.at(-1)?.message).toBe("POST /reset failed")
    expect(mine?.context?.dom?.styles["background-image"]).toBe(
      'url("https://cdn.example.com/bg.png")'
    )
    expect(JSON.stringify(mine?.context)).not.toContain("secret")
    expect(mine?.screenshotUrl).toBeNull()

    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    const viaWidget = await t.query(api.comments.getForOwner, {
      publicId,
      id,
      sessionToken: token,
    })
    expect(viaWidget?.context?.network).toHaveLength(1)
    expect(viaWidget?.userAgent).toBe("test")

    const listed = await alice.query(api.comments.listForOwner, {
      publicId,
      status: "open",
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(listed.page[0]?.context?.dom?.styles).toEqual({
      ...context.dom.styles,
      "background-image": 'url("https://cdn.example.com/bg.png")',
    })
  })

  it("strips query strings from console messages on the server", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId, {
      context: {
        console: [
          {
            level: "error",
            message: "GET https://api.example.com/me?key=abc#x failed",
            at: 1,
          },
        ],
      },
    })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const mine = await alice.query(api.comments.getForOwner, { publicId, id })
    expect(mine?.context?.console?.[0]?.message).toBe(
      "GET https://api.example.com/me failed"
    )
  })

  it("lets the author attach one screenshot to their fresh comment", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const secret = generateSecret()
    const id = await addComment(t, publicId, { secret })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })

    const wrong = await uploadScreenshot(t, {
      publicId,
      id,
      secret: generateSecret(),
    })
    expect(wrong.status).toBe(403)

    const notImage = await uploadScreenshot(
      t,
      { publicId, id, secret },
      new TextEncoder().encode("<script>alert(1)</script>")
    )
    expect(notImage.status).toBe(415)

    const tooBig = await uploadScreenshot(
      t,
      { publicId, id, secret },
      new Uint8Array(LIMITS.screenshotMaxBytes + 1)
    )
    expect(tooBig.status).toBe(413)

    // Without a Content-Length, the body is still cut off at the limit.
    const chunked = await t.fetch("/widget/screenshot", {
      method: "POST",
      headers: {
        "Content-Type": "image/webp",
        "X-Nuni-Project": publicId,
        "X-Nuni-Comment": id,
        "X-Nuni-Author": secret,
      },
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < 4; i++)
            controller.enqueue(new Uint8Array(LIMITS.screenshotMaxBytes / 2))
          controller.close()
        },
      }),
      duplex: "half",
    } as RequestInit)
    expect(chunked.status).toBe(413)

    const ok = await uploadScreenshot(t, { publicId, id, secret })
    expect(ok.status).toBe(201)
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBeTruthy()

    const again = await uploadScreenshot(t, { publicId, id, secret })
    expect(again.status).toBe(409)

    const owner = await alice.query(api.comments.getForOwner, { publicId, id })
    expect(owner?.screenshotUrl).toMatch(/^https?:\/\//)
    const [pub] = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(pub).not.toHaveProperty("screenshotUrl")

    // Deleting the comment deletes the file.
    const files = () =>
      t.run((ctx) => ctx.db.system.query("_storage").collect())
    expect(await files()).toHaveLength(1)
    await alice.mutation(api.comments.remove, { id })
    expect(await files()).toHaveLength(0)
  })

  it("rejects screenshots after the upload window", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const secret = generateSecret()
    const id = await addComment(t, publicId, { secret })
    await t.run(async (ctx) => {
      await ctx.db.patch(id, {
        createdAt: Date.now() - LIMITS.screenshotUploadWindowMs - 1000,
      })
    })
    const late = await uploadScreenshot(t, { publicId, id, secret })
    expect(late.status).toBe(410)
    const files = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect()
    )
    expect(files).toHaveLength(0)
  })
})
