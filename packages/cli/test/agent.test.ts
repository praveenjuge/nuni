import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { PassThrough } from "node:stream"
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { LIMITS, type OwnerComment } from "@nuni/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { run } from "../src/cli"
import { saveCredential } from "../src/credentials"
import { NuniError } from "../src/errors"
import { createMcpServer, serve } from "../src/mcp"
import { createOps } from "../src/ops"
import { findProjectIds, resolveProject } from "../src/project"
import { createRemote, type LoginPoll, type Remote } from "../src/remote"

const PROJECT = "nuni_JJHAES8DaHHYNVh4JoWWXw"
const OTHER = "nuni_KKHAES8DaHHYNVh4JoWWXw"
const LOGIN = "npx @nuniapp/cli@latest login"

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
  replies: [],
}

/** A second comment on the same button, and so in the same group. */
const second: OwnerComment = {
  ...comment,
  _id: "jd7def456",
  body: "And make it green",
  authorName: "Kim",
}

const SIGNED_OUT = new NuniError(
  "Not signed in to this project",
  "unauthenticated"
)

/**
 * The backend, in memory. Tokens other than nuni_s_good and nuni_s_env are
 * signed out; "gone" is no comment and "full" a thread with no room for a
 * note.
 */
function fakeRemote(polls: LoginPoll[] = []) {
  const calls: string[] = []
  const signedIn = (token: string) => {
    if (token !== "nuni_s_good" && token !== "nuni_s_env") throw SIGNED_OUT
  }
  const remote: Remote = {
    startLogin: async (publicId, client) => {
      calls.push(`start ${publicId} ${client.split(" ")[0]}`)
      return { deviceSecret: "nuni_d_x", userCode: "BCDF-GHJK", expiresAt: 0 }
    },
    pollLogin: async () => polls.shift() ?? { status: "expired" },
    whoami: async ({ token }) =>
      token === "nuni_s_good"
        ? { valid: true, ownerName: "Alice" }
        : { valid: false },
    logout: async (token) => {
      calls.push(`logout ${token}`)
    },
    listComments: async ({ publicId, token }, options) => {
      signedIn(token)
      calls.push(
        `list ${publicId} ${token} ${options.status}${options.search ? ` search=${options.search}` : ""}`
      )
      return { comments: [comment, second], cursor: null }
    },
    listPages: async ({ token }) => {
      signedIn(token)
      return [
        { path: "/pricing", openCount: 12 },
        { path: "/", openCount: 3 },
      ]
    },
    getComment: async ({ token }, id) => {
      signedIn(token)
      return [comment, second].find((c) => c._id === id) ?? null
    },
    setStatus: async ({ token }, ids, status, note) => {
      signedIn(token)
      calls.push(`${status} ${ids.join(",")}${note ? ` note=${note}` : ""}`)
      return ids.map((id) =>
        id === "gone"
          ? {
              id,
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Comment not found",
              },
            }
          : id === "full" && note
            ? {
                id,
                ok: false as const,
                error: {
                  code: "cap_reached" as const,
                  message: "This thread has reached its reply limit",
                },
              }
            : { id, ok: true as const, changed: true }
      )
    },
    reply: async ({ token }, id, body) => {
      signedIn(token)
      calls.push(`reply ${id} ${body}`)
    },
    fetchImage: async (url) => ({
      data: Buffer.from(url.endsWith("drawn") ? "drawn" : "shot").toString(
        "base64"
      ),
      mimeType: url.endsWith("drawn") ? "image/png" : "image/webp",
    }),
  }
  return Object.assign(remote, { calls })
}

/** Runs the CLI in a project folder with a fake backend, capturing output. */
function cli(options: { remote?: Remote; cwd?: string } = {}) {
  const remote = options.remote ?? fakeRemote()
  const cwd =
    options.cwd ?? tempDir({ "index.html": `data-project="${PROJECT}"` })
  const out: string[] = []
  const err: string[] = []
  const opened: string[] = []
  return {
    out,
    err,
    opened,
    run: (...argv: string[]) =>
      run([...argv, "--cwd", cwd], {
        remote,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        pollMs: 1,
        openBrowser: (url) => opened.push(url),
      }),
    json: () => JSON.parse(out.at(-1)!),
  }
}

const signIn = () => saveCredential(PROJECT, { token: "nuni_s_good" })

