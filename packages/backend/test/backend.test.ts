import { generateProjectId, generateSecret, LIMITS } from "@nuni/shared"
import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../convex/_generated/api"
import { SERVER_LIMITS } from "../convex/limits"
import { RATE_LIMITS } from "../convex/rateLimits"
import {
  addComment,
  claim,
  anchor,
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
      ORIGIN,
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

  it("lists comments on every page, open first, for the panel", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId, { body: "Pricing one" })
    await addComment(t, publicId, { path: "/about", body: "About one" })
    const id = await addComment(t, publicId, {
      path: "/docs",
      body: "Docs one",
    })
    const alice = await signIn(t, "user_alice", "Alice")
    await claim(alice, publicId)
    await alice.mutation(api.comments.resolve, { id })

    const site = await t.query(api.comments.listForSite, { publicId })
    expect(site.map((c) => [c.body, c.page.path, c.status])).toEqual([
      ["About one", "/about", "open"],
      ["Pricing one", "/pricing", "open"],
      ["Docs one", "/docs", "resolved"],
    ])
    expect(site[0]).not.toHaveProperty("userAgent")
    expect(
      await t.query(api.comments.listForSite, {
        publicId: generateProjectId(),
      })
    ).toEqual([])
  })

  it("rejects invalid project ids and empty bodies", async () => {
    const t = setup()
    await expect(addComment(t, "nuni_nope")).rejects.toThrow(
      /Invalid project ID/
    )
    await expect(
      addComment(t, generateProjectId(), { body: "   " })
    ).rejects.toThrow(/empty/)
  })

  it("rate limits per IP", async () => {
    const t = setup()
    const publicId = generateProjectId()
    for (let i = 0; i < RATE_LIMITS.commentPerIp.capacity; i++)
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
      for (let i = 0; i < RATE_LIMITS.commentPerIp.capacity; i++)
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
    vi.useFakeTimers()
    try {
      const t = setup()
      const publicId = generateProjectId()
      const perMinute = RATE_LIMITS.commentPerProject.capacity
      for (let i = 0; i < LIMITS.unclaimedCommentCap; i++) {
        if (i % perMinute === 0) vi.advanceTimersByTime(60_000)
        await addComment(t, publicId, { ip: `10.0.${i >> 8}.${i & 255}` })
      }
      vi.advanceTimersByTime(60_000)
      await expect(addComment(t, publicId)).rejects.toThrow(/limit/)
    } finally {
      vi.useRealTimers()
    }
    // It posts 500 comments.
  }, 30_000)

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
      /Sign in first/
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
        // The attacker supplies a url consistent with the origin, so the
        // payload reaches the path check.
        addComment(t, publicId, { ip: `10.0.0.${n}`, page: { path: bad } })
      ).rejects.toThrow(/continue the host/)
    }
    // Normal, hash-router and custom getPageKey paths still work.
    await addComment(t, publicId, { path: "/docs" })
    await addComment(t, publicId, { path: "/#/settings" })
    // Custom keys are opaque: the real URL stays a normal page URL.
    await addComment(t, publicId, {
      ip: "10.0.0.99",
      page: { path: "product-123" },
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
      addComment(t, generateProjectId(), {
        page: { url: "https://other.example.com/pricing?token=x" },
      })
    ).rejects.toThrow(/does not match/)
  })

  it("lists comments on a path longer than the stored one", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const path = `/${"a".repeat(SERVER_LIMITS.pagePartMaxLength + 50)}`
    const id = await addComment(t, publicId, { path })
    const listed = await t.query(api.comments.listForPage, { publicId, path })
    expect(listed.map((c) => c._id)).toEqual([id])
  })

  it("keeps page counts in sync through resolve, reopen and delete", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    await addComment(t, publicId, { path: "/about" })
    const alice = await signIn(t, "user_alice", "Alice")
    await claim(alice, publicId)
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

  it("stores suggested text changes for the commented text only", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const secret = generateSecret()
    const quote = { exact: "Start free trial", prefix: "", suffix: "" }

    // On selected words, with no comment text: the suggestion says it all.
    const onText = await addComment(t, publicId, {
      body: "  ",
      secret,
      suggestion: { before: "Start free trial", after: "Try it free" },
      anchor: { quote },
    })
    // On a small element's whole text (the anchor text is "Buy now").
    await addComment(t, publicId, {
      suggestion: { before: "Buy now", after: "Buy" },
    })
    const listed = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(
      listed
        .map((c) => c.suggestion)
        .sort((a, b) => a!.after.localeCompare(b!.after))
    ).toEqual([
      { before: "Buy now", after: "Buy" },
      { before: "Start free trial", after: "Try it free" },
    ])
    expect(listed.find((c) => c._id === onText)?.body).toBe("")

    for (const suggestion of [
      // Not the commented text.
      { before: "Something else", after: "New" },
      // Unchanged or empty.
      { before: "Buy now", after: "Buy now" },
      { before: "Buy now", after: "  " },
      // Too long.
      { before: "Buy now", after: "x".repeat(LIMITS.quoteMaxLength + 1) },
    ]) {
      await expect(addComment(t, publicId, { suggestion })).rejects.toThrow(
        /suggest/i
      )
    }
    // Areas have no text to replace.
    await expect(
      addComment(t, publicId, {
        anchor: { region: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        suggestion: { before: "Buy now", after: "Buy" },
      })
    ).rejects.toThrow(/suggest/i)
    // The comment text can be emptied when there is a suggestion, not otherwise.
    await t.mutation(api.comments.editOwn, {
      id: onText,
      authorSecret: secret,
      body: " ",
    })
    const plain = await addComment(t, publicId, { secret })
    await expect(
      t.mutation(api.comments.editOwn, {
        id: plain,
        authorSecret: secret,
        body: " ",
      })
    ).rejects.toThrow(/empty/)

    // The author can change the new words, and they are searchable.
    await t.mutation(api.comments.editOwn, {
      id: onText,
      authorSecret: secret,
      body: "Shorter reads better",
      suggestion: "Try free",
    })
    await expect(
      t.mutation(api.comments.editOwn, {
        id: onText,
        authorSecret: secret,
        body: "",
        suggestion: "Start free trial",
      })
    ).rejects.toThrow(/suggest/i)
    const edited = await t.run((ctx) => ctx.db.get(onText))
    expect(edited).toMatchObject({
      body: "Shorter reads better",
      suggestion: { before: "Start free trial", after: "Try free" },
    })
    expect(edited?.searchText).toContain("Try free")
  })

  it("lists a commenter's own comments on every page, by their key only", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const other = generateProjectId()
    const secret = generateSecret()
    const first = await addComment(t, publicId, { secret, body: "One" })
    await addComment(t, publicId, { secret, path: "/about", body: "Two" })
    await addComment(t, publicId, { body: "Someone else's" })
    await addComment(t, other, { secret, body: "Another site" })
    const alice = await signIn(t, "user_alice", "Alice")
    await claim(alice, publicId)
    await alice.mutation(api.comments.resolve, { id: first })

    const mine = await t.query(api.comments.listMine, {
      publicId,
      authorSecret: secret,
    })
    expect(mine.map((c) => [c.body, c.page.path, c.status])).toEqual([
      ["Two", "/about", "open"],
      ["One", "/pricing", "resolved"],
    ])
    // The public hash is not enough to list someone's comments.
    expect(
      await t.query(api.comments.listMine, {
        publicId,
        authorSecret: mine[0]!.authorKeyHash,
      })
    ).toEqual([])
    expect(
      await t.query(api.comments.listMine, { publicId, authorSecret: "short" })
    ).toEqual([])
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

    expect(await claim(alice, publicId)).toMatchObject({
      status: "claimed",
    })
    expect(await claim(alice, publicId)).toMatchObject({
      status: "already_owner",
    })
    expect(await claim(bob, publicId)).toEqual({
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
      t.mutation(api.sessions.allowOwnerTools, {
        publicId: generateProjectId(),
        origin: ORIGIN,
      })
    ).rejects.toThrow(/Sign in/)
  })

  it("claims a project the widget has never touched", async () => {
    const t = setup()
    const alice = await signIn(t, "user_alice", "Alice")
    const publicId = generateProjectId()
    expect(await claim(alice, publicId)).toMatchObject({ status: "claimed" })
    expect(await alice.query(api.projects.getMine, { publicId })).toMatchObject(
      { origins: [ORIGIN] }
    )
  })

  it("lets the owner resolve, reopen and delete from the dashboard", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    await claim(alice, publicId)

    await expect(bob.mutation(api.comments.resolve, { id })).rejects.toThrow(
      /owner/
    )
    await alice.mutation(api.comments.resolve, { id })
    expect(
      (
        await alice.query(api.comments.listForOwner, {
          publicId,
          view: "resolved",
          paginationOpts: { numItems: 50, cursor: null },
        })
      ).page
    ).toHaveLength(1)
    expect(
      (
        await bob.query(api.comments.listForOwner, {
          publicId,
          view: "open",
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
          view: "open",
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
    const token = await ownerToken(alice, publicId)
    await claim(alice, otherId)

    const bob = await signIn(t, "user_bob", "Bob")
    await expect(ownerToken(bob, publicId)).rejects.toThrow(/Not the owner/)

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
    ).rejects.toThrow(/Not signed in to this project/)

    const [session] = await alice.query(api.sessions.listMine, { publicId })
    await alice.mutation(api.sessions.revoke, { id: session!._id })
    await expect(
      t.mutation(api.comments.reopen, {
        id,
        sessionToken: token,
      })
    ).rejects.toThrow(/Not signed in to this project/)
  })

  it("only mints owner sessions for origins registered to the project", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId) // registers http://localhost:3000
    const alice = await signIn(t, "user_alice", "Alice")
    await claim(alice, publicId)

    // A crafted claim link naming an outside origin cannot mint a session.
    await expect(
      claim(alice, publicId, "https://attacker.example")
    ).rejects.toThrow(/not registered/)
    // The registered origin still works.
    const token = await ownerToken(alice, publicId)
    expect(
      await t.query(api.sessions.validate, { publicId, sessionToken: token })
    ).toMatchObject({ valid: true })
  })

  it("stops anonymous traffic from registering origins on claimed projects", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)

    // Neither widget loads nor new comments append origins once claimed,
    // so the session origin check cannot be pre-defeated by pollution.
    await t.mutation(api.projects.touch, {
      publicId,
      origin: "https://attacker.example",
    })
    await addComment(t, publicId, { origin: "https://attacker.example" })
    const project = await alice.query(api.projects.getMine, { publicId })
    expect(project?.origins).toEqual([ORIGIN])
    await expect(
      claim(alice, publicId, "https://attacker.example")
    ).rejects.toThrow(/not registered/)
  })

  it("lets only the owner register origins", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    await claim(alice, publicId)
    await expect(
      bob.mutation(api.projects.addOrigin, {
        publicId,
        origin: "https://attacker.example",
      })
    ).rejects.toThrow(/owner/)
    await alice.mutation(api.projects.addOrigin, {
      publicId,
      origin: "https://staging.example.com",
    })
    // Adding the same origin twice is a no-op.
    await alice.mutation(api.projects.addOrigin, {
      publicId,
      origin: "https://staging.example.com",
    })
    const project = await alice.query(api.projects.getMine, { publicId })
    expect(project?.origins).toEqual([ORIGIN, "https://staging.example.com"])
    // Sessions can now be minted for the newly registered origin.
    const token = await ownerToken(
      alice,
      publicId,
      "https://staging.example.com"
    )
    expect(
      (await t.query(api.sessions.validate, { publicId, sessionToken: token }))
        .valid
    ).toBe(true)
  })

  it("lets only the owner remove origins, signing out sessions made there", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId) // registers http://localhost:3000
    const alice = await signIn(t, "user_alice", "Alice")
    const bob = await signIn(t, "user_bob", "Bob")
    await claim(alice, publicId)
    await alice.mutation(api.projects.addOrigin, {
      publicId,
      origin: "https://staging.example.com",
    })
    const staging = await ownerToken(
      alice,
      publicId,
      "https://staging.example.com"
    )
    const local = await ownerToken(alice, publicId)
    const { token: commenter } = await bob.mutation(api.commenters.create, {
      publicId,
      origin: "https://staging.example.com",
    })

    await expect(
      bob.mutation(api.projects.removeOrigin, {
        publicId,
        origin: "https://staging.example.com",
      })
    ).rejects.toThrow(/owner/)
    await alice.mutation(api.projects.removeOrigin, {
      publicId,
      origin: "https://staging.example.com/",
    })
    // Removing one that isn't there is a no-op.
    await alice.mutation(api.projects.removeOrigin, {
      publicId,
      origin: "https://staging.example.com",
    })
    const project = await alice.query(api.projects.getMine, { publicId })
    expect(project?.origins).toEqual([ORIGIN])

    // Sign-ins made on the removed site are gone; others stay.
    expect(
      (
        await t.query(api.sessions.validate, {
          publicId,
          sessionToken: staging,
        })
      ).valid
    ).toBe(false)
    expect(
      (await t.query(api.sessions.validate, { publicId, sessionToken: local }))
        .valid
    ).toBe(true)
    expect(
      (
        await t.query(api.commenters.validate, {
          publicId,
          commenterToken: commenter,
        })
      ).valid
    ).toBe(false)
    // And no new owner session can be minted there.
    await expect(
      claim(alice, publicId, "https://staging.example.com")
    ).rejects.toThrow(/not registered/)
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
    await claim(alice, publicId)
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
    await claim(alice, publicId)
    const list = (args: Record<string, string>) =>
      alice.query(api.comments.listForOwner, {
        publicId,
        view: "open",
        paginationOpts: { numItems: 2, cursor: null },
        ...args,
      })
    expect((await list({ path: "/about" })).page).toHaveLength(1)
    expect(
      (await list({ origin: "https://prod.example.com" })).page
    ).toHaveLength(1)
    const filters = await alice.query(api.comments.ownerFilters, { publicId })
    expect(filters.paths.sort()).toEqual(["/about", "/pricing"])
  })

  it("searches by author name as well as body", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    const search = (q: string) =>
      alice.query(api.comments.listForOwner, {
        publicId,
        view: "open",
        search: q,
        paginationOpts: { numItems: 10, cursor: null },
      })
    expect((await search("Sam")).page).toHaveLength(1)
    expect((await search("bigger")).page).toHaveLength(1)
    expect((await search("nobody")).page).toHaveLength(0)
  })

  it("keeps cleaning up while expired sessions remain", async () => {
    const t = setup()
    await ownedProject(t)
    await t.run(async (ctx) => {
      const project = await ctx.db.query("projects").first()
      const user = await ctx.db.query("users").first()
      for (let i = 0; i < SERVER_LIMITS.cleanupBatch + 20; i++) {
        await ctx.db.insert("widgetSessions", {
          tokenHash: `h${i}`,
          userId: user!._id,
          projectId: project!._id,
          origin: ORIGIN,
          expiresAt: Date.now() - 1,
        })
      }
    })
    vi.useFakeTimers()
    await t.mutation(internal.tokens.cleanupExpired, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()
    // Only the session from claiming is left.
    expect(
      await t.run((ctx) => ctx.db.query("widgetSessions").collect())
    ).toHaveLength(1)
  })
})

