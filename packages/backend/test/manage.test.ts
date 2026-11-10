import { generateProjectId, generateSecret, LIMITS } from "@nuni/shared"
import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../convex/_generated/api"
import { SERVER_LIMITS } from "../convex/limits"
import {
  addComment,
  claim,
  ORIGIN,
  ownedProject,
  ownerToken,
  postJson,
  setup,
  signIn,
  storedFiles,
  upload,
  type T,
} from "./helpers"

const pageCounts = (t: T, publicId: string) =>
  t.query(api.comments.pagesWithComments, { publicId })

const counts = async (t: T, publicId: string) => {
  const status = await t.query(api.projects.status, { publicId })
  const project = await t.run((ctx) =>
    ctx.db
      .query("projects")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique()
  )
  return { open: status.openCount, total: project?.commentCount }
}

describe("comment lifecycle", () => {
  const deletes = {
    "the author": (t: T, id: string, secret: string) =>
      t.mutation(api.comments.deleteOwn, { id, authorSecret: secret }),
    "the owner": async (t: T, id: string) => {
      const alice = await signIn(t, "user_alice", "Alice")
      await alice.mutation(api.comments.remove, { id })
    },
    "the owner, in bulk": async (t: T, id: string) => {
      const alice = await signIn(t, "user_alice", "Alice")
      await alice.mutation(api.comments.bulkRemove, { ids: [id] })
    },
  }

  for (const [who, remove] of Object.entries(deletes)) {
    it(`deleting, by ${who}, removes the thread, every file and the counts`, async () => {
      const t = setup()
      const { publicId } = await ownedProject(t)
      const secret = generateSecret()
      const id = await addComment(t, publicId, { secret })
      for (const kind of ["screenshot", "image", "image"] as const) {
        expect((await upload(t, kind, { publicId, id, secret })).status).toBe(
          201
        )
      }
      await postJson(t, "/widget/replies", {
        publicId,
        commentId: id,
        body: "Me too",
        authorName: "Kim",
        authorSecret: generateSecret(),
      })
      expect(await counts(t, publicId)).toEqual({ open: 2, total: 2 })

      await remove(t, id, secret)

      expect(await storedFiles(t)).toEqual([])
      expect(await t.run((ctx) => ctx.db.query("replies").collect())).toEqual(
        []
      )
      expect(await counts(t, publicId)).toEqual({ open: 1, total: 1 })
      expect(await pageCounts(t, publicId)).toEqual([
        { path: "/pricing", count: 1 },
      ])
    })
  }

  it("resolves, reopens and deletes many comments with counts kept right", async () => {
    const t = setup()
    const { publicId, alice, ids } = await ownedProject(t, [
      "/b",
      "/a",
      "/b",
      "/a",
    ])

    expect(
      await alice.mutation(api.comments.bulkSetStatus, {
        ids: ids.slice(0, 3),
        status: "resolved",
      })
    ).toBe(3)
    expect(await counts(t, publicId)).toEqual({ open: 1, total: 4 })
    // Already resolved ones are skipped.
    expect(
      await alice.mutation(api.comments.bulkSetStatus, {
        ids,
        status: "resolved",
      })
    ).toBe(1)
    expect(await pageCounts(t, publicId)).toEqual([])

    await alice.mutation(api.comments.bulkSetStatus, {
      ids: [ids[0]!, ids[1]!],
      status: "open",
    })
    expect(await pageCounts(t, publicId)).toEqual(
      expect.arrayContaining([
        { path: "/a", count: 1 },
        { path: "/b", count: 1 },
      ])
    )

    expect(await alice.mutation(api.comments.bulkRemove, { ids })).toBe(4)
    expect(await counts(t, publicId)).toEqual({ open: 0, total: 0 })
    expect(await pageCounts(t, publicId)).toEqual([])
  })

  it("only lets the owner act in bulk, one project at a time, up to the limit", async () => {
    const t = setup()
    const { alice, ids } = await ownedProject(t, ["/b", "/a"])
    const bob = await signIn(t, "user_bob", "Bob")
    await expect(
      bob.mutation(api.comments.bulkRemove, { ids })
    ).rejects.toThrow(/owner/)
    await expect(t.mutation(api.comments.bulkRemove, { ids })).rejects.toThrow(
      /Sign in/
    )

    const other = await addComment(t, generateProjectId())
    await expect(
      alice.mutation(api.comments.bulkSetStatus, {
        ids: [...ids, other],
        status: "resolved",
      })
    ).rejects.toThrow(/several projects/)
    await expect(
      alice.mutation(api.comments.bulkSetStatus, {
        ids: Array.from({ length: LIMITS.bulkMax + 1 }, () => ids[0]!),
        status: "resolved",
      })
    ).rejects.toThrow(/up to/)
  })
})

