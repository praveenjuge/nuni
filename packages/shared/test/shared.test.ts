import { describe, expect, it } from "vitest"

import {
  buildAgentPrompt,
  buildCommentPrompt,
  commentUrl,
  describeLocation,
  stripHtmlUrlQueries,
  stripUrlQueries,
  withoutQuery,
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

describe("commentUrl", () => {
  it("adds the deep link and keeps the query and hash route", () => {
    expect(
      commentUrl(
        { origin: "https://a.com", path: "/pricing", search: "?ref=x" },
        "c1"
      )
    ).toBe("https://a.com/pricing?ref=x&nuni=c1")
    expect(
      commentUrl({ origin: "https://a.com", path: "/#/settings" }, "c2")
    ).toBe("https://a.com/?nuni=c2#/settings")
  })

  it("never leaves the page's origin", () => {
    for (const path of ["//evil.example/login", "https://evil.example/x"]) {
      expect(commentUrl({ origin: "https://a.com", path }, "c3")).toBe(
        "https://a.com/?nuni=c3"
      )
    }
  })
})

describe("buildCommentPrompt", () => {
  const comment = {
    _id: "c1",
    _creationTime: 0,
    status: "open" as const,
    body: "Make this bigger\nand bolder",
    authorName: "Sam",
    authorKeyHash: "hash",
    page: { origin: "https://a.com", path: "/pricing", title: "Pricing" },
    anchor: {
      v: 1 as const,
      selectors: { path: "body > main > button", testId: "data-testid=buy" },
      tag: "button",
      text: "Buy now",
      attrs: { type: "button" },
      ancestors: [],
      siblingIndex: 0,
      siblingCount: 1,
      componentName: "PricingCard",
      rect: { x: 0, y: 0, w: 10, h: 10 },
      offset: { x: 0.5, y: 0.5 },
      viewport: { w: 1280, h: 800, dpr: 2, scrollX: 0, scrollY: 0 },
      docSize: { w: 1280, h: 2000 },
    },
    viewport: { w: 1280, h: 800, dpr: 2 },
    createdAt: Date.UTC(2026, 0, 2),
    userAgent: "Mozilla/5.0 Test",
    context: {
      dom: {
        html: '<button type="button">Buy ```now```</button>',
        styles: { "font-size": "14px" },
      },
      console: [{ level: "error" as const, message: "Boom", at: 1 }],
      network: [
        { method: "GET", url: "https://api.a.com/prices", status: 500, at: 1 },
      ],
    },
    screenshotUrl: "https://files.example.com/shot.webp",
  }

  it("includes the comment, element and owner context", () => {
    const prompt = buildCommentPrompt(comment)
    expect(prompt).toContain("> Make this bigger\n> and bolder")
    expect(prompt).toContain("From Sam on 2026-01-02")
    expect(prompt).toContain("https://a.com/pricing?nuni=c1")
    expect(prompt).toContain("React component: PricingCard")
    expect(prompt).toContain("Test ID: `data-testid=buy`")
    expect(prompt).toContain("font-size: 14px;")
    expect(prompt).toContain("[error] Boom")
    expect(prompt).toContain("GET https://api.a.com/prices → 500")
    expect(prompt).toContain("https://files.example.com/shot.webp")
    expect(prompt).toContain("Browser: Mozilla/5.0 Test")
    // The HTML fence is longer than the backticks inside it.
    expect(prompt).toContain("````html\n<button")
  })

  it("leaves out owner context when asked", () => {
    const prompt = buildCommentPrompt(comment, { includeContext: false })
    expect(prompt).not.toContain("Boom")
    expect(prompt).not.toContain("shot.webp")
    expect(prompt).not.toContain("Mozilla")
    expect(prompt).toContain("Buy now")
  })

  it("includes the selected text and the area", () => {
    const prompt = buildCommentPrompt({
      ...comment,
      anchor: {
        ...comment.anchor,
        quote: { exact: "only $10", prefix: "From ", suffix: " a month" },
        region: { x: 0.1, y: 0.25, w: 0.5, h: 0.4 },
      },
    })
    expect(prompt).toContain("- Selected text: `only $10`")
    expect(prompt).toContain(
      "- Area: 50% × 40% of the element, from 10% left and 25% top"
    )
  })
})

describe("URL secrets", () => {
  it("keeps only origin and path", () => {
    expect(withoutQuery("https://a.com/p?token=1#x")).toBe("https://a.com/p")
    expect(withoutQuery("/api?x=1", "https://a.com")).toBe("https://a.com/api")
    expect(withoutQuery("not a url?x=1")).toBe("not a url")
  })

  it("strips queries from every URL in a log line", () => {
    expect(
      stripUrlQueries(
        "GET https://a.com/me?key=abc failed, see http://b.io/x#t and done?"
      )
    ).toBe("GET https://a.com/me failed, see http://b.io/x and done?")
  })

  it("strips relative URLs and key=value queries, and keeps plain text", () => {
    expect(
      stripUrlQueries(
        'POST /reset?token=1 failed {"url":"api/me?key=2"} ?code=3 #access_token=4'
      )
    ).toBe('POST /reset failed {"url":"api/me"}  ')
    expect(stripUrlQueries("Error #12 in 1/2? What?")).toBe(
      "Error #12 in 1/2? What?"
    )
  })

  it("stays fast on long words", () => {
    const long = `src="data:image/png;base64,${"ab/c".repeat(250_000)}"`
    const started = performance.now()
    expect(stripUrlQueries(long)).toBe(long)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe("stripHtmlUrlQueries", () => {
  it("removes queries and hashes from URL attributes only", () => {
    expect(
      stripHtmlUrlQueries(
        `<a href="/reset?token=abc#x" title="a?b">Go</a><img src='https://cdn.a.com/i.png?sig=1' srcset="a.png?x=1 1x, b.png?y=2 2x">`
      )
    ).toBe(
      `<a href="/reset" title="a?b">Go</a><img src='https://cdn.a.com/i.png' srcset="a.png 1x, b.png 2x">`
    )
  })

  it("covers lazy-loading attributes, inline styles and text", () => {
    expect(
      stripHtmlUrlQueries(
        `<img data-src="i.png?sig=1" data-lazy-srcset="a.png?x=1 1x" style="background: url(/bg.png?t=2)"><p>See https://a.com/x?key=3</p>`
      )
    ).toBe(
      `<img data-src="i.png" data-lazy-srcset="a.png 1x" style="background: url(/bg.png"><p>See https://a.com/x</p>`
    )
  })
})
