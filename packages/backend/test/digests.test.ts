import { generateProjectId, HTTP_ROUTES } from "@nuni/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "../convex/_generated/api"
import { nextSendAt } from "../convex/digests"
import { addComment, claim, ORIGIN, postJson, setup, type T } from "./helpers"

const OWNER_EMAIL = "alice@example.com"

/** A Monday, 06:30 UTC: before the daily send hour. */
const START = Date.UTC(2026, 10, 9, 6, 30)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

interface Sent {
  to: { address: string }
  from: { address: string; name: string }
  subject: string
  text: string
  html: string
  headers: Record<string, string>
}

/** Cloudflare's send endpoint, answering `status`; returns what was posted. */
function stubCloudflare(status: () => number = () => 200) {
  const sent: Sent[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acct_1/email/sending/send"
      )
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer cf_token"
      )
      const code = status()
      if (code === 200) sent.push(JSON.parse(String(init.body)) as Sent)
      return new Response(JSON.stringify({ success: code === 200 }), {
        status: code,
      })
    })
  )
  return sent
}

/** A project Alice owns, with her email on her account. */
async function ownedProject(t: T) {
  const publicId = generateProjectId()
  const alice = t.withIdentity({
    subject: "user_alice",
    name: "Alice",
    email: OWNER_EMAIL,
  })
  await alice.mutation(internal.users.storeProfile, {})
  await claim(alice, publicId)
  return { publicId, alice }
}

function reply(t: T, publicId: string, commentId: string, body: string) {
  return postJson(t, "/widget/replies", {
    publicId,
    commentId,
    body,
    authorName: "Riley",
    authorSecret: "s".repeat(32),
  })
}

/** Move the clock and run the hourly cron, with everything it starts. */
async function runCron(t: T, at: number) {
  vi.setSystemTime(at)
  await t.mutation(internal.digests.sendDue, {})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}

const waiting = (t: T) =>
  t.run((ctx) => ctx.db.query("emailActivity").collect())

const project = (t: T, publicId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("projects")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique()
  )

function unsubscribeToken(text: string) {
  const token = /unsubscribe\?token=(\S+)/.exec(text)?.[1]
  if (!token) throw new Error("No unsubscribe link")
  return token
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct_1")
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "cf_token")
  vi.stubEnv("NUNI_EMAIL_FROM", "notify@nuni.test")
  vi.stubEnv("NUNI_APP_URL", "https://nuni.test")
  vi.stubEnv("CONVEX_SITE_URL", "https://nuni.convex.site")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("when emails are due", () => {
  it("picks the next hour, send hour, or Monday", () => {
    expect(nextSendAt("hourly", START)).toBe(Date.UTC(2026, 10, 9, 7))
    expect(nextSendAt("daily", START)).toBe(Date.UTC(2026, 10, 9, 8))
    // Past today's send hour: tomorrow, and next Monday.
    const late = Date.UTC(2026, 10, 9, 8)
    expect(nextSendAt("daily", late)).toBe(Date.UTC(2026, 10, 10, 8))
    expect(nextSendAt("weekly", START)).toBe(Date.UTC(2026, 10, 9, 8))
    expect(nextSendAt("weekly", late)).toBe(Date.UTC(2026, 10, 16, 8))
  })
})

