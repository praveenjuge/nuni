import { generateProjectId } from "@nuni/shared"
import { describe, expect, it } from "vitest"

import { api, internal } from "../convex/_generated/api"
import { addComment, setup, signIn, type T } from "./helpers"

function post(t: T, path: string, body: unknown, ip = "9.9.9.9") {
  return t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": ip },
    body: JSON.stringify(body),
  })
}

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
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })

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

    await t.mutation(api.comments.resolve, { id, sessionToken: token })
    expect(
      (
        await t.query(api.comments.listForAgent, {
          publicId,
          sessionToken: token,
          status: "resolved",
        })
      ).comments
    ).toHaveLength(1)

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
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    await alice.mutation(api.projects.claim, { publicId })

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
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const { deviceSecret, userCode } = await startLogin(t, publicId)
    await startLogin(t, publicId)
    await t.run(async (ctx) => {
      for (const login of await ctx.db.query("cliLogins").collect()) {
        await ctx.db.patch(login._id, { expiresAt: Date.now() - 1 })
      }
    })
    expect(await alice.query(api.cliAuth.pending, { userCode })).toEqual({
      state: "expired",
    })
    await expect(
      alice.mutation(api.cliAuth.approve, { userCode })
    ).rejects.toThrow(/expired/)
    expect((await poll(t, deviceSecret)).status).toBe(410)
    expect(await t.mutation(internal.cliAuth.cleanupExpired, {})).toBe(1)
    expect(
      await t.run((ctx) => ctx.db.query("cliLogins").collect())
    ).toHaveLength(0)
  })

  it("rate limits new logins per IP", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      statuses.push((await post(t, "/cli/login/start", { publicId })).status)
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(10)
    expect(statuses.at(-1)).toBe(429)
  })

  it("rejects a widget token for another project", async () => {
    const t = setup()
    const mine = generateProjectId()
    const theirs = generateProjectId()
    await addComment(t, mine)
    await addComment(t, theirs)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId: mine })
    const { token } = await alice.mutation(api.sessions.create, {
      publicId: mine,
      origin: "http://localhost:3000",
    })
    await expect(
      t.query(api.comments.listForAgent, {
        publicId: theirs,
        sessionToken: token,
      })
    ).rejects.toThrow(/Not signed in/)
  })

  it("searches comments and lists pages for the agent", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const typo = await addComment(t, publicId, { body: "Typo in the heading" })
    await addComment(t, publicId, { body: "Make this bigger" })
    await addComment(t, publicId, { path: "/", body: "Another typo here" })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })

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
    await expect(
      t.query(api.comments.pagesForAgent, { publicId, sessionToken: "nope" })
    ).rejects.toThrow(/Not signed in/)
  })
})
