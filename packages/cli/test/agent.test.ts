import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { OwnerComment } from "@nuni/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { run } from "../src/cli"
import { credentialFor, saveCredential } from "../src/credentials"
import { createMcpServer } from "../src/mcp"
import { findProjectIds, resolveProject } from "../src/project"
import { RemoteError, type LoginPoll, type Remote } from "../src/remote"

const PROJECT = "nuni_JJHAES8DaHHYNVh4JoWWXw"
const OTHER = "nuni_KKHAES8DaHHYNVh4JoWWXw"

function tempDir(files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nuni-agent-"))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

const comment: OwnerComment = {
  _id: "jd7abc123",
  _creationTime: 1,
  status: "open",
  body: "Make this bigger",
  authorName: "Sam",
  authorKeyHash: "x",
  page: {
    origin: "https://example.com",
    path: "/pricing",
    title: "Pricing",
    search: "",
    hash: "",
    url: "https://example.com/pricing",
  },
  anchor: {
    v: 1,
    selectors: { path: "body > button", css: "button.buy" },
    tag: "button",
    text: "Buy now",
    attrs: {},
    ancestors: [],
    siblingIndex: 0,
    siblingCount: 1,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    offset: { x: 0.5, y: 0.5 },
    viewport: { w: 1280, h: 800, dpr: 2, scrollX: 0, scrollY: 0 },
    docSize: { w: 1280, h: 2000 },
  },
  viewport: { w: 1280, h: 800, dpr: 2 },
  createdAt: Date.now() - 2 * 60 * 60 * 1000,
  userAgent: "Mozilla/5.0",
  context: { console: [{ level: "error", message: "Boom", at: 1 }] },
  screenshotUrl: "https://files.example.com/shot",
  imageUrls: ["https://files.example.com/drawn"],
}

/** A second comment on the same button, and so in the same group. */
const second: OwnerComment = {
  ...comment,
  _id: "jd7def456",
  body: "And make it green",
  authorName: "Kim",
}

function fakeRemote(polls: LoginPoll[] = []): Remote & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    startLogin: async (publicId, client) => {
      calls.push(`start ${publicId} ${client.split(" ")[0]}`)
      return { deviceSecret: "nuni_d_x", userCode: "BCDF-GHJK", expiresAt: 0 }
    },
    pollLogin: async () => polls.shift() ?? { status: "expired" },
    whoami: async (_p, token) =>
      token === "nuni_s_good"
        ? { valid: true, ownerName: "Alice" }
        : { valid: false },
    logout: async (token) => {
      calls.push(`logout ${token}`)
    },
    listComments: async (publicId, token, options) => {
      calls.push(
        `list ${publicId} ${token} ${options?.status}${options?.search ? ` search=${options.search}` : ""}`
      )
      return { comments: [comment, second], cursor: null }
    },
    listPages: async (publicId, token) => {
      calls.push(`pages ${publicId} ${token}`)
      return [
        { path: "/pricing", openCount: 12 },
        { path: "/", openCount: 3 },
      ]
    },
    getComment: async (_p, _t, id) => (id === comment._id ? comment : null),
    setStatus: async (token, id, status) => {
      if (id === "gone") throw new RemoteError("Comment not found", "not_found")
      calls.push(`${status} ${id} ${token}`)
    },
    reply: async (_p, token, id, body) => {
      if (id === "noreply") throw new RemoteError("Replies are off", "error")
      calls.push(`reply ${id} ${token} ${body}`)
    },
  }
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    options: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      pollMs: 1,
      openBrowser: () => {},
    },
  }
}

