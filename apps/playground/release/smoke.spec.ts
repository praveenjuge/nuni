import { execFileSync, spawn } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Response,
} from "@playwright/test"

/**
 * Tests a published release for real: the packages from npm and jsDelivr,
 * against the production backend. Each test uses a fresh project and
 * deletes its comment at the end (which also deletes the screenshot).
 */
const VERSION = process.env.NUNI_RELEASE_VERSION ?? ""
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) {
  throw new Error("Set NUNI_RELEASE_VERSION, e.g. NUNI_RELEASE_VERSION=0.1.4")
}

function atLeast(version: string, min: string) {
  const a = version.split(".").map(Number)
  const b = min.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return true
}

/** Screenshots, page context and Copy for agent shipped in 0.1.4. */
const HAS_CONTEXT = atLeast(VERSION, "0.1.4")
/** The MCP server, replies, reactions and text comments shipped in 0.1.5. */
const HAS_THREADS = atLeast(VERSION, "0.1.5")
/** Searching, page lists, grouping and resolving several shipped in 0.1.9. */
const HAS_AGENT_SEARCH = atLeast(VERSION, "0.1.9")
/** Before 0.1.7 the composer showed the screenshot and only sent it once shown. */
const SHOWS_SHOT = HAS_CONTEXT && !atLeast(VERSION, "0.1.7")
const CDN = `https://cdn.jsdelivr.net/npm/@nuniapp/widget@${VERSION}/dist`
const PACKAGES = ["@nuniapp/widget", "@nuniapp/react", "@nuniapp/cli"]
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function projectId() {
  let id = "nuni_"
  for (let i = 0; i < 22; i++) id += ALPHABET[Math.floor(Math.random() * 58)]
  return id
}

function run(command: string, args: string[], cwd?: string) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim()
}

/** A page with a button to comment on, around whatever loads Nuni. */
function smokePage(body: string) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Nuni release smoke test</title></head>
  <body style="font-family: sans-serif; padding: 40px">
    <main>
      <h1>Release smoke test for the Nuni widget</h1>
      <p>Nuni ${VERSION}</p>
      <button id="target" style="padding: 8px 16px">Buy now</button>
    </main>
    ${body}
  </body>