beforeEach(() => {
  vi.stubEnv("NUNI_CONFIG_DIR", tempDir())
  vi.stubEnv("NUNI_TOKEN", "")
  vi.stubEnv("NUNI_PROJECT", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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
        expiresAt: 123,
        ownerName: "Alice",
        projectName: "example.com",
      },
    ])
    const io = cli({ remote })
    expect(await io.run("login")).toBe(0)
    expect(remote.calls).toEqual([`start ${PROJECT} nuni-cli`])
    expect(io.out[0]).toContain("/dashboard/cli?code=BCDF-GHJK")
    expect(io.out[0]).toContain("Code  BCDF-GHJK")
    expect(io.opened).toEqual([expect.stringContaining("code=BCDF-GHJK")])
    expect(io.out[1]).toContain("Signed in as Alice to example.com")

    const file = join(process.env.NUNI_CONFIG_DIR!, "credentials.json")
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      [PROJECT]: {
        token: "nuni_s_good",
        ownerName: "Alice",
        projectName: "example.com",
        expiresAt: 123,
      },
    })
  })

  it("stops before asking for approval when the credentials file is unreadable", async () => {
    // An interrupted write leaves an empty file behind.
    const file = join(process.env.NUNI_CONFIG_DIR!, "credentials.json")
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, "")
    const remote = fakeRemote([
      {
        status: "approved",
        token: "nuni_s_good",
        expiresAt: 123,
        ownerName: "Alice",
        projectName: "example.com",
      },
    ])
    const io = cli({ remote })
    expect(await io.run("login")).toBe(1)
    expect(io.err).toEqual([expect.stringContaining("is not valid JSON")])
    expect(remote.calls).toEqual([])
    expect(io.opened).toEqual([])
  })

  it("reports a denied sign-in", async () => {
    const io = cli({ remote: fakeRemote([{ status: "denied" }]) })
    expect(await io.run("login")).toBe(1)
    expect(io.err).toEqual(["The sign-in was denied."])
  })

  it("prints one JSON line per step for agents", async () => {
    const io = cli({ remote: fakeRemote([]) })
    expect(await io.run("login", "--json")).toBe(1)
    expect(io.out.map((line) => JSON.parse(line))).toEqual([
      {
        status: "waiting",
        url: expect.stringContaining("/dashboard/cli?code=BCDF-GHJK"),
        code: "BCDF-GHJK",
      },
      { status: "expired", message: expect.any(String) },
    ])
    expect(io.err).toEqual([])
  })
})

describe("login polling", () => {
  function answer(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    )
  }

  it("reads each state with its HTTP status", async () => {
    answer(202, { status: "pending" })
    expect(await createRemote().pollLogin("x")).toEqual({ status: "pending" })
    answer(410, { status: "expired" })
    expect(await createRemote().pollLogin("x")).toEqual({ status: "expired" })
  })

  it("slows down when rate limited", async () => {
    answer(429, { code: "rate_limited", message: "Polling too fast" })
    expect(await createRemote().pollLogin("x")).toEqual({
      status: "slow_down",
    })
  })

  it("fails on an error instead of reading it as a state", async () => {
    answer(400, { code: "bad_json", message: "Invalid sign-in request" })
    await expect(createRemote().pollLogin("x")).rejects.toMatchObject({
      code: "bad_json",
      message: "Invalid sign-in request",
    })
    answer(410, { code: "expired", message: "Gone" })
    await expect(createRemote().pollLogin("x")).rejects.toBeInstanceOf(
      NuniError
    )
  })
})

