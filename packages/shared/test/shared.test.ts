import { describe, expect, it } from "vitest"

import {
  buildAgentPrompt,
  describeLocation,
  generateProjectId,
  isLocalOrigin,
  isProjectId,
  normalizePath,
} from "../src"

describe("project ids", () => {
  it("generates valid, unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, generateProjectId))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(isProjectId(id)).toBe(true)
  })

  it("rejects malformed ids", () => {
    expect(isProjectId("nuni_short")).toBe(false)
    expect(isProjectId("nuni_0OIl000000000000000000")).toBe(false)
    expect(isProjectId(42)).toBe(false)
    expect(isProjectId("proj_" + "a".repeat(22))).toBe(false)
  })
})

describe("normalizePath", () => {
  it.each([
    ["https://a.com/", "/"],
    ["https://a.com", "/"],
    ["https://a.com/pricing/", "/pricing"],
    ["https://a.com/pricing?ref=x#top", "/pricing"],
    ["https://a.com/docs/index.html", "/docs"],
    ["https://a.com//a//b", "/a/b"],
    ["https://a.com/caf%C3%A9", "/café"],
    ["https://a.com/#/settings", "/#/settings"],
    ["https://a.com/app/#/settings/?tab=1", "/app/#/settings"],
    ["https://a.com/#!/users", "/#/users"],
    ["https://a.com/#section", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected)
  })

  it("matches the same path across origins", () => {
    expect(normalizePath("http://localhost:3000/pricing")).toBe(
      normalizePath("https://prod.example.com/pricing/")
    )
  })

  it("describes a location", () => {
    expect(describeLocation("https://a.com/x?y=1#z")).toEqual({
      origin: "https://a.com",
      path: "/x",
      search: "?y=1",
      hash: "#z",
      url: "https://a.com/x?y=1#z",
    })
  })
})

describe("isLocalOrigin", () => {
  it("detects local origins", () => {
    expect(isLocalOrigin("http://localhost:3000")).toBe(true)
    expect(isLocalOrigin("http://127.0.0.1:5173")).toBe(true)
    expect(isLocalOrigin("http://app.localhost")).toBe(true)
    expect(isLocalOrigin("https://example.com")).toBe(false)
    expect(isLocalOrigin("not a url")).toBe(false)
  })
})

describe("buildAgentPrompt", () => {
  it("embeds the project id when given", () => {
    const id = generateProjectId()
    expect(buildAgentPrompt({ projectId: id })).toContain(id)
  })

  it("points to the CLI without an id", () => {
    expect(buildAgentPrompt()).toContain("npx @nuniapp/cli@latest init")
  })
})
