import { generateProjectId, LIMITS } from "@nuni/shared"
import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../convex/_generated/api"
import { SERVER_LIMITS } from "../convex/limits"
import { RATE_LIMITS } from "../convex/rateLimits"
import {
  addComment,
  ownedProject,
  ownerToken,
  postJson,
  setup,
  signIn,
  type T,
} from "./helpers"

const post = (t: T, path: string, body: unknown) =>
  postJson(t, path, body, "9.9.9.9")

async function startLogin(t: T, publicId: string) {
  const res = await post(t, "/cli/login/start", {
    publicId,
    client: "nuni-cli 0.1.5 (linux)",
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { deviceSecret: string; userCode: string }
}

const poll = (t: T, deviceSecret: string) =>
  post(t, "/cli/login/poll", { deviceSecret })

describe("nuni login (device code)", () => {
  it("signs the owner in after they approve the matching code", async () => {
    const t = setup()
    const { publicId, alice, id } = await ownedProject(t)

    const { deviceSecret, userCode } = await startLogin(t, publicId)
    expect(userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/)
    expect((await poll(t, deviceSecret)).status).toBe(202)

    // The approval page shows what is being signed in to, read-only.
    expect(
      await alice.query(api.cliAuth.pending, {
        userCode: userCode.toLowerCase(),
      })
    ).toMatchObject({
      state: "pending",
      publicId,
      access: "mine",
      client: "nuni-cli 0.1.5 (linux)",
    })
    expect(await t.query(api.cliAuth.pending, { userCode })).toEqual({
      state: "signed_out",
    })
    await alice.mutation(api.cliAuth.approve, { userCode })

    const approved = await poll(t, deviceSecret)
    expect(approved.status).toBe(200)
    const { token, ownerName } = (await approved.json()) as {
      token: string
      ownerName: string
    }
    expect(token).toMatch(/^nuni_s_/)
    expect(ownerName).toBe("Alice")
    // The token is handed out once; the login is gone afterwards.
    expect((await poll(t, deviceSecret)).status).toBe(410)

    const listed = await t.query(api.comments.listForAgent, {
      publicId,
      sessionToken: token,
    })
    expect(listed.comments.map((c) => c._id)).toEqual([id])
    expect(listed.comments[0]).toHaveProperty("userAgent")
    expect(listed.cursor).toBeNull()

    // It shows up as a CLI session and can be revoked like any other.
    const sessions = await alice.query(api.sessions.listMine, { publicId })
    expect(sessions).toEqual([
      expect.objectContaining({ kind: "cli", origin: "cli" }),
    ])
    await alice.mutation(api.sessions.revoke, { id: sessions[0]!._id })
    await expect(
      t.query(api.comments.listForAgent, { publicId, sessionToken: token })
    ).rejects.toThrow(/Not signed in/)
  })

  it("claims an unclaimed project on approval", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const bob = await signIn(t, "user_bob", "Bob")
    const { deviceSecret, userCode } = await startLogin(t, publicId)
    expect(await bob.query(api.cliAuth.pending, { userCode })).toMatchObject({
      access: "unclaimed",
    })
    await bob.mutation(api.cliAuth.approve, { userCode })
    expect((await poll(t, deviceSecret)).status).toBe(200)
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      claimed: true,
      ownerName: "Bob",
    })
  })

  it("refuses someone else's project, denials and unknown projects", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    const bob = await signIn(t, "user_bob", "Bob")

    const first = await startLogin(t, publicId)
    expect(
      await bob.query(api.cliAuth.pending, { userCode: first.userCode })
    ).toMatchObject({ access: "other", ownerName: "Alice" })
    await expect(
      bob.mutation(api.cliAuth.approve, { userCode: first.userCode })
    ).rejects.toThrow(/owner/)
    expect((await poll(t, first.deviceSecret)).status).toBe(202)

    await alice.mutation(api.cliAuth.deny, { userCode: first.userCode })
    expect((await poll(t, first.deviceSecret)).status).toBe(403)

    expect((await poll(t, "nuni_d_nope")).status).toBe(410)
    const unknown = await post(t, "/cli/login/start", {
      publicId: generateProjectId(),
    })
    expect(unknown.status).toBe(404)
    const invalid = await post(t, "/cli/login/start", { publicId: "nope" })
    expect(invalid.status).toBe(400)
  })

  it("expires codes nobody approves and cleans them up", async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      const { publicId, alice } = await ownedProject(t)
      const { deviceSecret, userCode } = await startLogin(t, publicId)
      await startLogin(t, publicId)
      vi.advanceTimersByTime(SERVER_LIMITS.cliLoginTtlMs + 1)

      expect(await alice.query(api.cliAuth.pending, { userCode })).toEqual({
        state: "expired",
      })
      await expect(
        alice.mutation(api.cliAuth.approve, { userCode })
      ).rejects.toThrow(/expired/)
      expect((await poll(t, deviceSecret)).status).toBe(410)
      await t.mutation(internal.tokens.cleanupExpired, {})
      expect(
        await t.run((ctx) => ctx.db.query("cliLogins").collect())
      ).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rate limits new logins per IP", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const allowed = RATE_LIMITS.cliLoginPerIp.rate
    const statuses: number[] = []
    for (let i = 0; i <= allowed; i++) {
      statuses.push((await post(t, "/cli/login/start", { publicId })).status)
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(allowed)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe("agent functions", () => {
  async function agent(t: T) {
    const owned = await ownedProject(t, ["/b", "/a", "/b"])
    return { ...owned, token: await ownerToken(owned.alice, owned.publicId) }
  }

  it("all answer `unauthenticated` for a token that isn't this project's owner session", async () => {
    const t = setup()
    const { publicId, id, token } = await agent(t)
    const theirs = await ownedProject(t)
    for (const sessionToken of ["nope", "nuni_s_nope", token]) {
      const args = { publicId: theirs.publicId, sessionToken }
      const calls = [
        t.query(api.comments.listForAgent, args),
        t.query(api.comments.pagesForAgent, args),
        t.query(api.comments.getForAgent, { ...args, id: theirs.id }),
        t.mutation(api.comments.setStatusForAgent, {
          ...args,
          ids: [theirs.id],
          status: "resolved",
        }),
        t.mutation(api.comments.resolve, { id: theirs.id, sessionToken }),
        t.mutation(api.replies.replyAsOwner, {
          ...args,
          commentId: theirs.id,
          body: "Hi",
        }),
      ]
      for (const call of calls) {
        await expect(call).rejects.toThrow(/Not signed in to this project/)
      }
    }
    // The widget's owner view stays quiet instead.
    expect(
      await t.query(api.comments.getForOwner, {
        publicId,
        id,
        sessionToken: "nuni_s_nope",
      })
    ).toBeNull()
  })

  it("resolves several comments, each with the note, and reports each id", async () => {
    const t = setup()
    const { publicId, ids, token } = await agent(t)
    const [a, b, c] = ids
    const other = await addComment(t, generateProjectId())

    const results = await t.mutation(api.comments.setStatusForAgent, {
      publicId,
      sessionToken: token,
      ids: [a!, "nope", b!, other],
      status: "resolved",
      note: "  Fixed in #12  ",
    })
    expect(results).toEqual([
      { id: a, ok: true, changed: true },
      {
        id: "nope",
        ok: false,
        error: expect.objectContaining({ code: "not_found" }),
      },
      { id: b, ok: true, changed: true },
      {
        id: other,
        ok: false,
        error: expect.objectContaining({ code: "not_found" }),
      },
    ])
    const thread = await t.query(api.comments.getForAgent, {
      publicId,
      sessionToken: token,
      id: a!,
    })
    expect(thread).toMatchObject({ status: "resolved" })
    expect(thread?.replies).toEqual([
      expect.objectContaining({ body: "Fixed in #12", isOwner: true }),
    ])
    expect(
      await t.query(api.comments.pagesForAgent, {
        publicId,
        sessionToken: token,
      })
    ).toEqual([{ path: "/b", openCount: 1 }])

    // Reopening without a note posts nothing; one already open is unchanged.
    expect(
      await t.mutation(api.comments.setStatusForAgent, {
        publicId,
        sessionToken: token,
        ids: [a!, c!],
        status: "open",
      })
    ).toEqual([
      { id: a, ok: true, changed: true },
      { id: c, ok: true, changed: false },
    ])
    expect(
      await t.query(api.comments.getForAgent, {
        publicId,
        sessionToken: token,
        id: "nope",
      })
    ).toBeNull()
  })

  it("leaves a comment as it was when its note can't be posted", async () => {
    const t = setup()
    const { publicId, ids, token } = await agent(t)
    const [full, fine] = ids
    for (let i = 0; i < SERVER_LIMITS.repliesPerComment; i++) {
      await t.mutation(api.replies.replyAsOwner, {
        publicId,
        commentId: full!,
        body: `Reply ${i}`,
        sessionToken: token,
      })
    }
    const results = await t.mutation(api.comments.setStatusForAgent, {
      publicId,
      sessionToken: token,
      ids: [full!, fine!],
      status: "resolved",
      note: "Done",
    })
    expect(results.map((r) => (r.ok ? "ok" : r.error.code))).toEqual([
      "cap_reached",
      "ok",
    ])
    const comment = await t.query(api.comments.getForAgent, {
      publicId,
      sessionToken: token,
      id: full!,
    })
    expect(comment?.status).toBe("open")

    await expect(
      t.mutation(api.comments.setStatusForAgent, {
        publicId,
        sessionToken: token,
        ids: Array.from({ length: LIMITS.bulkMax + 1 }, () => fine!),
        status: "resolved",
      })
    ).rejects.toThrow(/up to/)
  })

  it("searches comments and lists pages", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const typo = await addComment(t, publicId, { body: "Typo in the heading" })
    await addComment(t, publicId, { body: "Make this bigger" })
    await addComment(t, publicId, { path: "/", body: "Another typo here" })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const token = await ownerToken(alice, publicId)

    const found = await t.query(api.comments.listForAgent, {
      publicId,
      sessionToken: token,
      search: "typo",
    })
    expect(found.comments.map((c) => c.body).sort()).toEqual([
      "Another typo here",
      "Typo in the heading",
    ])
    const onPricing = await t.query(api.comments.listForAgent, {
      publicId,
      sessionToken: token,
      search: "typo",
      path: "/pricing",
    })
    expect(onPricing.comments.map((c) => c._id)).toEqual([typo])

    expect(
      await t.query(api.comments.pagesForAgent, {
        publicId,
        sessionToken: token,
      })
    ).toEqual([
      { path: "/pricing", openCount: 2 },
      { path: "/", openCount: 1 },
    ])
  })
})