describe("signing in", () => {
  it("is needed before reading comments", async () => {
    const io = cli()
    expect(await io.run("comments")).toBe(1)
    expect(io.err).toEqual([`Not signed in to ${PROJECT}. Run \`${LOGIN}\`.`])
  })

  it("is asked for again when the server says the session ended", async () => {
    saveCredential(PROJECT, { token: "nuni_s_revoked" })
    const io = cli()
    expect(await io.run("comment", "jd7abc123")).toBe(1)
    expect(io.err).toEqual([`Not signed in to this project. Run \`${LOGIN}\`.`])
  })

  it("uses $NUNI_TOKEN over the saved session", async () => {
    saveCredential(PROJECT, { token: "nuni_s_saved" })
    vi.stubEnv("NUNI_TOKEN", "nuni_s_env")
    const remote = fakeRemote()
    expect(await cli({ remote }).run("comments")).toBe(0)
    expect(remote.calls).toEqual([`list ${PROJECT} nuni_s_env open`])
  })

  it("whoami tells who is signed in", async () => {
    const io = cli()
    signIn()
    expect(await io.run("whoami")).toBe(0)
    expect(io.out).toEqual([`Signed in to ${PROJECT} as Alice.`])
    expect(await io.run("whoami", "--json")).toBe(0)
    expect(io.json()).toEqual({
      project: PROJECT,
      signedIn: true,
      owner: "Alice",
    })
  })

  it("logout revokes the saved session, even with $NUNI_TOKEN set", async () => {
    signIn()
    vi.stubEnv("NUNI_TOKEN", "nuni_s_env")
    const remote = fakeRemote()
    const io = cli({ remote })
    expect(await io.run("logout")).toBe(0)
    expect(io.out).toEqual([`Signed out of ${PROJECT}.`])
    expect(remote.calls).toEqual(["logout nuni_s_good"])

    expect(await io.run("logout", "--json")).toBe(0)
    expect(io.json()).toEqual({ project: PROJECT, signedOut: false })
    expect(remote.calls).toHaveLength(1)
  })

  it("logout reports a session it couldn't revoke", async () => {
    signIn()
    const remote = fakeRemote()
    remote.logout = async () => {
      throw new NuniError("Could not reach Nuni (offline)", "network")
    }
    const io = cli({ remote })
    expect(await io.run("logout")).toBe(1)
    expect(io.out).toEqual([`Signed out of ${PROJECT}.`])
    expect(io.err[0]).toContain("Could not reach Nuni (offline)")
    expect(await cli({ remote }).run("whoami")).toBe(1)
  })
})

describe("comments", () => {
  beforeEach(signIn)

  it("lists open comments, newest first", async () => {
    const io = cli()
    expect(await io.run("comments")).toBe(0)
    expect(io.out[0]).toContain("2 open comments, newest first")
    expect(io.out[0]).toContain("jd7abc123 · /pricing · Sam · 2 hours ago")
    expect(io.out[0]).toContain('On <button> "Buy now"')
  })

  it("prints the page as JSON", async () => {
    const io = cli()
    expect(await io.run("comments", "--json")).toBe(0)
    expect(io.json()).toEqual({
      comments: [
        expect.objectContaining({ _id: comment._id }),
        expect.objectContaining({ _id: second._id }),
      ],
      cursor: null,
    })
  })

  it("searches, best match first", async () => {
    const remote = fakeRemote()
    const io = cli({ remote })
    expect(await io.run("comments", "--search", " bigger ")).toBe(0)
    expect(remote.calls).toEqual([
      `list ${PROJECT} nuni_s_good open search=bigger`,
    ])
    expect(io.out[0]).toContain("best match first")
  })

  it("groups comments on the same element", async () => {
    const io = cli()
    expect(await io.run("comments", "--group", "element")).toBe(0)
    expect(io.out[0]).toContain(
      "grouped by element:\n\n## /pricing · button.buy (2)\n1. jd7abc123"
    )
  })

  it("rejects unknown options before asking the server", async () => {
    const remote = fakeRemote()
    const io = cli({ remote })
    expect(await io.run("comments", "--status", "closed")).toBe(1)
    expect(await io.run("comments", "--group", "color")).toBe(1)
    expect(await io.run("comments", "--limit", "0")).toBe(1)
    expect(io.err).toEqual([
      "--status must be open or resolved.",
      "--group must be page or element.",
      "--limit must be a positive number.",
    ])
    expect(remote.calls).toEqual([])
  })

  it("lists pages with open comments", async () => {
    const io = cli()
    expect(await io.run("pages")).toBe(0)
    expect(io.out).toEqual([
      "2 pages with open comments:\n\n12 open  /pricing\n 3 open  /",
    ])
  })

  it("shows one comment with its full context", async () => {
    const io = cli()
    expect(await io.run("comment", "jd7abc123")).toBe(0)
    expect(io.out[0]).toContain("> Make this bigger")
    expect(io.out[0]).toContain("[error] Boom")
    expect(io.out[0]).toContain("resolve jd7abc123")
    expect(await io.run("comment", "nope")).toBe(1)
    expect(io.err).toEqual([`No comment nope in ${PROJECT}.`])
  })

  it("saves the screenshot and attached images", async () => {
    const io = cli()
    const dir = tempDir()
    expect(
      await io.run("comment", "jd7abc123", "--save-screenshot", dir, "--json")
    ).toBe(0)
    const shot = join(dir, "nuni-jd7abc123.webp")
    const drawn = join(dir, "nuni-jd7abc123-image-1.png")
    expect(io.json()).toMatchObject({
      _id: "jd7abc123",
      screenshotFile: shot,
      imageFiles: [drawn],
    })
    expect(readdirSync(dir).sort()).toEqual([
      "nuni-jd7abc123-image-1.png",
      "nuni-jd7abc123.webp",
    ])
    expect(readFileSync(shot, "utf8")).toBe("shot")
  })

  it("replies as the owner", async () => {
    const remote = fakeRemote()
    const io = cli({ remote })
    expect(await io.run("reply", "jd7abc123", "Looking into it")).toBe(0)
    expect(io.out).toEqual(["Replied to jd7abc123."])
    expect(remote.calls).toEqual(["reply jd7abc123 Looking into it"])
    expect(await io.run("reply", "jd7abc123")).toBe(1)
  })
})

