import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveConfig } from "../src/config"
import { domContext, safeUrl, startCollectors } from "../src/context"
import { CAPTURE_MARK } from "../src/mark"
import { colorFor, h, icon, initials, timeAgo } from "../src/dom"
import { ICONS } from "../src/icons"
import { init } from "../src/index"
import { sha256 } from "../src/sha256"
import { KEYS, read, write } from "../src/storage"

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

describe("sha256 fallback", () => {
  it("matches known test vectors", () => {
    expect(hex(sha256(new TextEncoder().encode("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
    expect(hex(sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
    const long = "a".repeat(1000)
    expect(hex(sha256(new TextEncoder().encode(long)))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
    )
  })
})

describe("dom helpers", () => {
  it("creates renderable SVG icons", () => {
    for (const markup of Object.values(ICONS)) {
      const svg = icon(markup).firstElementChild
      expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg")
      expect(svg?.firstElementChild?.namespaceURI).toBe(
        "http://www.w3.org/2000/svg"
      )
    }
  })

  it("never interprets strings as HTML", () => {
    const el = h("div", {}, "<img src=x onerror=alert(1)>")
    expect(el.querySelector("img")).toBeNull()
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>")
  })

  it("formats initials, colors and times", () => {
    expect(initials("Sam Tester")).toBe("ST")
    expect(initials("ada")).toBe("AD")
    expect(initials("  ")).toBe("?")
    expect(colorFor("Sam")).toBe(colorFor("Sam"))
    expect(timeAgo(Date.now() - 10_000)).toBe("just now")
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe("5m ago")
    expect(timeAgo(Date.now() - 3 * 3600_000)).toBe("3h ago")
  })
})

describe("storage", () => {
  it("reads and writes, falling back to memory", () => {
    write(KEYS.name, "Sam")
    expect(read(KEYS.name)).toBe("Sam")
    write(KEYS.name, null)
    expect(read(KEYS.name)).toBeNull()
  })
})

describe("config", () => {
  it("uses build defaults and allows overrides", () => {
    expect(resolveConfig({ project: "p" }).convexUrl).toBe(
      "http://127.0.0.1:3210"
    )
    expect(
      resolveConfig({ project: "p", appUrl: "https://x.com/" }).appUrl
    ).toBe("https://x.com")
  })

  it("captures everything unless turned off", () => {
    expect(resolveConfig({ project: "p" }).capture).toEqual({
      console: true,
      network: true,
      dom: true,
      screenshot: true,
    })
    expect(
      resolveConfig({ project: "p", capture: { network: false } }).capture
        .network
    ).toBe(false)
  })
})

describe("context collectors", () => {
  afterEach(() => vi.restoreAllMocks())

  it("keeps recent console errors and warnings, and restores console", () => {
    const originalError = console.error
    const silence = vi.fn()
    console.error = silence
    const collectors = startCollectors(
      { console: true, network: false },
      () => false
    )
    console.error("Boom", new Error("bad"), { a: 1 })
    console.error("GET https://api.a.com/me?token=abc#x failed")
    expect(collectors.console().at(-1)?.message).toBe(
      "GET https://api.a.com/me failed"
    )
    for (let i = 0; i < 30; i++) console.error(`e${i}`)
    const logs = collectors.console()
    expect(logs).toHaveLength(20)
    expect(logs.at(-1)?.message).toBe("e29")
    expect(silence).toHaveBeenCalledWith("Boom", expect.any(Error), { a: 1 })
    collectors.stop()
    expect(console.error).toBe(silence)
    console.error = originalError
  })

  it("records failed requests without query strings, skipping ignored ones", async () => {
    const originalFetch = window.fetch
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("down")) throw new TypeError("Failed to fetch")
      return new Response("", { status: url.includes("missing") ? 404 : 200 })
    }) as typeof fetch
    window.fetch = mock
    const collectors = startCollectors(
      { console: false, network: true },
      (url) => url.includes("convex")
    )
    await fetch("https://api.example.com/missing?token=secret")
    await fetch("https://api.example.com/ok")
    await fetch("https://x.convex.cloud/api", { method: "POST" }).catch(
      () => {}
    )
    await fetch("https://api.example.com/down", { method: "post" }).catch(
      () => {}
    )
    // Nuni's own screenshot requests carry a marker and are skipped.
    await fetch("https://api.example.com/missing", {
      [CAPTURE_MARK]: true,
    } as RequestInit)
    expect(collectors.network()).toEqual([
      expect.objectContaining({
        method: "GET",
        url: "https://api.example.com/missing",
        status: 404,
      }),
      expect.objectContaining({ method: "POST", status: 0 }),
    ])
    collectors.stop()
    expect(window.fetch).toBe(mock)
    window.fetch = originalFetch
  })

  it("records a reused XHR once per request, under the right URL", () => {
    const originalXhr = window.XMLHttpRequest
    // A minimal XHR that finishes synchronously with a chosen status.
    class FakeXhr extends EventTarget {
      status = 0
      next = 0
      open(_method: string, url: string) {
        this.next = url.includes("fail") ? 500 : 200
      }
      send() {
        this.status = this.next
        this.dispatchEvent(new Event("loadend"))
      }
    }
    window.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
    const collectors = startCollectors(
      { console: false, network: true },
      () => false
    )
    const xhr = new window.XMLHttpRequest()
    xhr.open("GET", "https://api.example.com/first")
    xhr.send()
    xhr.open("POST", "https://api.example.com/fail?secret=1")
    xhr.send()
    expect(collectors.network()).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "https://api.example.com/fail",
        status: 500,
      }),
    ])
    collectors.stop()
    window.XMLHttpRequest = originalXhr
  })

  it("strips query strings and hashes from URLs", () => {
    expect(safeUrl("https://a.com/p?x=1#y")).toBe("https://a.com/p")
  })
})