</html>`
}

test.describe.configure({ mode: "serial" })

test("npm has the release", () => {
  for (const name of PACKAGES) {
    expect(run("npm", ["view", `${name}@${VERSION}`, "version"])).toBe(VERSION)
  }
  const dir = mkdtempSync(join(tmpdir(), "nuni-pack-"))
  try {
    const [pack] = JSON.parse(
      run(
        "npm",
        ["pack", `@nuniapp/widget@${VERSION}`, "--dry-run", "--json"],
        dir
      )
    ) as [{ files: { path: string }[] }]
    const files = pack.files.map((f) => f.path)
    expect(files).toContain("dist/nuni.global.js")
    expect(files).toContain("dist/index.js")
    if (HAS_CONTEXT) expect(files).toContain("dist/nuni-screenshot.global.js")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

let backend: Promise<{ cloud: string; site: string }> | null = null

/** The production URLs, read from the published bundle itself. */
function backendUrls(request: APIRequestContext) {
  backend ??= (async () => {
    const bundle = await request.get(`${CDN}/nuni.global.js`)
    expect(bundle.status()).toBe(200)
    const code = await bundle.text()
    const cloud = code.match(/https:\/\/[a-z0-9-]+\.convex\.cloud/)?.[0]
    const site = code.match(/https:\/\/[a-z0-9-]+\.convex\.site/)?.[0]
    if (!cloud || !site) throw new Error("No Convex URLs in the CDN bundle")
    return { cloud, site }
  })()
  return backend
}

/** Convex's plain HTTP function API, so no WebSocket is needed. */
async function callConvex(
  request: APIRequestContext,
  kind: "query" | "mutation",
  path: string,
  args: Record<string, unknown>
) {
  const { cloud } = await backendUrls(request)
  const res = await request.post(`${cloud}/api/${kind}`, {
    data: { path, args, format: "json" },
  })
  const json = (await res.json()) as {
    status: string
    value?: unknown
    errorMessage?: string
  }
  expect(json.status, json.errorMessage).toBe("success")
  return json.value
}

test("production backend serves this release", async ({ request }) => {
  const { site } = await backendUrls(request)
  const routes = [
    "/widget/comments",
    ...(HAS_CONTEXT ? ["/widget/screenshot"] : []),
    ...(HAS_THREADS ? ["/widget/replies"] : []),
  ]
  for (const route of routes) {
    const res = await request.fetch(`${site}${route}`, {
      method: "OPTIONS",
      headers: { Origin: "https://smoke.nuni.test" },
    })
    expect(res.status(), `${route} (is the backend deployed yet?)`).toBe(204)
  }
})

test("CLI", () => {
  const cli = `@nuniapp/cli@${VERSION}`
  // Outside the workspace, so npx runs the published package, not a local link.
  const dir = mkdtempSync(join(tmpdir(), "nuni-cli-"))
  try {
    expect(run("npx", ["-y", cli, "--version"], dir)).toBe(VERSION)
    const init = JSON.parse(
      run("npx", ["-y", cli, "init", "--json", "--cwd", dir], dir)
    ) as { projectId: string }
    expect(init.projectId).toMatch(/^nuni_[1-9A-HJ-NP-Za-km-z]{22}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Send JSON-RPC lines to a stdio server and collect the answers by id. */
function rpc(command: string, args: string[], cwd: string, messages: object[]) {
  return new Promise<Map<number, { result?: unknown; error?: unknown }>>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
      const answers = new Map<number, { result?: unknown; error?: unknown }>()
      const wanted = messages.filter((m) => "id" in m).length
      let buffer = ""
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`No answer from ${args.join(" ")}`))
      }, 90_000)
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString()
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf("\n")
          if (!line) continue
          const message = JSON.parse(line) as {
            id?: number
            result?: unknown
            error?: unknown
          }
          if (typeof message.id === "number") answers.set(message.id, message)
          if (answers.size === wanted) {
            clearTimeout(timer)
            child.kill()
            resolve(answers)
          }
        }
      })
      child.on("error", reject)
      for (const m of messages) {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n")
      }
    }
  )
}

test("MCP server lists its tools", async () => {
  test.skip(!HAS_THREADS, "The MCP server shipped in 0.1.5")
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), "nuni-mcp-"))
  try {
    const answers = await rpc(
      "npx",
      ["-y", `@nuniapp/cli@${VERSION}`, "mcp"],
      dir,
      [
        {
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "nuni-smoke", version: VERSION },
          },
        },
        { method: "notifications/initialized" },
        { id: 2, method: "tools/list" },
      ]
    )
    const init = answers.get(1)?.result as {
      serverInfo: { name: string; version: string }
    }
    expect(init.serverInfo.version).toBe(VERSION)
    const tools = (answers.get(2)?.result as { tools: { name: string }[] })
      .tools
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "get_comment",
        "list_comments",
        "reopen_comment",
        "reply_to_comment",
        "resolve_comment",
        ...(HAS_AGENT_SEARCH
          ? ["list_pages", "resolve_comments", "search_comments"]
          : []),
      ].sort()
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Comment on the button as a visitor through the real UI, then check the
 * stored comment and delete it through Convex's HTTP API. (The widget's live
 * updates use a WebSocket, which some sandboxes can't open; the local e2e
 * suite covers them.) `serve` installs the page routes for a context.
 */
async function commentFlow(
  browser: Browser,
  request: APIRequestContext,
  options: {
    url: string
    project: string
    serve: (context: BrowserContext) => Promise<unknown>
    lazyScript: RegExp
    /** Comment on selected words instead of clicking the button. */
    words?: string
  }
) {
  const body = `Release smoke test ${VERSION} ${Date.now()}`
  const context = await browser.newContext()
  await options.serve(context)
  const page = await context.newPage()
  const lazy = HAS_CONTEXT
    ? page.waitForResponse((r) => options.lazyScript.test(r.url()))
    : null
  await page.goto(options.url)
  const toolbar = page.locator("#nuni-root .toolbar")
  await expect(toolbar).toBeVisible({ timeout: 30_000 })
  // Read before posting, so cleanup works whatever fails after the post.
  const authorSecret = await page.evaluate(() =>
    localStorage.getItem("nuni:author-secret")
  )
  expect(authorSecret).toBeTruthy()
  await page.evaluate(() => console.error("Release smoke test error"))

  if (options.words) {
    await page.locator("h1").evaluate((el, words) => {
      const text = el.firstChild as Text
      const at = text.data.indexOf(words)
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + words.length)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(range)
    }, options.words)
    await page
      .locator("#nuni-root")
      .getByRole("button", { name: "Comment", exact: true })
      .click()
  } else {
    await toolbar.getByRole("button", { name: "Add a comment" }).click()
    await page.locator("#target").click()
  }
  const composer = page.locator('#nuni-root [data-card="composer"]')
  if (options.words) {
    await expect(composer.locator(".quote")).toHaveText(options.words)
  }
  await composer.getByPlaceholder("Your name").fill("Nuni smoke test")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  let upload: Promise<Response> | null = null
  if (lazy) {
    expect((await lazy).status()).toBe(200)
    if (SHOWS_SHOT) {
      await expect(composer.locator(".shot-preview img")).toBeVisible({
        timeout: 30_000,
      })
    }
    upload = page.waitForResponse(
      (r) =>
        r.url().endsWith("/widget/screenshot") &&
        r.request().method() === "POST"
    )
  }
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/widget/comments") && r.request().method() === "POST"
  )
  await composer.getByRole("button", { name: "Post" }).click()

  try {
    const response = await created
    expect(response.status()).toBe(201)
    const { id } = (await response.json()) as { id: string }
    await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")
    if (upload) expect((await upload).status()).toBe(201)

    // Stored and listed publicly, without the owner-only context.
    const listed = (await callConvex(request, "query", "comments:listForPage", {
      publicId: options.project,
      path: "/",
    })) as { _id: string; body: string }[]
    const mine = listed.find((c) => c._id === id) as
      { body: string; anchor: { quote?: { exact: string } } } | undefined
    expect(mine?.body).toBe(body)
    expect(mine).not.toHaveProperty("context")
    expect(mine).not.toHaveProperty("screenshotUrl")
    if (options.words) expect(mine?.anchor.quote?.exact).toBe(options.words)

    if (HAS_THREADS) {
      // A reply from the page (CORS included), and a reaction.
      const { site } = await backendUrls(request)
      const reply = await page.evaluate(
        async ({ site, project, id, secret }) => {
          const res = await fetch(`${site}/widget/replies`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              publicId: project,
              commentId: id,
              body: "Smoke test reply",
              authorName: "Nuni smoke test",
              authorSecret: secret,
            }),
          })
          return { status: res.status, ...((await res.json()) as object) }
        },
        { site, project: options.project, id, secret: authorSecret }
      )
      expect(reply).toMatchObject({ status: 201, id: expect.any(String) })
      await callConvex(request, "mutation", "reactions:toggle", {
        publicId: options.project,
        commentId: id,
        targetId: id,
        emoji: "👍",
        authorSecret,
      })
      const thread = (await callConvex(
        request,
        "query",
        "replies:listForComment",
        { publicId: options.project, commentId: id }
      )) as {
        replies: { body: string }[]
        reactions: { emoji: string; count: number }[]
      }
      expect(thread.replies.map((r) => r.body)).toEqual(["Smoke test reply"])
      expect(thread.reactions).toEqual([
        expect.objectContaining({ emoji: "👍", count: 1 }),
      ])
    }
    if (HAS_CONTEXT) {
      expect(
        await callConvex(request, "query", "comments:getForOwner", {
          publicId: options.project,
          id,
        })
      ).toBeNull()
    }
  } finally {
    // Clean up production, found by its body so it works even when the
    // response was never read. Deleting a comment deletes its screenshot.
    const listed = (await callConvex(request, "query", "comments:listForPage", {
      publicId: options.project,
      path: "/",
    })) as { _id: string; body: string }[]
    for (const c of listed.filter((c) => c.body === body)) {
      await callConvex(request, "mutation", "comments:deleteOwn", {
        id: c._id,
        authorSecret,
      })
    }
    await context.close()
  }
  const after = (await callConvex(request, "query", "comments:listForPage", {
    publicId: options.project,
    path: "/",
  })) as { body: string }[]
  expect(after.some((c) => c.body === body)).toBe(false)
}

test("CDN script tag", async ({ browser, request }) => {
  const project = projectId()
  const origin = "https://smoke.nuni.test"
  const html = smokePage(
    `<script src="${CDN}/nuni.global.js" data-project="${project}" defer></script>`
  )
  const serve = (context: BrowserContext) =>
    context.route(`${origin}/**`, (route) =>
      route.fulfill({ contentType: "text/html", body: html })
    )

  const context = await browser.newContext()
  await serve(context)
  const check = await context.newPage()
  await check.goto(`${origin}/`)
  await expect
    .poll(() => check.evaluate(() => window.Nuni?.version), {
      timeout: 30_000,
    })
    .toBe(VERSION)
  await context.close()

  await commentFlow(browser, request, {
    url: `${origin}/`,
    project,
    serve,
    lazyScript: /nuni-screenshot\.global\.js$/,
  })
  if (HAS_THREADS) {
    await commentFlow(browser, request, {
      url: `${origin}/`,
      project,
      serve,
      lazyScript: /nuni-screenshot\.global\.js$/,
      words: "smoke test",
    })
  }
})

test.describe("npm packages in a bundled React app", () => {
  let root = ""

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "nuni-app-"))
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "nuni-smoke", private: true, type: "module" })
    )
    run(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        `@nuniapp/react@${VERSION}`,
        `@nuniapp/widget@${VERSION}`,
        "react@19",
        "react-dom@19",
      ],
      root
    )
    writeFileSync(
      join(root, "main.js"),
      `import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { Nuni } from "@nuniapp/react"

const project = new URLSearchParams(location.search).get("project")
createRoot(document.getElementById("app")).render(createElement(Nuni, { project }))
`
    )
    writeFileSync(
      join(root, "index.html"),
      smokePage(
        `<div id="app"></div><script type="module" src="/main.js"></script>`
      )
    )
    const { build } = await import("vite")
    await build({
      root,
      configFile: false,
      logLevel: "warn",
      build: { outDir: join(root, "dist"), emptyOutDir: true },
    })
  })

  test.afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  test("comment, screenshot and delete", async ({ browser, request }) => {
    const dist = join(root, "dist")
    const assets = readdirSync(join(dist, "assets"))
    // The screenshot code stays a separate chunk in the host app's bundle.
    if (HAS_CONTEXT) expect(assets.some((f) => /screenshot/.test(f))).toBe(true)

    const origin = "https://smoke-esm.nuni.test"
    const serve = (context: BrowserContext) =>
      context.route(`${origin}/**`, (route) => {
        const { pathname } = new URL(route.request().url())
        const file = join(dist, pathname === "/" ? "index.html" : pathname)
        return existsSync(file)
          ? route.fulfill({ path: file })
          : route.fulfill({ status: 404, body: "" })
      })
    const project = projectId()
    await commentFlow(browser, request, {
      url: `${origin}/?project=${project}`,
      project,
      serve,
      lazyScript: /\/assets\/screenshot[^/]*\.js$/,
    })
  })
})

declare global {
  interface Window {
    Nuni?: { version: string }
  }
}