describe("activity emails", () => {
  it("sends one email with everything since the last, grouped by page", async () => {
    const t = setup()
    const sent = stubCloudflare()
    const { publicId } = await ownedProject(t)
    const first = await addComment(t, publicId, { body: "Make this bigger" })
    await addComment(t, publicId, { body: "Typo here", path: "/about" })
    await reply(t, publicId, first, "Agreed")

    // Not before the send hour.
    await runCron(t, START + HOUR)
    expect(sent).toHaveLength(0)

    await runCron(t, START + 2 * HOUR)
    expect(sent).toHaveLength(1)
    const email = sent[0]!
    expect(email.to.address).toBe(OWNER_EMAIL)
    expect(email.from).toEqual({
      address: "notify@nuni.test",
      name: "Nuni",
    })
    expect(email.subject).toBe("localhost:3000: 2 new comments, 1 reply")
    expect(email.text).toContain("Pricing (/pricing)")
    expect(email.text).toContain("Sam commented\n  Make this bigger")
    expect(email.text).toContain("Riley replied:\n    Agreed")
    expect(email.text).toContain(`Open: ${ORIGIN}/pricing?nuni=${first}`)
    expect(email.text).toContain("Typo here")
    expect(email.text).toContain(`https://nuni.test/dashboard/p/${publicId}`)
    expect(email.html).toContain("Make this bigger")
    expect(email.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click"
    )
    expect(email.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/nuni\.convex\.site\/email\/unsubscribe\?token=nuni_u_\w+>$/
    )

    // Sent once: nothing is waiting, and the project is no longer due.
    expect(await waiting(t)).toEqual([])
    expect((await project(t, publicId))?.emailDueAt).toBeUndefined()
    await runCron(t, START + 2 * DAY)
    expect(sent).toHaveLength(1)
  })

  it("never sends when nothing happened", async () => {
    const t = setup()
    const sent = stubCloudflare()
    const { publicId } = await ownedProject(t)
    await runCron(t, START + 7 * DAY)
    expect(sent).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()

    // The comment is deleted before the email: nothing left to say.
    const id = await addComment(t, publicId)
    await t.run((ctx) => ctx.db.delete(id))
    await runCron(t, START + 8 * DAY)
    expect(fetch).not.toHaveBeenCalled()
    expect(await waiting(t)).toEqual([])
  })

  it("escapes what commenters wrote", async () => {
    const t = setup()
    const sent = stubCloudflare()
    const { publicId } = await ownedProject(t)
    await addComment(t, publicId, { body: '<img src=x onerror="alert(1)">' })
    await runCron(t, START + 2 * HOUR)
    expect(sent[0]!.html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    )
    expect(sent[0]!.html).not.toContain("<img")
  })

  it("leaves out the owner's replies, but reports status changes", async () => {
    const t = setup()
    const sent = stubCloudflare()
    const { publicId, alice } = await ownedProject(t)
    const id = await addComment(t, publicId)
    await runCron(t, START + 2 * HOUR)
    expect(sent).toHaveLength(1)

    await alice.mutation(api.replies.replyAsOwner, {
      publicId,
      commentId: id,
      body: "On it",
    })
    expect(await waiting(t)).toEqual([])

    await alice.mutation(api.comments.resolve, { id })
    await runCron(t, START + DAY + 2 * HOUR)
    expect(sent).toHaveLength(2)
    expect(sent[1]!.subject).toBe("localhost:3000: 1 resolved")
    expect(sent[1]!.text).toContain("Sam's comment · Resolved")
    expect(sent[1]!.text).not.toContain("On it")

    // Resolved and reopened again within one period is no change.
    await alice.mutation(api.comments.reopen, { id })
    await alice.mutation(api.comments.resolve, { id })
    await runCron(t, START + 2 * DAY + 2 * HOUR)
    expect(sent).toHaveLength(2)
    expect(await waiting(t)).toEqual([])
  })

  it("notes nothing before the project has an owner", async () => {
    const t = setup()
    const publicId = generateProjectId()
    await addComment(t, publicId)
    expect(await waiting(t)).toEqual([])
    expect((await project(t, publicId))?.emailDueAt).toBeUndefined()
  })

  it("tries again after a failure that may pass, then waits for the next email", async () => {
    const t = setup()
    let status = 500
    const sent = stubCloudflare(() => status)
    const { publicId } = await ownedProject(t)
    await addComment(t, publicId, { body: "First" })

    await runCron(t, START + 2 * HOUR)
    // The first try and both retries.
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sent).toHaveLength(0)
    expect(await waiting(t)).toHaveLength(1)

    status = 200
    await addComment(t, publicId, { body: "Second" })
    await runCron(t, START + DAY + 2 * HOUR)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain("First")
    expect(sent[0]!.text).toContain("Second")
    expect(await waiting(t)).toEqual([])
  })

  it("drops an email Cloudflare won't take", async () => {
    const t = setup()
    stubCloudflare(() => 400)
    const { publicId } = await ownedProject(t)
    await addComment(t, publicId)
    await runCron(t, START + 2 * HOUR)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await waiting(t)).toEqual([])
  })

  it("sends nothing until email is set up", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "")
    const t = setup()
    stubCloudflare()
    const { publicId } = await ownedProject(t)
    await addComment(t, publicId)
    await runCron(t, START + 2 * HOUR)
    expect(fetch).not.toHaveBeenCalled()
    expect(await waiting(t)).toEqual([])
  })
})