beforeEach(() => {
  vi.stubEnv("NUNI_CONFIG_DIR", tempDir())
  vi.stubEnv("NUNI_TOKEN", "")
  vi.stubEnv("NUNI_PROJECT", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("project detection", () => {
  it("finds the project ID committed in the code", () => {
    const dir = tempDir({
      "app/layout.tsx": `<Nuni project="${PROJECT}" />`,
      "node_modules/x/index.js": `"${OTHER}"`,
      "dist/out.js": `"${OTHER}"`,
      "README.md": "no ids here",
    })
    expect(findProjectIds(dir)).toEqual([
      { id: PROJECT, file: join("app", "layout.tsx") },
    ])
    expect(resolveProject(undefined, dir)).toEqual({
      id: PROJECT,
      source: join("app", "layout.tsx"),
    })
  })

  it("prefers --project and $NUNI_PROJECT, and explains ambiguity", () => {
    const dir = tempDir({
      "a.html": `data-project="${PROJECT}"`,
      "b.vue": `project: "${OTHER}"`,
    })
    expect(() => resolveProject(undefined, dir)).toThrow(/more than one/)
    expect(resolveProject(OTHER, dir).id).toBe(OTHER)
    vi.stubEnv("NUNI_PROJECT", PROJECT)
    expect(resolveProject(undefined, dir)).toEqual({
      id: PROJECT,
      source: "NUNI_PROJECT",
    })
    expect(() => resolveProject("nuni_bad", dir)).toThrow(/not a valid/)
    expect(() => resolveProject(undefined, tempDir())).not.toThrow()
    vi.stubEnv("NUNI_PROJECT", "")
    expect(() => resolveProject(undefined, tempDir())).toThrow(
      /No Nuni project/
    )
  })
})

describe("login", () => {
  it("waits for approval and saves the session privately", async () => {
    const remote = fakeRemote([
      { status: "pending" },
      { status: "slow_down" },
      {
        status: "approved",
        token: "nuni_s_good",
        expiresAt: Date.now() + 1000_000,
        ownerName: "Alice",
        projectName: "example.com",
      },
    ])
    const io = capture()
    const opened: string[] = []
    const code = await run(["login", "--project", PROJECT], {
      remote,
      ...io.options,
      openBrowser: (url) => opened.push(url),
    })
    expect(code).toBe(0)
    expect(remote.calls[0]).toBe(`start ${PROJECT} nuni-cli`)
    expect(io.out[0]).toContain("/dashboard/cli?code=BCDF-GHJK")
    expect(io.out[0]).toContain("Code  BCDF-GHJK")
    expect(opened).toEqual([expect.stringContaining("code=BCDF-GHJK")])
    expect(io.out[1]).toContain("Signed in as Alice to example.com")
    expect(credentialFor(PROJECT)?.token).toBe("nuni_s_good")
    const file = join(process.env.NUNI_CONFIG_DIR!, "credentials.json")
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
    expect(JSON.parse(readFileSync(file, "utf8"))[PROJECT].ownerName).toBe(
      "Alice"
    )
  })

  it("fails clearly when denied or expired, with JSON for agents", async () => {
    const denied = capture()
    expect(
      await run(["login", "--project", PROJECT], {
        remote: fakeRemote([{ status: "denied" }]),
        ...denied.options,
      })
    ).toBe(1)
    expect(denied.err).toEqual(["The sign-in was denied."])

    const expired = capture()
    expect(
      await run(["login", "--project", PROJECT, "--json"], {
        remote: fakeRemote([]),
        ...expired.options,
      })
    ).toBe(1)
    expect(JSON.parse(expired.out[0]!)).toMatchObject({
      status: "waiting",
      code: "BCDF-GHJK",
    })
    expect(JSON.parse(expired.out[1]!)).toMatchObject({ status: "expired" })
    expect(credentialFor(PROJECT)).toBeNull()
  })
})

describe("comment commands", () => {
  it("need a session first", async () => {
    const io = capture()
    expect(
      await run(["comments", "--project", PROJECT], {
        remote: fakeRemote(),
        ...io.options,
      })
    ).toBe(1)
    expect(io.err[0]).toContain("Run `npx @nuniapp/cli@latest login` first")
  })

  it("list, show, resolve and reopen with the saved session", async () => {
    saveCredential(PROJECT, { token: "nuni_s_good" })
    const remote = fakeRemote()
    const io = capture()
    const dir = tempDir({ "index.html": `data-project="${PROJECT}"` })

    expect(
      await run(["comments", "--cwd", dir], { remote, ...io.options })
    ).toBe(0)
    expect(io.out[0]).toContain("2 open comments, newest first")
    expect(io.out[0]).toContain("jd7abc123 · /pricing · Sam · 2 hours ago")
    expect(io.out[0]).toContain('On <button> "Buy now"')

    expect(
      await run(["comment", "jd7abc123", "--cwd", dir], {
        remote,
        ...io.options,
      })
    ).toBe(0)
    expect(io.out[1]).toContain("> Make this bigger")
    expect(io.out[1]).toContain("[error] Boom")
    expect(io.out[1]).toContain("resolve jd7abc123")

    expect(
      await run(["comment", "nope", "--cwd", dir], { remote, ...io.options })
    ).toBe(1)
    expect(
      await run(["resolve", "jd7abc123", "--cwd", dir], {
        remote,
        ...io.options,
      })
    ).toBe(0)
    expect(
      await run(["reopen", "jd7abc123", "--cwd", dir, "--json"], {
        remote,
        ...io.options,
      })
    ).toBe(0)
    expect(remote.calls).toContain("resolved jd7abc123 nuni_s_good")
    expect(remote.calls).toContain("open jd7abc123 nuni_s_good")
    expect(JSON.parse(io.out.at(-1)!)).toEqual({
      id: "jd7abc123",
      status: "open",
    })

    expect(
      await run(["reply", "jd7abc123", "Looking into it", "--cwd", dir], {
        remote,
        ...io.options,
      })
    ).toBe(0)
    expect(
      await run(
        ["resolve", "jd7abc123", "--note", "Made it bigger", "--cwd", dir],
        { remote, ...io.options }
      )
    ).toBe(0)
    const calls = remote.calls.slice(-3)
    expect(calls).toEqual([
      "reply jd7abc123 nuni_s_good Looking into it",
      "resolved jd7abc123 nuni_s_good",
      "reply jd7abc123 nuni_s_good Made it bigger",
    ])
    // When resolving fails, the note is not posted.
    const before = remote.calls.length
    expect(
      await run(["resolve", "gone", "--note", "Done", "--cwd", dir], {
        remote,
        ...io.options,
      })
    ).toBe(1)
    expect(remote.calls.length).toBe(before)
    expect(
      await run(["reply", "jd7abc123", "--cwd", dir], { remote, ...io.options })
    ).toBe(1)

    expect(
      await run(["comments", "--cwd", dir, "--status", "closed"], {
        remote,
        ...io.options,
      })
    ).toBe(1)
  })

  it("search, group, list pages and resolve several", async () => {
    saveCredential(PROJECT, { token: "nuni_s_good" })
    const remote = fakeRemote()
    const io = capture()
    const dir = tempDir({ "index.html": `data-project="${PROJECT}"` })

    expect(
      await run(["comments", "--cwd", dir, "--search", "bigger"], {
        remote,
        ...io.options,
      })
    ).toBe(0)
    expect(remote.calls.at(-1)).toBe(
      `list ${PROJECT} nuni_s_good open search=bigger`
    )
    expect(io.out.at(-1)).toContain("best match first")

    expect(
      await run(["comments", "--cwd", dir, "--group", "element"], {
        remote,
        ...io.options,
      })
    ).toBe(0)
    expect(io.out.at(-1)).toContain(
      "grouped by element:\n\n## /pricing · button.buy (2)\n1. jd7abc123"
    )
    expect(
      await run(["comments", "--cwd", dir, "--group", "color"], {
        remote,
        ...io.options,
      })
    ).toBe(1)

    expect(await run(["pages", "--cwd", dir], { remote, ...io.options })).toBe(
      0
    )
    expect(io.out.at(-1)).toBe(
      "2 pages with open comments:\n\n12 open  /pricing\n 3 open  /"
    )
  })

  it("resolve several reports the ones that failed", async () => {
    saveCredential(PROJECT, { token: "nuni_s_good" })
    const remote = fakeRemote()
    const io = capture()
    const dir = tempDir({ "index.html": `data-project="${PROJECT}"` })
    expect(
      await run(
        [
          "resolve",
          "jd7abc123",
          "gone",
          "jd7def456",
          "--note",
          "Done",
          "--cwd",
          dir,
        ],
        { remote, ...io.options }
      )
    ).toBe(1)
    expect(remote.calls.slice(-4)).toEqual([
      "resolved jd7abc123 nuni_s_good",
      "reply jd7abc123 nuni_s_good Done",
      "resolved jd7def456 nuni_s_good",
      "reply jd7def456 nuni_s_good Done",
    ])
    expect(io.out.at(-1)).toBe("Resolved jd7abc123, jd7def456.")
    expect(io.err.at(-1)).toBe("Couldn't resolve gone: Comment not found")

    // Resolved, but the note failed: reported as resolved, with the note error.
    expect(
      await run(
        ["resolve", "jd7abc123", "noreply", "--note", "Done", "--cwd", dir],
        { remote, ...io.options }
      )
    ).toBe(1)
    expect(remote.calls).toContain("resolved noreply nuni_s_good")
    expect(io.out.at(-1)).toBe("Resolved jd7abc123, noreply.")
    expect(io.err.at(-1)).toBe(
      "Resolved noreply, but couldn't post the note: Replies are off"
    )
  })

  it("whoami and logout", async () => {
    saveCredential(PROJECT, { token: "nuni_s_good" })
    const remote = fakeRemote()
    const io = capture()
    expect(
      await run(["whoami", "-p", PROJECT], { remote, ...io.options })
    ).toBe(0)
    expect(io.out[0]).toBe(`Signed in to ${PROJECT} as Alice.`)
    expect(
      await run(["logout", "-p", PROJECT], { remote, ...io.options })
    ).toBe(0)
    expect(remote.calls).toContain("logout nuni_s_good")
    expect(credentialFor(PROJECT)).toBeNull()
    expect(
      await run(["whoami", "-p", PROJECT], { remote, ...io.options })
    ).toBe(1)
  })

  it("uses $NUNI_TOKEN over saved sessions", async () => {
    vi.stubEnv("NUNI_TOKEN", "nuni_s_env")
    expect(credentialFor(PROJECT)?.token).toBe("nuni_s_env")
  })
})

async function connect(server: ReturnType<typeof createMcpServer>) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  serverSide.onmessage = (message) => {
    void server.handle(message as never).then((response) => {
      if (response) void serverSide.send(response as never)
    })
  }
  await serverSide.start()
  const client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(clientSide)
  return client
}

describe("MCP server", () => {
  it("works with the official MCP client", async () => {
    saveCredential(PROJECT, { token: "nuni_s_good" })
    const remote = fakeRemote()
    const client = await connect(
      createMcpServer({
        remote,
        version: "9.9.9",
        project: PROJECT,
        cwd: tempDir(),
        fetchImage: async (url) => ({
          data: url.endsWith("drawn") ? "BBBB" : "AAAA",
          mimeType: "image/webp",
        }),
      })
    )
    expect(client.getServerVersion()).toMatchObject({
      name: "nuni",
      version: "9.9.9",
    })

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual([
      "list_comments",
      "search_comments",
      "list_pages",
      "get_comment",
      "reply_to_comment",
      "resolve_comment",
      "resolve_comments",
      "reopen_comment",
    ])

    const list = await client.callTool({ name: "list_comments", arguments: {} })
    expect(JSON.stringify(list.content)).toContain("jd7abc123")

    const grouped = await client.callTool({
      name: "list_comments",
      arguments: { group_by: "page" },
    })
    expect(JSON.stringify(grouped.content)).toContain("## /pricing (2)")

    const found = await client.callTool({
      name: "search_comments",
      arguments: { query: "green" },
    })
    expect(found.isError).toBeFalsy()
    expect(remote.calls.at(-1)).toBe(
      `list ${PROJECT} nuni_s_good open search=green`
    )
    const noQuery = await client.callTool({
      name: "search_comments",
      arguments: {},
    })
    expect(noQuery.isError).toBe(true)

    const pages = await client.callTool({ name: "list_pages", arguments: {} })
    expect(JSON.stringify(pages.content)).toContain("12 open  /pricing")

    const one = await client.callTool({
      name: "get_comment",
      arguments: { id: "jd7abc123" },
    })
    const content = one.content as { type: string; text?: string }[]
    expect(content[0]?.text).toContain("> Make this bigger")
    expect(content[0]?.text).toContain(
      "## Images from Sam (1)\n\n- https://files.example.com/drawn"
    )
    // The commenter's own image first, then the element's screenshot.
    expect(content.slice(1)).toEqual([
      { type: "image", data: "BBBB", mimeType: "image/webp" },
      { type: "image", data: "AAAA", mimeType: "image/webp" },
    ])

    const resolved = await client.callTool({
      name: "resolve_comment",
      arguments: { id: "jd7abc123", note: "Bigger now" },
    })
    expect(resolved.isError).toBeFalsy()
    expect(remote.calls.slice(-2)).toEqual([
      "resolved jd7abc123 nuni_s_good",
      "reply jd7abc123 nuni_s_good Bigger now",
    ])
    const several = await client.callTool({
      name: "resolve_comments",
      arguments: { ids: ["jd7abc123", "gone", "jd7def456"], note: "Fixed" },
    })
    expect(several.isError).toBeFalsy()
    expect(JSON.stringify(several.content)).toContain(
      "Resolved jd7abc123, jd7def456."
    )
    expect(JSON.stringify(several.content)).toContain(
      "Couldn't resolve gone: Comment not found"
    )
    const none = await client.callTool({
      name: "resolve_comments",
      arguments: { ids: ["gone"] },
    })
    expect(none.isError).toBe(true)

    await client.callTool({
      name: "reply_to_comment",
      arguments: { id: "jd7abc123", body: "Thanks!" },
    })
    expect(remote.calls.at(-1)).toBe("reply jd7abc123 nuni_s_good Thanks!")

    const missing = await client.callTool({
      name: "get_comment",
      arguments: { id: "nope" },
    })
    expect(missing.isError).toBe(true)
    await expect(
      client.callTool({ name: "nope", arguments: {} })
    ).rejects.toThrow()
    await client.close()
  })

  it("tells the agent to log in when there is no session", async () => {
    const client = await connect(
      createMcpServer({
        remote: fakeRemote(),
        version: "1",
        cwd: tempDir({ "index.html": `data-project="${PROJECT}"` }),
      })
    )
    const result = await client.callTool({
      name: "list_comments",
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain(
      "npx @nuniapp/cli@latest login"
    )
    await client.close()
  })

  it("serves over stdio", async () => {
    const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/index.ts")
    const transport = new StdioClientTransport({
      command: process.versions.bun ? process.execPath : "bun",
      args: [cli, "mcp", "--project", PROJECT],
      env: {
        ...(process.env as Record<string, string>),
        NUNI_CONFIG_DIR: tempDir(),
      },
      stderr: "pipe",
    })
    const client = new Client({ name: "stdio-test", version: "1.0.0" })
    await client.connect(transport)
    expect(await client.ping()).toEqual({})
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(8)
    const result = await client.callTool({
      name: "list_comments",
      arguments: {},
    })
    expect(result.isError).toBe(true)
    await client.close()
  }, 20_000)
})
