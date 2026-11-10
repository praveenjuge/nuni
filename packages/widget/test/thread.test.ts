import { captureAnchor } from "@nuni/anchor"
import { sha256Hex, type Thread, type WidgetComment } from "@nuni/shared"
import { getFunctionName } from "convex/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { init } from "../src/index"
import type { NuniInstance } from "../src/mount"
import { KEYS } from "../src/storage"

/** The live queries the widget subscribed to, by function name. */
const live = vi.hoisted(() => new Map<string, (value: unknown) => void>())

vi.mock("convex/browser", () => ({
  ConvexClient: class {
    onUpdate(query: never, _args: unknown, onData: (value: unknown) => void) {
      live.set(getFunctionName(query), onData)
      return () => {}
    }
    query = () => Promise.resolve(null)
    mutation = () => Promise.resolve(null)
    close = () => Promise.resolve()
  },
}))

const PROJECT = "nuni_JJHAES8DaHHYNVh4JoWWXw"
const SECRET = "s".repeat(32)
let instance: NuniInstance | null = null

/** Answer a live query, once the widget has subscribed to it. */
async function answer(name: string, value: unknown) {
  await vi.waitFor(() => expect(live.has(name)).toBe(true))
  live.get(name)!(value)
}

/** The widget on a page with one comment, its card opened from the panel. */
async function openThread(thread: Thread) {
  document.body.innerHTML = `<main><h1 id="title">Pricing</h1></main>`
  const comment: WidgetComment = {
    _id: "c1",
    _creationTime: 1,
    status: "open",
    body: "Too small",
    authorName: "Sam",
    authorKeyHash: "someone-else",
    page: { origin: location.origin, path: "/", title: "" },
    anchor: captureAnchor(document.getElementById("title")!),
    viewport: { w: 1024, h: 768, dpr: 1 },
    createdAt: 1,
  }
  instance = init({ project: PROJECT })
  const root = () => document.getElementById("nuni-root")!.shadowRoot!
  await vi.waitFor(() => expect(root().querySelector(".toolbar")).toBeTruthy())
  await answer("comments:listForPage", [comment])
  root()
    .querySelector<HTMLButtonElement>('[data-focus-key="tb-panel"]')!
    .click()
  const item = () =>
    root().querySelector<HTMLButtonElement>('[data-focus-key="item-c1"]')!
  item().click()
  await answer("replies:listForComment", thread)
  expect(root().querySelector('[data-card="thread"]')).toBeTruthy()
  return { root: root(), item }
}

afterEach(() => {
  instance?.destroy()
  instance = null
  live.clear()
  document.body.innerHTML = ""
  localStorage.clear()
})

describe("thread card", () => {
  it("marks a reaction as yours under the browser key and the account key", async () => {
    localStorage.setItem(KEYS.secret, SECRET)
    localStorage.setItem(KEYS.commenter(PROJECT), "token")
    const reaction = (emoji: string, key: string) => ({
      targetId: "c1",
      emoji,
      count: 1,
      authorKeyHashes: [key],
    })
    const { root } = await openThread({
      replies: [],
      images: [],
      reactions: [
        // Added as a guest, before signing in: pressing it still removes it.
        reaction("👍", await sha256Hex(SECRET)),
        reaction("🎉", "user:ada"),
        reaction("👀", "someone-else"),
      ],
    })
    await answer("commenters:validate", {
      valid: true,
      name: "Ada",
      authorKey: "user:ada",
    })
    const pressed = () =>
      [...root.querySelectorAll(".reaction[aria-pressed]")].map((chip) =>
        chip.getAttribute("aria-pressed")
      )
    await vi.waitFor(() => expect(pressed()).toEqual(["true", "true", "false"]))
  })

  it("keeps the reply being typed when the open comment is opened again", async () => {
    const { root, item } = await openThread({
      replies: [],
      reactions: [],
      images: [],
    })
    const field = <T extends HTMLInputElement | HTMLTextAreaElement>(
      key: string
    ) => root.querySelector<T>(`[data-focus-key="${key}"]`)!
    const type = (key: string, text: string) => {
      field(key).value = text
      field(key).dispatchEvent(new Event("input"))
    }
    type("reply-name", "Sam")
    type("reply", "Half a thought")
    item().click()
    expect(field("reply").value).toBe("Half a thought")
    expect(field("reply-name").value).toBe("Sam")
  })
})
