import { generateProjectId, generateSecret, LIMITS } from "@nuni/shared"
import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import { addComment, setup, signIn, type T } from "./helpers"

async function ownedProject(t: T, comments = 0) {
  const publicId = generateProjectId()
  const ids: Id<"comments">[] = []
  for (let i = 0; i < Math.max(1, comments); i++) {
    ids.push(await addComment(t, publicId, { path: i % 2 ? "/a" : "/b" }))
  }
  const alice = await signIn(t, "user_alice", "Alice")
  await alice.mutation(api.projects.claim, { publicId })
  const project = (await alice.query(api.projects.getMine, { publicId }))!
  return { publicId, alice, project, ids }
}

const pageCounts = (t: T, publicId: string) =>
  t.query(api.comments.pagesWithComments, { publicId })

describe("bulk actions", () => {
  it("resolves, reopens and deletes many comments with counts kept right", async () => {
    const t = setup()
    const { publicId, alice, ids } = await ownedProject(t, 4)

    expect(
      await alice.mutation(api.comments.bulkSetStatus, {
        ids: ids.slice(0, 3),
        status: "resolved",
      })
    ).toBe(3)
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 1,
    })
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
        expect.objectContaining({ path: "/a", count: 1 }),
        expect.objectContaining({ path: "/b", count: 1 }),
      ])
    )

    expect(await alice.mutation(api.comments.bulkRemove, { ids })).toBe(4)
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 0,
    })
    expect(await pageCounts(t, publicId)).toEqual([])
    const project = await alice.query(api.projects.getMine, { publicId })
    expect(project).toMatchObject({ commentCount: 0, openCount: 0 })
  })

  it("only works for the owner, one project at a time, up to the limit", async () => {
    const t = setup()
    const { alice, ids } = await ownedProject(t, 2)
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

describe("sessions", () => {
  it("revokes every session of a project at once", async () => {
    const t = setup()
    const { publicId, alice, project } = await ownedProject(t)
    for (let i = 0; i < 3; i++) {
      await alice.mutation(api.sessions.create, {
        publicId,
        origin: "http://localhost:3000",
      })
    }
    expect(await alice.query(api.sessions.listMine, { publicId })).toHaveLength(
      3
    )
    const bob = await signIn(t, "user_bob", "Bob")
    await expect(
      bob.mutation(api.sessions.revokeAll, { projectId: project._id })
    ).rejects.toThrow(/owner/)
    expect(
      await alice.mutation(api.sessions.revokeAll, { projectId: project._id })
    ).toBe(3)
    expect(await alice.query(api.sessions.listMine, { publicId })).toEqual([])
  })
})

describe("transfer", () => {
  it("hands the project over and signs the old owner out", async () => {
    const t = setup()
    const { publicId, alice, project } = await ownedProject(t)
    const { token: session } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    const { token } = await alice.mutation(api.transfers.create, {
      projectId: project._id,
    })
    expect(token).toMatch(/^nuni_t_/)
    expect(
      await alice.query(api.transfers.active, { projectId: project._id })
    ).toMatchObject({ expiresAt: expect.any(Number) })

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
      const { alice, project } = await ownedProject(t)
      const bob = await signIn(t, "user_bob", "Bob")
      const first = await alice.mutation(api.transfers.create, {
        projectId: project._id,
      })
      const second = await alice.mutation(api.transfers.create, {
        projectId: project._id,
      })
      expect(
        await bob.query(api.transfers.get, { token: first.token })
      ).toBeNull()
      expect(
        await bob.query(api.transfers.get, { token: second.token })
      ).not.toBeNull()

      await alice.mutation(api.transfers.cancel, { projectId: project._id })
      expect(
        await bob.query(api.transfers.get, { token: second.token })
      ).toBeNull()

      const third = await alice.mutation(api.transfers.create, {
        projectId: project._id,
      })
      vi.advanceTimersByTime(LIMITS.transferTtlMs + 1000)
      expect(
        await bob.query(api.transfers.get, { token: third.token })
      ).toBeNull()
      expect(await t.mutation(internal.transfers.cleanupExpired, {})).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("can't be started with a widget session or by someone else", async () => {
    const t = setup()
    const { project } = await ownedProject(t)
    const bob = await signIn(t, "user_bob", "Bob")
    await expect(
      bob.mutation(api.transfers.create, { projectId: project._id })
    ).rejects.toThrow(/owner/)
    await expect(
      t.mutation(api.transfers.create, { projectId: project._id })
    ).rejects.toThrow(/Sign in/)
  })
})

describe("release and delete", () => {
  it("releases a project but keeps its comments", async () => {
    const t = setup()
    const { publicId, alice, project } = await ownedProject(t, 2)
    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })
    await alice.mutation(api.projects.release, { projectId: project._id })
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: false,
      openCount: 2,
    })
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: token })
    ).toEqual({ valid: false })
    // Anyone can claim it again.
    const bob = await signIn(t, "user_bob", "Bob")
    expect(await bob.mutation(api.projects.claim, { publicId })).toMatchObject({
      status: "claimed",
    })
  })

  it("deletes everything in batches; the widget can start over", async () => {
    const t = setup()
    const { publicId, alice, project, ids } = await ownedProject(t, 3)
    await t.mutation(internal.replies.createFromWidget, {
      publicId,
      commentId: ids[0]!,
      ip: "1.1.1.1",
      body: "Me too",
      authorName: "Sam",
      authorSecret: generateSecret(),
    })
    await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })

    await expect(
      alice.mutation(api.projects.remove, {
        projectId: project._id,
        confirmName: "wrong",
      })
    ).rejects.toThrow(/Type the project name/)

    vi.useFakeTimers()
    try {
      await alice.mutation(api.projects.remove, {
        projectId: project._id,
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
      project: await ctx.db.get(project._id),
      comments: (await ctx.db.query("comments").collect()).length,
      replies: (await ctx.db.query("replies").collect()).length,
      sessions: (await ctx.db.query("widgetSessions").collect()).length,
      pageStats: (await ctx.db.query("pageStats").collect()).length,
      claims: (await ctx.db.query("claims").collect()).length,
    }))
    expect(left).toEqual({
      project: null,
      comments: 0,
      replies: 0,
      sessions: 0,
      pageStats: 0,
      claims: 0,
    })

    // A widget that is still installed makes a new, empty, unclaimed project.
    await addComment(t, publicId)
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: false,
      openCount: 1,
    })
  })
})
