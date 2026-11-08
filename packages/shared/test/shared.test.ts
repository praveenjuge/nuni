import { describe, expect, it } from "vitest"

import {
  buildAgentPrompt,
  buildCommentPrompt,
  pageLink,
  describeLocation,
  stripHtmlUrlQueries,
  stripUrlQueries,
  withoutQuery,
  dashboardUrl,
  errorMessage,
  generateProjectId,
  generateUserCode,
  handoffMessage,
  isLocalOrigin,
  isProjectId,
  isUserCode,
  normalizePath,
  normalizeUserCode,
  projectIdsIn,
  readHandoff,
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

describe("user codes", () => {
  it("generates codes it accepts, once typed back any way", () => {
    const code = generateUserCode()
    expect(isUserCode(code)).toBe(true)
    expect(isUserCode(normalizeUserCode(` ${code.toLowerCase()}\n`))).toBe(true)
    expect(isUserCode("BCDF-GHJA")).toBe(false)
  })
})

describe("projectIdsIn", () => {
  it("finds every id in source text", () => {
    const [a, b] = [generateProjectId(), generateProjectId()]
    expect(
      projectIdsIn(`init({ project: "${a}" })\n<x data-project='${b}'>`)
    ).toEqual([a, b])
    expect(projectIdsIn("nuni_short")).toEqual([])
  })
})

describe("dashboard handoff", () => {
  it("builds dashboard links on any app URL", () => {
    expect(
      dashboardUrl("https://app.example/", "/claim", {
        project: "nuni_x",
        origin: "http://127.0.0.1:5173",
      })
    ).toBe(
      "https://app.example/dashboard/claim?project=nuni_x&origin=http%3A%2F%2F127.0.0.1%3A5173"
    )
    expect(dashboardUrl("https://app.example", "/sign-out")).toBe(
      "https://app.example/dashboard/sign-out"
    )
  })

  it("hands a token only to its project, with the right kind", () => {
    const session = handoffMessage("session", "p1", "nuni_s_abc")
    expect(readHandoff(session, "p1")).toEqual({
      kind: "session",
      token: "nuni_s_abc",
    })
    expect(readHandoff(session, "p2")).toBeNull()
    expect(
      readHandoff(handoffMessage("commenter", "p1", "nuni_s_abc"), "p1")
    ).toBeNull()
    expect(readHandoff("nuni:session", "p1")).toBeNull()
  })
})

describe("errorMessage", () => {
  it("prefers the backend's message, then the error's, then the fallback", () => {
    const convex = Object.assign(new Error("[CONVEX] raw"), {
      data: { code: "not_found", message: "Comment not found" },
    })
    expect(errorMessage(convex, "x")).toBe("Comment not found")
    expect(errorMessage(new Error("Offline"), "x")).toBe("Offline")
    expect(errorMessage("weird", "Try again")).toBe("Try again")
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

describe("pageLink", () => {
  const origin = "https://acme.example"

  it("opens the comment and keeps the query, or the path's own", () => {
    expect(pageLink({ origin, path: "/pricing", search: "?ref=x" }, "c1")).toBe(
      "https://acme.example/pricing?ref=x&nuni=c1"
    )
    expect(
      pageLink({ origin, path: "/pricing?plan=pro", search: "?ref=x" })
    ).toBe("https://acme.example/pricing?plan=pro")
    expect(pageLink({ origin, path: "/pricing" })).toBe(
      "https://acme.example/pricing"
    )
  })

  it("keeps the query before a hash route", () => {
    expect(pageLink({ origin, path: "/#/settings" }, "c2")).toBe(
      "https://acme.example/?nuni=c2#/settings"
    )
    expect(pageLink({ origin, path: "/#/settings", search: "?ref=x" })).toBe(
      "https://acme.example/?ref=x#/settings"
    )
  })

  it("is null for stored paths that would leave the origin", () => {
    for (const path of [
      ".evil.example/verify",
      "@evil.example/",
      "-evil.example/",
      "\t@evil.example/login",
      "https://evil.example/x",
    ]) {
      expect(pageLink({ origin, path, search: "?token=1" }, "c3")).toBeNull()
    }
  })

  it("keeps leading-slash forms on the origin", () => {
    // The backend rejects them at ingestion; the link is safe either way.
    expect(pageLink({ origin, path: "//evil.example/x" })).toBe(
      "https://acme.example//evil.example/x"
    )
  })

  it("treats custom getPageKey keys as non-links", () => {
    expect(pageLink({ origin, path: "product-123" })).toBeNull()
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