describe("resolve and reopen", () => {
  beforeEach(signIn)

  it("resolve one or several comments, with the note, in one call", async () => {
    const remote = fakeRemote()
    const io = cli({ remote })
    expect(
      await io.run("resolve", "jd7abc123", "jd7def456", "--note", "Bigger")
    ).toBe(0)
    expect(remote.calls).toEqual(["resolved jd7abc123,jd7def456 note=Bigger"])
    expect(io.out).toEqual(["Resolved jd7abc123, jd7def456."])
  })

  it("resolves more ids than one request takes, in batches", async () => {
    const remote = fakeRemote()
    const io = cli({ remote })
    const ids = Array.from({ length: LIMITS.bulkMax + 1 }, (_, i) => `c${i}`)
    expect(await io.run("resolve", ...ids, "--json")).toBe(0)
    expect(remote.calls.map((call) => call.split(",").length)).toEqual([
      LIMITS.bulkMax,
      1,
    ])
    expect(io.json()).toEqual({ resolved: ids, failed: [] })
  })

  it("keeps finished batches when a later one can't reach Nuni", async () => {
    const remote = fakeRemote()
    const setStatus = remote.setStatus
    let batches = 0
    remote.setStatus = async (...args) => {
      if (++batches === 2) {
        throw new NuniError("Could not reach Nuni (offline)", "network")
      }
      return setStatus(...args)
    }
    const io = cli({ remote })
    const ids = Array.from({ length: LIMITS.bulkMax + 1 }, (_, i) => `c${i}`)
    expect(await io.run("resolve", ...ids, "--json")).toBe(1)
    expect(io.json()).toEqual({
      resolved: ids.slice(0, LIMITS.bulkMax),
      failed: [
        {
          id: ids[LIMITS.bulkMax],
          code: "network",
          error: "Could not reach Nuni (offline)",
        },
      ],
    })
  })

  it("reports the ones that failed, and still resolves the rest", async () => {
    const io = cli()
    expect(
      await io.run("resolve", "jd7abc123", "gone", "full", "--note", "Done")
    ).toBe(1)
    expect(io.out).toEqual(["Resolved jd7abc123."])
    expect(io.err).toEqual([
      "Couldn't resolve gone: Comment not found",
      "Couldn't resolve full: This thread has reached its reply limit",
    ])
  })

  it("prints the same JSON for one id as for several", async () => {
    const io = cli()
    expect(await io.run("resolve", "jd7abc123", "--json")).toBe(0)
    expect(io.json()).toEqual({ resolved: ["jd7abc123"], failed: [] })
    expect(await io.run("resolve", "jd7abc123", "gone", "--json")).toBe(1)
    expect(io.json()).toEqual({
      resolved: ["jd7abc123"],
      failed: [{ id: "gone", code: "not_found", error: "Comment not found" }],
    })
  })

  it("reopens", async () => {
    const remote = fakeRemote()
    const io = cli({ remote })
    expect(await io.run("reopen", "jd7abc123")).toBe(0)
    expect(io.out).toEqual(["Reopened jd7abc123."])
    expect(remote.calls).toEqual(["open jd7abc123"])
    expect(await io.run("reopen", "jd7abc123", "--json")).toBe(0)
    expect(io.json()).toEqual({ reopened: ["jd7abc123"], failed: [] })
  })

  it("needs an id", async () => {
    const io = cli()
    expect(await io.run("resolve")).toBe(1)
    expect(io.err).toEqual(["Pass a comment id: resolve <id...>"])
  })
})

