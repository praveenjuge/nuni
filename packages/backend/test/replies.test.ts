import { generateProjectId, generateSecret } from "@nuni/shared"
import { describe, expect, it } from "vitest"

import { api } from "../convex/_generated/api"
import { SERVER_LIMITS } from "../convex/limits"
import { RATE_LIMITS } from "../convex/rateLimits"
import {
  addComment,
  claim,
  ownerToken,
  postJson,
  setup,
  signIn,
  signInToComment,
  type T,
} from "./helpers"

const postReply = (t: T, body: Record<string, unknown>, ip?: string) =>
  postJson(t, "/widget/replies", body, ip)

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
    await claim(alice, publicId)
    const token = await ownerToken(alice, publicId)

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
    ).rejects.toThrow(/Sign in first/)

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
      id: mine,
      authorSecret: secret,
      body: "Edited",
    })
    await expect(
      t.mutation(api.replies.editOwn, {
        id: theirs,
        authorSecret: secret,
        body: "Hijack",
      })
    ).rejects.toThrow(/your own/)
    await expect(
      t.mutation(api.replies.remove, { id: theirs })
    ).rejects.toThrow(/Sign in first/)

    let { replies } = await thread(t, publicId, id)
    expect(replies[0]).toMatchObject({
      body: "Edited",
      editedAt: expect.any(Number),
    })

    await t.mutation(api.replies.deleteOwn, { id: mine, authorSecret: secret })
    const alice = await signIn(t, "user_alice", "Alice")
    await claim(alice, publicId)
    await alice.mutation(api.replies.remove, { id: theirs })
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
    const post = (i: number) =>
      postReply(
        t,
        {
          publicId,
          commentId: id,
          body: `Reply ${i}`,
          authorName: "x",
          authorSecret: generateSecret(),
        },
        `10.0.${i >> 8}.${i & 255}`
      )
    for (let i = 0; i < SERVER_LIMITS.repliesPerComment; i++) {
      expect((await post(i)).status).toBe(201)
    }
    expect((await post(SERVER_LIMITS.repliesPerComment)).status).toBe(403)
  })

  it("rate limits replies per IP", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const allowed = RATE_LIMITS.replyPerIp.capacity
    const statuses: number[] = []
    for (let i = 0; i <= allowed; i++) {
      const res = await postReply(t, {
        publicId,
        commentId: id,
        body: `Reply ${i}`,
        authorName: "x",
        authorSecret: generateSecret(),
      })
      statuses.push(res.status)
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(allowed)
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

  it("lets a signed-in commenter take back what this browser added as a guest", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const browser = generateSecret()
    const react = (commenterToken?: string) =>
      t.mutation(api.reactions.toggle, {
        publicId,
        commentId: id,
        targetId: id,
        emoji: "👍",
        authorSecret: browser,
        commenterToken,
      })
    await react()
    const token = await signInToComment(t, publicId)
    expect(await react(token)).toEqual({ added: false })
    expect((await thread(t, publicId, id)).reactions).toEqual([])
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
