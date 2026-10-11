import { generateProjectId, generateSecret } from "@nuni/shared"
import { describe, expect, it } from "vitest"

import { api } from "../convex/_generated/api"
import { addComment, setup, type T } from "./helpers"

const ORIGIN = "http://localhost:3000"

/** A visitor signs in with GitHub (via the dashboard) to comment on the site. */
async function signInToComment(t: T, publicId: string, subject = "user_ada") {
  const user = t.withIdentity({
    subject,
    name: "Ada Lovelace",
    pictureUrl: "https://avatars.githubusercontent.com/u/1",
  })
  await user.mutation(api.users.store, {})
  const { token } = await user.mutation(api.commenters.create, {
    publicId,
    origin: ORIGIN,
  })
  return token
}

function postReply(t: T, body: Record<string, unknown>) {
  return t.fetch("/widget/replies", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": "5.5.5.5" },
    body: JSON.stringify(body),
  })
}

const listPage = (t: T, publicId: string) =>
  t.query(api.comments.listForPage, { publicId, path: "/pricing" })

describe("commenter sign-in", () => {
  it("comments under the account, from any browser", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const token = await signInToComment(t, publicId)
    const me = await t.query(api.commenters.validate, {
      publicId,
      commenterToken: token,
    })
    expect(me).toMatchObject({ valid: true, name: "Ada Lovelace" })

    const laptop = generateSecret()
    const id = await addComment(t, publicId, {
      secret: laptop,
      commenterToken: token,
      body: "Signed in",
    })
    const comment = (await listPage(t, publicId)).find((c) => c._id === id)
    expect(comment).toMatchObject({
      authorName: "Ada Lovelace",
      signedIn: true,
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      authorKeyHash: me.valid ? me.authorKey : "",
    })
    const guest = (await listPage(t, publicId)).find((c) => c._id !== id)
    expect(guest?.signedIn).toBeUndefined()

    // Another browser, same account: Yours, edit and delete work.
    const phone = generateSecret()
    const mine = await t.query(api.comments.listMine, {
      publicId,
      authorSecret: phone,
      commenterToken: token,
    })
    expect(mine.map((c) => c._id)).toEqual([id])
    await t.mutation(api.comments.editOwn, {
      id,
      authorSecret: phone,
      commenterToken: token,
      body: "Edited on my phone",
    })
    // That browser without the sign-in is someone else.
    await expect(
      t.mutation(api.comments.deleteOwn, { id, authorSecret: phone })
    ).rejects.toThrow(/your own/)
    await t.mutation(api.comments.deleteOwn, {
      id,
      authorSecret: phone,
      commenterToken: token,
    })
    expect(await listPage(t, publicId)).toHaveLength(1)
  })

  it("replies and reacts under the account", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const token = await signInToComment(t, publicId)
    const res = await postReply(t, {
      publicId,
      commentId: id,
      body: "Same here",
      authorName: "Typed name",
      authorSecret: generateSecret(),
      commenterToken: token,
    })
    expect(res.status).toBe(201)
    const replyId = ((await res.json()) as { id: string }).id
    await t.mutation(api.reactions.toggle, {
      publicId,
      commentId: id,
      targetId: replyId,
      emoji: "👍",
      authorSecret: generateSecret(),
      commenterToken: token,
    })
    const thread = await t.query(api.replies.listForComment, {
      publicId,
      commentId: id,
    })
    expect(thread.replies[0]).toMatchObject({
      authorName: "Ada Lovelace",
      signedIn: true,
    })
    expect(thread.reactions[0]?.authorKeyHashes).toEqual([
      thread.replies[0]?.authorKeyHash,
    ])
    await t.mutation(api.replies.editOwn, {
      id: replyId as never,
      authorSecret: generateSecret(),
      commenterToken: token,
      body: "Edited",
    })
  })

  it("moves this browser's guest comments to the account", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const browser = generateSecret()
    const id = await addComment(t, publicId, { secret: browser })
    const other = await addComment(t, publicId)
    await postReply(t, {
      publicId,
      commentId: other,
      body: "Guest reply",
      authorName: "Sam",
      authorSecret: browser,
    })
    const react = (authorSecret: string, commenterToken?: string) =>
      t.mutation(api.reactions.toggle, {
        publicId,
        commentId: other,
        targetId: other,
        emoji: "👍",
        authorSecret,
        commenterToken,
      })
    await react(browser)
    const token = await signInToComment(t, publicId)
    // The account reacted the same way from another browser: keep one.
    await react(generateSecret(), token)

    await t.mutation(api.commenters.linkBrowser, {
      publicId,
      authorSecret: browser,
      commenterToken: token,
    })
    const comment = (await listPage(t, publicId)).find((c) => c._id === id)
    expect(comment).toMatchObject({
      authorName: "Ada Lovelace",
      signedIn: true,
    })
    const thread = await t.query(api.replies.listForComment, {
      publicId,
      commentId: other,
    })
    expect(thread.replies[0]).toMatchObject({ authorName: "Ada Lovelace" })
    expect(thread.reactions).toEqual([
      expect.objectContaining({ emoji: "👍", count: 1 }),
    ])
    const mine = await t.query(api.comments.listMine, {
      publicId,
      authorSecret: generateSecret(),
      commenterToken: token,
    })
    expect(mine.map((c) => c._id)).toEqual([id])
    // Linking needs the browser key and a live sign-in.
    await expect(
      t.mutation(api.commenters.linkBrowser, {
        publicId,
        authorSecret: browser,
        commenterToken: "nuni_c_nope",
      })
    ).rejects.toThrow(/signed out/)
  })

  it("only signs in on the project's own sites, and never as the owner", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const user = t.withIdentity({ subject: "user_ada", name: "Ada" })
    await user.mutation(api.users.store, {})
    await expect(
      user.mutation(api.commenters.create, {
        publicId,
        origin: "https://evil.example",
      })
    ).rejects.toThrow(/isn't set up/)
    await expect(
      t.mutation(api.commenters.create, { publicId, origin: ORIGIN })
    ).rejects.toThrow(/Sign in/)

    // Even the project's owner gets no owner tools from a commenter token.
    await user.mutation(api.projects.claim, { publicId })
    const token = await signInToComment(t, publicId)
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: token })
    ).toEqual({ valid: false })
    await expect(
      t.mutation(api.comments.resolve, { id, sessionToken: token })
    ).rejects.toThrow(/owner/)
    // The token is for this project only.
    const elsewhere = generateProjectId()
    await addComment(t, elsewhere)
    await expect(
      addComment(t, elsewhere, { commenterToken: token })
    ).rejects.toThrow(/signed out/)
  })

  it("signs out", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const token = await signInToComment(t, publicId)
    await t.mutation(api.commenters.signOut, { commenterToken: token })
    expect(
      await t.query(api.commenters.validate, {
        publicId,
        commenterToken: token,
      })
    ).toEqual({ valid: false })
    // A stale sign-in fails rather than posting as a guest.
    await expect(
      addComment(t, publicId, { commenterToken: token })
    ).rejects.toThrow(/signed out/)
  })
})