describe("attached images", () => {
  const uploadImage = (
    t: T,
    target: { publicId: string; id: string; secret: string },
    body?: BodyInit
  ) => upload(t, "image", target, body)

  it("lets the author attach a few public images on claimed sites", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const secret = generateSecret()
    const id = await addComment(t, publicId, { secret })

    // Unclaimed sites can't be used to host public images.
    expect((await uploadImage(t, { publicId, id, secret })).status).toBe(403)
    const alice = await signIn(t, "user_alice", "Alice")
    await claim(alice, publicId)

    expect(
      (await uploadImage(t, { publicId, id, secret: generateSecret() })).status
    ).toBe(403)
    expect(
      (
        await uploadImage(
          t,
          { publicId, id, secret },
          new TextEncoder().encode("<svg onload=alert(1)>")
        )
      ).status
    ).toBe(415)
    expect(
      (
        await uploadImage(
          t,
          { publicId, id, secret },
          new Uint8Array(LIMITS.imageMaxBytes + 1)
        )
      ).status
    ).toBe(413)

    for (let i = 0; i < LIMITS.imagesPerComment; i++) {
      expect((await uploadImage(t, { publicId, id, secret })).status).toBe(201)
    }
    expect((await uploadImage(t, { publicId, id, secret })).status).toBe(409)
    // The owner-only screenshot is separate, and still allowed.
    expect((await uploadScreenshot(t, { publicId, id, secret })).status).toBe(
      201
    )

    // Everyone sees the images with the thread; the list only counts them.
    const [listed] = await t.query(api.comments.listForPage, {
      publicId,
      path: "/pricing",
    })
    expect(listed?.imageCount).toBe(LIMITS.imagesPerComment)
    const thread = await t.query(api.replies.listForComment, {
      publicId,
      commentId: id,
    })
    expect(thread.images).toHaveLength(LIMITS.imagesPerComment)
    for (const url of thread.images) expect(url).toMatch(/^https?:\/\//)
    const owner = await alice.query(api.comments.getForOwner, { publicId, id })
    expect(owner?.imageUrls).toEqual(thread.images)

    // Deleting the comment deletes every file.
    expect(await storedFiles(t)).toHaveLength(LIMITS.imagesPerComment + 1)
  })

  it("rejects images after the upload window, and deletes them with the project", async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      const publicId = generateProjectId()
      const secret = generateSecret()
      const alice = await signIn(t, "user_alice", "Alice")
      await addComment(t, publicId)
      await claim(alice, publicId)
      const late = await addComment(t, publicId, { secret })
      const fresh = await addComment(t, publicId, { secret })
      expect(
        (await uploadImage(t, { publicId, id: fresh, secret })).status
      ).toBe(201)
      vi.advanceTimersByTime(SERVER_LIMITS.uploadWindowMs + 1)
      expect(
        (await uploadImage(t, { publicId, id: late, secret })).status
      ).toBe(410)

      const project = await alice.query(api.projects.getMine, { publicId })
      await alice.mutation(api.projects.remove, {
        publicId,
        confirmName: project!.name,
      })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(await storedFiles(t)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

const uploadScreenshot = (
  t: T,
  target: { publicId: string; id: string; secret: string },
  body?: BodyInit
) => upload(t, "screenshot", target, body)

describe("lost pins", () => {
  const report = (
    t: T,
    publicId: string,
    body: { path?: string; lost?: string[]; found?: string[] },
    ip?: string
  ) => postJson(t, "/widget/pins", { publicId, path: "/pricing", ...body }, ip)

  it("records pins visitors can't find, and clears them when found", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const a = await addComment(t, publicId)
    const b = await addComment(t, publicId)
    const elsewhere = await addComment(t, publicId, { path: "/about" })
    const other = await addComment(t, generateProjectId())
    const alice = await signIn(t, "user_alice", "Alice")
    await claim(alice, publicId)

    // Only open comments of this project, on the reported page, change.
    let res = await report(t, publicId, { lost: [a, elsewhere, other, "x"] })
    expect(await res.json()).toEqual({ changed: 1 })
    // Reporting the same again writes nothing.
    res = await report(t, publicId, { lost: [a] })
    expect(await res.json()).toEqual({ changed: 0 })

    expect(
      (await t.query(api.comments.listForPage, { publicId, path: "/pricing" }))
        .filter((c) => c.pinLost)
        .map((c) => c._id)
    ).toEqual([a])

    const lost = await alice.query(api.comments.listForOwner, {
      publicId,
      view: "lost",
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(lost.page.map((c) => c._id)).toEqual([a])
    expect(lost.page[0]?.pinLostAt).toBeTypeOf("number")
    expect(await alice.query(api.comments.lostCount, { publicId })).toBe(1)
    expect(await t.query(api.comments.lostCount, { publicId })).toBe(0)

    // Found again by another visitor: cleared.
    res = await report(t, publicId, { found: [a, b] })
    expect(await res.json()).toEqual({ changed: 1 })
    expect(await alice.query(api.comments.lostCount, { publicId })).toBe(0)
  })

  it("rate limits reports and refuses oversized ones", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const id = await addComment(t, publicId)
    const allowed = RATE_LIMITS.pinReportPerIp.capacity
    const statuses: number[] = []
    for (let i = 0; i <= allowed; i++) {
      statuses.push(
        (await report(t, publicId, { lost: [id] }, "6.6.6.6")).status
      )
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(allowed)
    expect(statuses.at(-1)).toBe(429)
    const tooMany = Array.from({ length: LIMITS.pinReportMax + 1 }, () => id)
    expect((await report(t, publicId, { lost: tooMany })).status).toBe(400)
  })

  it("lets only the owner move a pin or close a comment as outdated", async () => {
    const t = setup()
    const { publicId, alice, id } = await ownedProject(t)
    await report(t, publicId, { lost: [id] })

    const moved = { ...anchor, text: "Start free trial", tag: "a" }
    await expect(
      t.mutation(api.comments.repin, { id, anchor: moved })
    ).rejects.toThrow(/Sign in first/)
    await alice.mutation(api.comments.repin, {
      id,
      anchor: { ...moved, text: "x".repeat(500) },
    })
    let comment = await t.run((ctx) => ctx.db.get(id))
    expect(comment?.anchor.tag).toBe("a")
    expect(comment?.anchor.text).toHaveLength(LIMITS.anchorTextMaxLength)
    expect(comment?.pinLostAt).toBeUndefined()

    await expect(
      t.mutation(api.comments.resolve, { id, resolution: "outdated" })
    ).rejects.toThrow(/Sign in first/)
    await alice.mutation(api.comments.resolve, { id, resolution: "outdated" })
    comment = await t.run((ctx) => ctx.db.get(id))
    expect(comment).toMatchObject({
      status: "resolved",
      resolution: "outdated",
    })
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 0,
    })
    // Reopening clears the reason, and counts stay right.
    await alice.mutation(api.comments.reopen, { id })
    comment = await t.run((ctx) => ctx.db.get(id))
    expect(comment?.resolution).toBeUndefined()
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 1,
    })

    // In bulk, too, including ones already resolved.
    const second = await addComment(t, publicId)
    await alice.mutation(api.comments.resolve, { id: second })
    expect(
      await alice.mutation(api.comments.bulkSetStatus, {
        ids: [id, second],
        status: "resolved",
        resolution: "outdated",
      })
    ).toBe(1)
    const both = await t.run((ctx) =>
      Promise.all([ctx.db.get(id), ctx.db.get(second)])
    )
    expect(both.map((c) => c?.resolution)).toEqual(["outdated", "outdated"])
    expect(await t.query(api.projects.status, { publicId })).toMatchObject({
      openCount: 0,
    })
  })
})

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
    await claim(alice, publicId)

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

    const token = await ownerToken(alice, publicId)
    const viaWidget = await t.query(api.comments.getForOwner, {
      publicId,
      id,
      sessionToken: token,
    })
    expect(viaWidget?.context?.network).toHaveLength(1)
    expect(viaWidget?.userAgent).toBe("test")

    const listed = await alice.query(api.comments.listForOwner, {
      publicId,
      view: "open",
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
    await claim(alice, publicId)
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
    await claim(alice, publicId)

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
    const chunked = await uploadScreenshot(
      t,
      { publicId, id, secret },
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < 4; i++)
            controller.enqueue(new Uint8Array(LIMITS.screenshotMaxBytes / 2))
          controller.close()
        },
      })
    )
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

    expect(await storedFiles(t)).toHaveLength(1)
  })

  it("rejects screenshots after the upload window", async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      const publicId = generateProjectId()
      const secret = generateSecret()
      const id = await addComment(t, publicId, { secret })
      vi.advanceTimersByTime(SERVER_LIMITS.uploadWindowMs + 1)
      const late = await uploadScreenshot(t, { publicId, id, secret })
      expect(late.status).toBe(410)
      expect(await storedFiles(t)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("anchors", () => {
  it("keeps as much of the anchor as @nuni/anchor captures, and no more", async () => {
    const t = setup()
    const publicId = generateProjectId()
    const host = (i: number) => ({ ...anchor, tag: `host-${i}` })
    const deepest = Array.from(
      { length: LIMITS.anchorScopeMaxDepth },
      (_, i) => ({ kind: "shadow" as const, host: host(i) })
    )
    const ancestor = { tag: "div", classes: [], text: "y".repeat(500) }
    const id = await addComment(t, publicId, {
      anchor: {
        scope: [{ kind: "frame", host: host(-1) }, ...deepest],
        ancestors: Array.from({ length: 9 }, () => ancestor),
      },
    })
    const comment = await t.run((ctx) => ctx.db.get(id))
    // The innermost hosts, like the anchor engine keeps on a deeper chain.
    expect(comment?.anchor.scope?.map((s) => s.host.tag)).toEqual(
      deepest.map((s) => s.host.tag)
    )
    expect(comment?.anchor.ancestors).toHaveLength(LIMITS.anchorAncestorsMax)
    expect(comment?.anchor.ancestors[0]?.text).toHaveLength(
      LIMITS.anchorAncestorTextMaxLength
    )
  })
})

describe("comment and reply ids", () => {
  it("are plain strings: one that is no id is simply not found", async () => {
    const t = setup()
    await expect(
      t.mutation(api.comments.resolve, { id: "nope" })
    ).rejects.toThrow(/Comment not found/)
    await expect(
      t.mutation(api.replies.editOwn, {
        id: "nope",
        authorSecret: generateSecret(),
        body: "Hi",
      })
    ).rejects.toThrow(/Reply not found/)
    await expect(
      t.mutation(api.comments.remove, { id: "nope" })
    ).resolves.toBeNull()
  })
})
