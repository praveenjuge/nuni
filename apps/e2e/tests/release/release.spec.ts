import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import {
  HTTP_ROUTES,
  PACKAGES,
  UPLOAD_ROUTES,
  generateProjectId,
  isProjectId,
} from "@nuni/shared"
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
} from "@playwright/test"

import { expect, test } from "../../fixtures"
import { Widget } from "../../widget"

/**
 * A published release for real: the packages from npm and jsDelivr, against
 * the production backend. Each test uses a fresh project and deletes its
 * comments at the end (which also deletes their screenshots).
 */
const VERSION = process.env.NUNI_RELEASE_VERSION ?? ""
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) {
  throw new Error("Set NUNI_RELEASE_VERSION, e.g. NUNI_RELEASE_VERSION=0.1.13")
}
const CDN = `https://cdn.jsdelivr.net/npm/${PACKAGES.widget}@${VERSION}/dist`

function run(command: string, args: string[], cwd?: string) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim()
}

/** A temporary directory outside the workspace, so npx runs the published CLI. */
async function inTempDir<T>(prefix: string, use: (dir: string) => T) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  try {
    return await use(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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

test("npm has the release", async () => {
  for (const name of Object.values(PACKAGES)) {
    expect(run("npm", ["view", `${name}@${VERSION}`, "version"])).toBe(VERSION)
  }
  const files = await inTempDir("nuni-pack-", (dir) => {
    const [pack] = JSON.parse(
      run(
        "npm",
        ["pack", `${PACKAGES.widget}@${VERSION}`, "--dry-run", "--json"],
        dir
      )
    ) as [{ files: { path: string }[] }]
    return pack.files.map((f) => f.path)
  })
  expect(files).toEqual(
    expect.arrayContaining([
      "dist/nuni.global.js",
      "dist/index.js",
      "dist/nuni-screenshot.global.js",
    ])
  )
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
  for (const route of [
    HTTP_ROUTES.comments,
    HTTP_ROUTES.replies,
    UPLOAD_ROUTES.screenshot,
  ]) {
    const res = await request.fetch(`${site}${route}`, {
      method: "OPTIONS",
      headers: { Origin: "https://smoke.nuni.test" },
    })
    expect(res.status(), `${route} (is the backend deployed yet?)`).toBe(204)
  }
})

test("CLI", async () => {
  const cli = `${PACKAGES.cli}@${VERSION}`
  await inTempDir("nuni-cli-", (dir) => {
    expect(run("npx", ["-y", cli, "--version"], dir)).toBe(VERSION)
    const init = JSON.parse(
      run("npx", ["-y", cli, "init", "--json", "--cwd", dir], dir)
    ) as { projectId: string }
    expect(isProjectId(init.projectId)).toBe(true)
  })
})

/** The MCP server's name, version and tools, through a real stdio client. */
async function mcpServer(command: string, args: string[], cwd: string) {
  const client = new Client({ name: "nuni-release", version: VERSION })
  // The SDK passes only a few variables to the server by default; npx needs
  // the rest (a proxy, the npm config) to reach the registry.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  await client.connect(new StdioClientTransport({ command, args, cwd, env }))
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    return { info: client.getServerVersion(), tools }
  } finally {
    await client.close()
  }
}

test("MCP server has the tools of this checkout", async () => {
  test.setTimeout(120_000)
  const published = await inTempDir("nuni-mcp-", (dir) =>
    mcpServer("npx", ["-y", `${PACKAGES.cli}@${VERSION}`, "mcp"], dir)
  )
  expect(published.info?.version).toBe(VERSION)
  const source = fileURLToPath(
    new URL("../../../../packages/cli/src/index.ts", import.meta.url)
  )
  const local = await inTempDir("nuni-mcp-", (dir) =>
    mcpServer("bun", [source, "mcp"], dir)
  )
  expect(published.tools).toEqual(local.tools)
})

/**
 * Comment as a visitor through the real UI, then check the stored comment
 * and delete it through Convex's HTTP API. (The widget's live updates use a
 * WebSocket, which some sandboxes can't open; the local suite covers them.)
 * `serve` installs the page routes for a context.
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
  const widget = new Widget(await context.newPage(), options.project)
  const { page } = widget
  const lazy = page.waitForResponse((r) => options.lazyScript.test(r.url()))
  await page.goto(options.url)
  await expect(widget.toolbar).toBeVisible({ timeout: 30_000 })
  // Read before posting, so cleanup works whatever fails after the post.
  const authorSecret = await widget.authorSecret()
  expect(authorSecret).toBeTruthy()

  if (options.words) {
    await widget.selectWords(page.locator("h1"), options.words)
    await widget.selectionButton.click()
    await expect(widget.quote(widget.composer)).toHaveText(options.words)
  } else {
    await widget.startComment(page.locator("#target"))
  }
  expect((await lazy).status()).toBe(200)
  const created = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === HTTP_ROUTES.comments &&
      r.request().method() === "POST"
  )
  const upload = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === UPLOAD_ROUTES.screenshot &&
      r.request().method() === "POST"
  )
  try {
    await widget.post(body, { name: "Nuni smoke test" })
    const response = await created
    expect(response.status()).toBe(201)
    const { id } = (await response.json()) as { id: string }
    expect((await upload).status()).toBe(201)

    // Stored and listed publicly, without the owner-only context.
    const listed = (await callConvex(request, "query", "comments:listForPage", {
      publicId: options.project,
      path: "/",
    })) as { _id: string }[]
    const mine = listed.find((c) => c._id === id) as
      { body: string; anchor: { quote?: { exact: string } } } | undefined
    expect(mine?.body).toBe(body)
    expect(mine).not.toHaveProperty("context")
    expect(mine).not.toHaveProperty("screenshotUrl")
    if (options.words) expect(mine?.anchor.quote?.exact).toBe(options.words)

    // A reply from the page (CORS included), and a reaction.
    const { site } = await backendUrls(request)
    const reply = await page.evaluate(
      async ({ url, project, id, secret }) => {
        const res = await fetch(url, {
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
      {
        url: `${site}${HTTP_ROUTES.replies}`,
        project: options.project,
        id,
        secret: authorSecret,
      }
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
    expect(
      await callConvex(request, "query", "comments:getForOwner", {
        publicId: options.project,
        id,
      })
    ).toBeNull()
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
  const project = generateProjectId()
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

  for (const words of [undefined, "smoke test"]) {
    await commentFlow(browser, request, {
      url: `${origin}/`,
      project,
      serve,
      lazyScript: /nuni-screenshot\.global\.js$/,
      words,
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
        `${PACKAGES.react}@${VERSION}`,
        `${PACKAGES.widget}@${VERSION}`,
        "react@19",
        "react-dom@19",
      ],
      root
    )
    writeFileSync(
      join(root, "main.js"),
      `import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { Nuni } from "${PACKAGES.react}"

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
    // The screenshot code stays a separate chunk in the host app's bundle.
    expect(
      readdirSync(join(dist, "assets")).some((f) => /screenshot/.test(f))
    ).toBe(true)

    const origin = "https://smoke-esm.nuni.test"
    const serve = (context: BrowserContext) =>
      context.route(`${origin}/**`, (route) => {
        const { pathname } = new URL(route.request().url())
        const file = join(dist, pathname === "/" ? "index.html" : pathname)
        return existsSync(file)
          ? route.fulfill({ path: file })
          : route.fulfill({ status: 404, body: "" })
      })
    const project = generateProjectId()
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