describe("dashboard", () => {
  it("shows the owner a projection of the project, never the row", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    const project = await alice.query(api.projects.getMine, { publicId })
    expect(project).toMatchObject({ publicId, origins: [ORIGIN] })
    expect(project).not.toHaveProperty("ownerId")
    expect(project).not.toHaveProperty("deletingAt")
    const [listed] = await alice.query(api.projects.listMine, {})
    expect(listed).toEqual(project)
  })

  it("lists the open, lost and resolved views", async () => {
    const t = setup()
    const { publicId, alice, ids } = await ownedProject(t, ["/b", "/a", "/b"])
    const [lost, resolved] = ids
    await postJson(t, "/widget/pins", { publicId, path: "/b", lost: [lost] })
    await alice.mutation(api.comments.resolve, { id: resolved! })
    const view = async (view: "open" | "lost" | "resolved") =>
      (
        await alice.query(api.comments.listForOwner, {
          publicId,
          view,
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page.map((c) => c._id)
    expect((await view("open")).sort()).toEqual([lost, ids[2]].sort())
    expect(await view("lost")).toEqual([lost])
    expect(await view("resolved")).toEqual([resolved])
  })

  it("names projects by publicId in every settings function", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    await alice.mutation(api.projects.rename, { publicId, name: "  Shop  " })
    await alice.mutation(api.projects.addOrigin, {
      publicId,
      origin: "https://staging.example.com",
    })
    await alice.mutation(api.projects.removeOrigin, {
      publicId,
      origin: ORIGIN,
    })
    expect(await alice.query(api.projects.getMine, { publicId })).toMatchObject(
      { name: "Shop", origins: ["https://staging.example.com"] }
    )
    await alice.mutation(api.transfers.create, { publicId })
    expect(await alice.query(api.transfers.active, { publicId })).toMatchObject(
      { expiresAt: expect.any(Number) }
    )
    await alice.mutation(api.transfers.cancel, { publicId })
    expect(await alice.query(api.transfers.active, { publicId })).toBeNull()
  })
})

describe("allowing owner tools on a site", () => {
  it("claims an unclaimed project and hands back an owner session in one step", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    const allow = (who: typeof alice, origin = ORIGIN) =>
      who.mutation(api.sessions.allowOwnerTools, { publicId, origin })

    const first = await allow(alice)
    expect(first).toMatchObject({
      status: "claimed",
      token: expect.stringMatching(/^nuni_s_/),
    })
    expect(
      await t.query(api.sessions.validate, {
        publicId,
        sessionToken: "token" in first ? first.token : "",
      })
    ).toEqual({ valid: true, ownerName: "Alice" })
    expect(await allow(alice)).toMatchObject({ status: "already_owner" })

    const bob = await signIn(t, "user_bob", "Bob")
    expect(await allow(bob)).toEqual({
      status: "claimed_by_other",
      ownerName: "Alice",
    })
    // Once claimed, a new site has to be added by the owner first.
    await expect(allow(alice, "https://elsewhere.example")).rejects.toThrow(
      /not registered/
    )
    await expect(
      t.mutation(api.sessions.allowOwnerTools, { publicId, origin: ORIGIN })
    ).rejects.toThrow(/Sign in/)
  })

  it("works for a project the widget has never reported", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const alice = await signIn(t, "user_alice", "Alice")
    expect(
      await alice.mutation(api.sessions.allowOwnerTools, {
        publicId,
        origin: ORIGIN,
      })
    ).toMatchObject({ status: "claimed" })
  })

  it("keeps the claim when the site list was full before this site got on it", async () => {
    const t = setup()
    const publicId = generateProjectId()
    for (let i = 0; i < SERVER_LIMITS.maxOriginsPerProject; i++) {
      await t.mutation(api.projects.touch, {
        publicId,
        origin: `https://preview-${i}.example`,
      })
    }
    const alice = await signIn(t, "user_alice", "Alice")
    const allowed = await claim(alice, publicId, "https://one-more.example")
    expect(allowed).toEqual({
      status: "claimed",
      sessionError: expect.stringMatching(/not registered/),
    })
    // The project is theirs, so they can manage its sites in the dashboard.
    const mine = await alice.query(api.projects.getMine, { publicId })
    expect(mine?.origins).toHaveLength(SERVER_LIMITS.maxOriginsPerProject)
    await alice.mutation(api.projects.removeOrigin, {
      publicId,
      origin: "https://preview-0.example",
    })
    await alice.mutation(api.projects.addOrigin, {
      publicId,
      origin: "https://one-more.example",
    })
    expect(
      await claim(alice, publicId, "https://one-more.example")
    ).toMatchObject({
      status: "already_owner",
      token: expect.stringMatching(/^nuni_s_/),
    })
  })
})

