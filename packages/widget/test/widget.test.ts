import { describe, expect, it, vi } from "vitest"

import { resolveConfig } from "../src/config"
import { colorFor, h, initials, timeAgo } from "../src/dom"
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