/** The MCP server on in-memory streams, with the official client. */
async function mcp(options: { remote?: Remote; project?: string } = {}) {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const ops = createOps({
    remote: options.remote ?? fakeRemote(),
    project: options.project ?? PROJECT,
    cwd: tempDir(),
  })
  const served = serve(createMcpServer(ops), toServer, toClient)
  const client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(new StdioServerTransport(toClient, toServer))
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args })
      const content = result.content as {
        type: string
        text?: string
        data?: string
      }[]
      return {
        content,
        text: content[0]?.text ?? "",
        isError: result.isError === true,
      }
    },
    async close() {
      await client.close()
      toServer.end()
      await served
    },
  }
}

describe("MCP server", () => {
  beforeEach(signIn)

  it("introduces itself and lists its tools", async () => {
    const server = await mcp()
    expect(server.client.getServerVersion()).toMatchObject({ name: "nuni" })
    const { tools } = await server.client.listTools()
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
    await server.close()
  })

  it("lists, groups and searches comments", async () => {
    const remote = fakeRemote()
    const server = await mcp({ remote })
    expect((await server.call("list_comments")).text).toContain("jd7abc123")
    expect(
      (await server.call("list_comments", { group_by: "page" })).text
    ).toContain("## /pricing (2)")
    const found = await server.call("search_comments", { query: "green" })
    expect(found.isError).toBe(false)
    expect(remote.calls.at(-1)).toBe(
      `list ${PROJECT} nuni_s_good open search=green`
    )
    expect((await server.call("search_comments")).isError).toBe(true)
    expect(
      (await server.call("list_comments", { status: "closed" })).isError
    ).toBe(true)
    expect((await server.call("list_pages")).text).toContain(
      "12 open  /pricing"
    )
    await server.close()
  })

  it("gives one comment with its images, attached ones first", async () => {
    const server = await mcp()
    const one = await server.call("get_comment", { id: "jd7abc123" })
    expect(one.text).toContain("> Make this bigger")
    expect(one.text).toContain(
      "## Images from Sam (1)\n\n- https://files.example.com/drawn"
    )
    expect(one.content.slice(1)).toEqual([
      {
        type: "image",
        data: Buffer.from("drawn").toString("base64"),
        mimeType: "image/png",
      },
      {
        type: "image",
        data: Buffer.from("shot").toString("base64"),
        mimeType: "image/webp",
      },
    ])
    expect((await server.call("get_comment", { id: "nope" })).isError).toBe(
      true
    )
    await server.close()
  })

  it("replies, resolves and reopens", async () => {
    const remote = fakeRemote()
    const server = await mcp({ remote })
    await server.call("reply_to_comment", { id: "jd7abc123", body: "Thanks!" })
    const resolved = await server.call("resolve_comment", {
      id: "jd7abc123",
      note: "Bigger now",
    })
    expect(resolved.text).toBe("Resolved jd7abc123.")
    await server.call("reopen_comment", { id: "jd7abc123" })
    expect(remote.calls).toEqual([
      "reply jd7abc123 Thanks!",
      "resolved jd7abc123 note=Bigger now",
      "open jd7abc123",
    ])
    await server.close()
  })

  it("resolves several, and fails only when none could be", async () => {
    const server = await mcp()
    const several = await server.call("resolve_comments", {
      ids: ["jd7abc123", "gone", "jd7def456"],
      note: "Fixed",
    })
    expect(several.isError).toBe(false)
    expect(several.text).toBe(
      "Resolved jd7abc123, jd7def456.\nCouldn't resolve gone: Comment not found"
    )
    const none = await server.call("resolve_comments", { ids: ["gone"] })
    expect(none.isError).toBe(true)
    await server.close()
  })

  it("tells the agent to ask for a login, before and after the session ends", async () => {
    vi.stubEnv("NUNI_CONFIG_DIR", tempDir())
    const server = await mcp()
    const missing = await server.call("list_comments")
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain(`Ask the user to run \`${LOGIN}\``)

    saveCredential(PROJECT, { token: "nuni_s_revoked" })
    const ended = await server.call("get_comment", { id: "jd7abc123" })
    expect(ended.isError).toBe(true)
    expect(ended.text).toBe(
      `Not signed in to this project. Ask the user to run \`${LOGIN}\` in this project (it opens the Nuni dashboard to approve), then try again.`
    )
    await server.close()
  })

  it("rejects unknown tools", async () => {
    const server = await mcp()
    await expect(server.call("nope")).rejects.toThrow()
    await server.close()
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