describe("sessions", () => {
  it("revokes every session of a project at once", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    for (let i = 0; i < 2; i++) await ownerToken(alice, publicId)
    expect(await alice.query(api.sessions.listMine, { publicId })).toHaveLength(
      3
    )
    const bob = await signIn(t, "user_bob", "Bob")
    await expect(
      bob.mutation(api.sessions.revokeAll, { publicId })
    ).rejects.toThrow(/owner/)
    expect(await alice.mutation(api.sessions.revokeAll, { publicId })).toBe(3)
    expect(await alice.query(api.sessions.listMine, { publicId })).toEqual([])
  })

  it("expires owner sessions, and the daily cleanup deletes them", async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      const { publicId, alice, id, token: old } = await ownedProject(t)
      vi.advanceTimersByTime(LIMITS.sessionTtlMs / 2)
      const fresh = await ownerToken(alice, publicId)
      vi.advanceTimersByTime(LIMITS.sessionTtlMs / 2 + 1)

      await expect(
        t.mutation(api.comments.resolve, { id, sessionToken: old })
      ).rejects.toThrow(/Not signed in to this project/)
      expect(await t.mutation(internal.tokens.cleanupExpired, {})).toBe(1)
      expect(await alice.query(api.sessions.listMine, { publicId })).toEqual([
        expect.objectContaining({ kind: "widget", origin: ORIGIN }),
      ])
      await t.mutation(api.comments.resolve, { id, sessionToken: fresh })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("transfer", () => {
  it("hands the project over and signs the old owner out", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    const session = await ownerToken(alice, publicId)
    const { token } = await alice.mutation(api.transfers.create, { publicId })
    expect(token).toMatch(/^nuni_t_/)

    const bob = await signIn(t, "user_bob", "Bob")
    expect(await bob.query(api.transfers.get, { token })).toMatchObject({
      publicId,
      fromName: "Alice",
      isOwner: false,
    })
    await expect(
      alice.mutation(api.transfers.accept, { token })
    ).rejects.toThrow(/already own/)
    expect(await bob.mutation(api.transfers.accept, { token })).toEqual({
      publicId,
    })
    expect(await bob.query(api.projects.getMine, { publicId })).not.toBeNull()
    expect(await alice.query(api.projects.getMine, { publicId })).toBeNull()
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: session })
    ).toEqual({ valid: false })
    // The link works once.
    expect(await bob.query(api.transfers.get, { token })).toBeNull()
    await expect(bob.mutation(api.transfers.accept, { token })).rejects.toThrow(
      /expired or was used/
    )
  })

  it("stops working when cancelled, replaced, or after a week", async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      const { publicId, alice } = await ownedProject(t)
      const bob = await signIn(t, "user_bob", "Bob")
      const link = () => alice.mutation(api.transfers.create, { publicId })
      const opens = async (token: string) =>
        (await bob.query(api.transfers.get, { token })) !== null

      const first = await link()
      const second = await link()
      expect(await opens(first.token)).toBe(false)
      expect(await opens(second.token)).toBe(true)

      await alice.mutation(api.transfers.cancel, { publicId })
      expect(await opens(second.token)).toBe(false)

      const third = await link()
      vi.advanceTimersByTime(LIMITS.transferTtlMs + 1000)
      expect(await opens(third.token)).toBe(false)
      expect(await t.mutation(internal.tokens.cleanupExpired, {})).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("can only be started by the owner in the dashboard", async () => {
    const t = setup()
    const { publicId } = await ownedProject(t)
    const bob = await signIn(t, "user_bob", "Bob")
    await expect(
      bob.mutation(api.transfers.create, { publicId })
    ).rejects.toThrow(/owner/)
    await expect(
      t.mutation(api.transfers.create, { publicId })
    ).rejects.toThrow(/Sign in/)
  })
})

