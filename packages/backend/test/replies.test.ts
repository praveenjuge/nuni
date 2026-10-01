import { generateProjectId, generateSecret, LIMITS } from "@nuni/shared"
import { describe, expect, it } from "vitest"

import { api } from "../convex/_generated/api"
import { addComment, setup, signIn, type T } from "./helpers"

function postReply(t: T, body: Record<string, unknown>, ip = "5.5.5.5") {
  return t.fetch("/widget/replies", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": ip },
    body: JSON.stringify(body),
  })
}

async function reply(
  t: T,
  publicId: string,
  commentId: string,
  opts: { secret?: string; body?: string; sessionToken?: string } = {}
) {
  const res = await postReply(t, {
    publicId,
    commentId,
    body: opts.body ?? "Agreed, it's tiny",
    authorName: "Riley",
    authorSecret: opts.secret ?? generateSecret(),
    sessionToken: opts.sessionToken,
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const thread = (t: T, publicId: string, commentId: string) =>
  t.query(api.replies.listForComment, { publicId, commentId })

describe("replies", () => {
  it("adds replies to a thread and keeps the count", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    await reply(t, publicId, id, { body: "First" })
    await reply(t, publicId, id, { body: "Second" })

    const { replies } = await thread(t, publicId, id)
    expect(replies.map((r) => r.body)).toEqual(["First", "Second"])
    expect(replies[0]).toMatchObject({ authorName: "Riley", isOwner: false })
    const [listed] = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(listed?.replyCount).toBe(2)

    // A reply has to point at a comment in the same project.
    const other = generateProjectId()
    await addComment(t, other)
    const wrong = await postReply(t, {
      publicId: other,
      commentId: id,
      body: "x",
      authorName: "x",
      authorSecret: generateSecret(),
    })
    expect(wrong.status).toBe(404)
    const empty = await postReply(t, {
      publicId,
      commentId: id,
      body: "   ",
      authorName: "x",
      authorSecret: generateSecret(),
    })
    expect(empty.status).toBe(400)
  })

  it("marks owner replies from the widget, the dashboard and the CLI", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    const { token } = await alice.mutation(api.sessions.create, {
      publicId,
      origin: "http://localhost:3000",
    })

    await reply(t, publicId, id, { sessionToken: token, body: "On it" })
    await alice.mutation(api.replies.replyAsOwner, {
      publicId,
      commentId: id,
      body: "Fixed",
    })
    await t.mutation(api.replies.replyAsOwner, {
      publicId,
      commentId: id,
      body: "Deployed",
      sessionToken: token,
    })
    // A wrong token is just an anonymous reply, not an owner one.
    await reply(t, publicId, id, { sessionToken: "nuni_s_nope", body: "Hi" })

    const { replies } = await thread(t, publicId, id)
    expect(replies.map((r) => [r.body, r.authorName, r.isOwner])).toEqual([
      ["On it", "Alice", true],
      ["Fixed", "Alice", true],
      ["Deployed", "Alice", true],
      ["Hi", "Riley", false],
    ])
    await expect(
      t.mutation(api.replies.replyAsOwner, {
        publicId,
        commentId: id,
        body: "Not mine",
      })
    ).rejects.toThrow(/owner/)

    // The owner's agent sees the thread.
    const detail = await alice.query(api.comments.getForOwner, {
      publicId,
      id,
    })
    expect(detail?.replies).toHaveLength(4)
  })

  it("lets authors edit and delete their own replies, and owners remove any", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const secret = generateSecret()
    const mine = await reply(t, publicId, id, { secret })
    const theirs = await reply(t, publicId, id)

    await t.mutation(api.replies.editOwn, {
      id: mine as never,
      authorSecret: secret,
      body: "Edited",
    })
    await expect(
      t.mutation(api.replies.editOwn, {
        id: theirs as never,
        authorSecret: secret,
        body: "Hijack",
      })
    ).rejects.toThrow(/your own/)
    await expect(
      t.mutation(api.replies.remove, { id: theirs as never })
    ).rejects.toThrow()

    let { replies } = await thread(t, publicId, id)
    expect(replies[0]).toMatchObject({
      body: "Edited",
      editedAt: expect.any(Number),
    })

    await t.mutation(api.replies.deleteOwn, {
      id: mine as never,
      authorSecret: secret,
    })
    const alice = await signIn(t, "user_alice", "Alice")
    await alice.mutation(api.projects.claim, { publicId })
    await alice.mutation(api.replies.remove, { id: theirs as never })
    ;({ replies } = await thread(t, publicId, id))
    expect(replies).toEqual([])
    const [listed] = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(listed?.replyCount).toBe(0)
  })

  it("caps replies per thread", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { replyCount: LIMITS.repliesPerComment })
    })
    const res = await postReply(t, {
      publicId,
      commentId: id,
      body: "One more",
      authorName: "x",
      authorSecret: generateSecret(),
    })
    expect(res.status).toBe(403)
  })

  it("rate limits replies per IP", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) {
      const res = await postReply(t, {
        publicId,
        commentId: id,
        body: `Reply ${i}`,
        authorName: "x",
        authorSecret: generateSecret(),
      })
      statuses.push(res.status)
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(20)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe("reactions", () => {
  it("toggles one emoji per author on comments and replies", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const replyId = await reply(t, publicId, id)
    const sam = generateSecret()
    const kim = generateSecret()
    const react = (targetId: string, emoji: string, authorSecret: string) =>
      t.mutation(api.reactions.toggle, {
        publicId,
        commentId: id,
        targetId,
        emoji,
        authorSecret,
      })

    expect(await react(id, "👍", sam)).toEqual({ added: true })
    expect(await react(id, "👍", kim)).toEqual({ added: true })
    expect(await react(replyId, "🎉", sam)).toEqual({ added: true })
    expect(await react(id, "👍", sam)).toEqual({ added: false })

    const { reactions } = await thread(t, publicId, id)
    expect(reactions.map((r) => [r.targetId, r.emoji, r.count]).sort()).toEqual(
      [
        [id, "👍", 1],
        [replyId, "🎉", 1],
      ].sort()
    )

    await expect(react(id, "🍕", sam)).rejects.toThrow(/Unknown reaction/)
    const other = await addComment(t, publicId)
    await expect(
      t.mutation(api.reactions.toggle, {
        publicId,
        commentId: other,
        targetId: replyId,
        emoji: "👍",
        authorSecret: sam,
      })
    ).rejects.toThrow(/not found/)
  })

  it("deletes the whole thread with the comment", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const secret = generateSecret()
    const id = await addComment(t, publicId, { secret })
    const replyId = await reply(t, publicId, id)
    await t.mutation(api.reactions.toggle, {
      publicId,
      commentId: id,
      targetId: replyId,
      emoji: "❤️",
      authorSecret: secret,
    })
    await t.mutation(api.comments.deleteOwn, { id, authorSecret: secret })
    const left = await t.run(async (ctx) => ({
      replies: await ctx.db.query("replies").collect(),
      reactions: await ctx.db.query("reactions").collect(),
    }))
    expect(left).toEqual({ replies: [], reactions: [] })
  })
})