describe("domContext", () => {
  it("removes form values and scripts, and reads key styles", () => {
    document.body.innerHTML = `<form id="f" style="padding: 4px">
      <input name="email" value="me@example.com">
      <textarea>private notes</textarea>
      <script>secret()</script>
      <button type="submit">Send</button>
    </form>`
    const form = document.getElementById("f")!
    const { html, styles } = domContext(form)
    expect(html).toContain("<button")
    expect(html).not.toContain("me@example.com")
    expect(html).not.toContain("private notes")
    expect(html).not.toContain("secret()")
    // The page itself is untouched.
    expect(form.querySelector("input")?.getAttribute("value")).toBe(
      "me@example.com"
    )
    expect(styles.padding).toBe("4px")
  })

  it("removes select options and masked areas", () => {
    document.body.innerHTML = `<div id="d">
      <select name="address"><option value="a1">12 Private Road</option><option>Work</option></select>
      <p data-nuni-mask title="secret">Balance: $1,234</p>
      <section data-nuni-mask><button id="inner">Pay</button></section>
    </div>`
    const { html } = domContext(document.getElementById("d")!)
    expect(html).toContain("<!-- 2 options -->")
    expect(html).not.toContain("Private Road")
    expect(html).not.toContain("a1")
    expect(html).not.toContain("1,234")
    expect(html).not.toContain("secret")
    expect(html).toContain("<!-- masked -->")
    // An element inside a masked area keeps only its tag.
    const inner = domContext(document.getElementById("inner")!).html
    expect(inner).not.toContain("Pay")
    expect(inner.startsWith("<button")).toBe(true)
  })

  it("keeps big elements within the snippet limit", () => {
    document.body.innerHTML = `<ul id="l">${"<li><span>item</span></li>".repeat(2000)}</ul>`
    const { html } = domContext(document.getElementById("l")!)
    expect(html.length).toBeLessThanOrEqual(4000)
    expect(html.startsWith("<ul")).toBe(true)
  })
})

describe("init", () => {
  it("rejects invalid project ids without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const instance = init({ project: "nope" })
    expect(warn).toHaveBeenCalled()
    instance.destroy()
    warn.mockRestore()
  })
})

describe("init handles", () => {
  const A = "nuni_JJHAES8DaHHYNVh4JoWWXw"
  const B = "nuni_mknC4w74AuwQ1ez5cCG8Tv"
  const mounted = () => document.getElementById("nuni-root")
  afterEach(() => {
    document.body.innerHTML = ""
    vi.useRealTimers()
  })

  it("only removes the widget when every handle for it is destroyed", async () => {
    const first = init({ project: A })
    const second = init({ project: A })
    await vi.waitFor(() => expect(mounted()).not.toBeNull())
    first.destroy()
    first.destroy() // idempotent
    expect(mounted()).not.toBeNull()
    second.destroy()
    expect(mounted()).toBeNull()
  })

  it("an old handle does not remove a newer project's widget", async () => {
    const a = init({ project: A })
    const b = init({ project: B })
    await vi.waitFor(() => expect(mounted()).not.toBeNull())
    a.destroy()
    expect(mounted()).not.toBeNull()
    b.destroy()
    expect(mounted()).toBeNull()
  })
})