describe("release and delete", () => {
  it("releases a project but keeps its comments", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t, ["/b", "/a"])
    const token = await ownerToken(alice, publicId)
    await alice.mutation(api.projects.release, { publicId })
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: false,
      openCount: 2,
    })
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: token })
    ).toEqual({ valid: false })
    // Anyone can claim it again.
    const bob = await signIn(t, "user_bob", "Bob")
    expect(await claim(bob, publicId)).toMatchObject({
      status: "claimed",
    })
  })

  it("releases projects when their owner is deleted in WorkOS", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    const session = await ownerToken(alice, publicId)
    const { token: link } = await alice.mutation(api.transfers.create, {
      publicId,
    })

    await t.mutation(internal.auth.authKitEvent, {
      event: "user.deleted",
      data: { id: "user_alice" },
    })

    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: false,
    })
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: session })
    ).toEqual({ valid: false })
    const bob = await signIn(t, "user_bob", "Bob")
    expect(await bob.query(api.transfers.get, { token: link })).toBeNull()
    expect(await claim(bob, publicId)).toMatchObject({
      status: "claimed",
    })
  })

  it("deletes everything in batches; the widget can start over", async () => {
    const t = setup()
    const { publicId, alice, ids } = await ownedProject(t, ["/b", "/a", "/b"])
    const project = (await alice.query(api.projects.getMine, { publicId }))!
    await postJson(t, "/widget/replies", {
      publicId,
      commentId: ids[0],
      body: "Me too",
      authorName: "Sam",
      authorSecret: generateSecret(),
    })
    await ownerToken(alice, publicId)
    // A terminal waiting for its sign-in to be approved.
    const { userCode } = await t.mutation(internal.cliAuth.start, {
      publicId,
      client: "nuni-cli test",
      ip: "1.1.1.1",
    })

    await expect(
      alice.mutation(api.projects.remove, { publicId, confirmName: "wrong" })
    ).rejects.toThrow(/Type the project name/)

    vi.useFakeTimers()
    try {
      await alice.mutation(api.projects.remove, {
        publicId,
        confirmName: project.name,
      })
      // Hidden at once, and closed to new comments while it runs.
      expect(await alice.query(api.projects.getMine, { publicId })).toBeNull()
      expect(await alice.query(api.projects.listMine, {})).toEqual([])
      await expect(addComment(t, publicId)).rejects.toThrow(/being deleted/)
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    } finally {
      vi.useRealTimers()
    }

    const left = await t.run(async (ctx) => ({
      projects: (await ctx.db.query("projects").collect()).length,
      comments: (await ctx.db.query("comments").collect()).length,
      replies: (await ctx.db.query("replies").collect()).length,
      sessions: (await ctx.db.query("widgetSessions").collect()).length,
      pageStats: (await ctx.db.query("pageStats").collect()).length,
      claims: (await ctx.db.query("claims").collect()).length,
      cliLogins: (await ctx.db.query("cliLogins").collect()).length,
    }))
    expect(left).toEqual({
      projects: 0,
      comments: 0,
      replies: 0,
      sessions: 0,
      pageStats: 0,
      claims: 0,
      cliLogins: 0,
    })

    // The old sign-in can't be approved for the next project with this ID.
    await expect(
      alice.mutation(api.cliAuth.approve, { userCode })
    ).rejects.toThrow(/expired/)

    // A widget that is still installed makes a new, empty, unclaimed project.
    await addComment(t, publicId)
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: false,
      openCount: 1,
    })
  })
})