describe("email settings", () => {
  it("is daily until the owner changes it", async () => {
    const t = setup()
    const sent = stubCloudflare()
    const { publicId, alice } = await ownedProject(t)
    const settings = () => alice.query(api.projects.emailSettings, { publicId })
    expect(await settings()).toEqual({ frequency: "daily", email: OWNER_EMAIL })

    await addComment(t, publicId)
    await alice.mutation(api.projects.setEmails, {
      publicId,
      frequency: "hourly",
    })
    expect((await settings())?.frequency).toBe("hourly")
    // What was waiting goes out on the new schedule.
    await runCron(t, START + HOUR)
    expect(sent).toHaveLength(1)

    await addComment(t, publicId)
    await alice.mutation(api.projects.setEmails, { publicId, frequency: "off" })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await waiting(t)).toEqual([])
    await addComment(t, publicId)
    await runCron(t, START + 7 * DAY)
    expect(sent).toHaveLength(1)
  })

  it("is the owner's alone, and starts over with a new owner", async () => {
    const t = setup()
    const { publicId, alice } = await ownedProject(t)
    const bob = t.withIdentity({ subject: "user_bob", name: "Bob" })
    await bob.mutation(internal.users.storeProfile, {})
    expect(await bob.query(api.projects.emailSettings, { publicId })).toBeNull()
    await expect(
      bob.mutation(api.projects.setEmails, { publicId, frequency: "off" })
    ).rejects.toThrow("Only the project owner")

    await alice.mutation(api.projects.setEmails, { publicId, frequency: "off" })
    await alice.mutation(api.projects.release, { publicId })
    await claim(bob, publicId)
    expect(
      (await bob.query(api.projects.emailSettings, { publicId }))?.frequency
    ).toBe("daily")
  })
})

describe("unsubscribe links", () => {
  async function emailed(t: T) {
    const sent = stubCloudflare()
    const owned = await ownedProject(t)
    await addComment(t, owned.publicId)
    await runCron(t, START + 2 * HOUR)
    return { ...owned, sent, token: unsubscribeToken(sent[0]!.text) }
  }

  it("turns the emails off without signing in", async () => {
    const t = setup()
    const { publicId, alice, sent, token } = await emailed(t)
    expect(await t.query(api.digests.unsubscribeStatus, { token })).toEqual({
      name: "localhost:3000",
      publicId,
      off: false,
    })
    expect(await t.mutation(api.digests.unsubscribe, { token })).toBe(true)
    expect((await t.query(api.digests.unsubscribeStatus, { token }))?.off).toBe(
      true
    )
    expect(
      (await alice.query(api.projects.emailSettings, { publicId }))?.frequency
    ).toBe("off")

    await addComment(t, publicId)
    await runCron(t, START + 7 * DAY)
    expect(sent).toHaveLength(1)
  })

  it("takes a mail client's one-click post", async () => {
    const t = setup()
    const { publicId, alice, token } = await emailed(t)
    const post = (value: string) =>
      t.fetch(`${HTTP_ROUTES.unsubscribe}?token=${value}`, { method: "POST" })
    expect((await post("nuni_u_nope")).status).toBe(404)
    expect((await post(token)).status).toBe(200)
    expect(
      (await alice.query(api.projects.emailSettings, { publicId }))?.frequency
    ).toBe("off")
  })

  it("stops working when the project changes hands or the link expires", async () => {
    const t = setup()
    const { publicId, alice, token } = await emailed(t)
    vi.setSystemTime(START + 91 * DAY)
    expect(await t.mutation(api.digests.unsubscribe, { token })).toBe(false)

    vi.setSystemTime(START + 3 * HOUR)
    await alice.mutation(api.projects.release, { publicId })
    expect(await t.query(api.digests.unsubscribeStatus, { token })).toBeNull()
    expect(await t.mutation(api.digests.unsubscribe, { token })).toBe(false)
  })
})
