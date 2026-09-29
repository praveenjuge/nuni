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
      <h1>Release smoke test</h1>
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
  await page.evaluate(() => console.error("Release smoke test error"))

  await toolbar.getByRole("button", { name: "Add a comment" }).click()
  await page.locator("#target").click()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  await composer.getByPlaceholder("Your name").fill("Nuni smoke test")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  let upload: Promise<Response> | null = null
  if (lazy) {
    expect((await lazy).status()).toBe(200)
    await expect(composer.locator(".shot-preview img")).toBeVisible({
      timeout: 30_000,
    })
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
  const response = await created
  expect(response.status()).toBe(201)
  const { id } = (await response.json()) as { id: string }
  const authorSecret = await page.evaluate(() =>
    localStorage.getItem("nuni:author-secret")
  )

  try {
    await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")
    if (upload) expect((await upload).status()).toBe(201)

    // Stored and listed publicly, without the owner-only context.
    const listed = (await callConvex(request, "query", "comments:listForPage", {
      publicId: options.project,
      path: "/",
    })) as { _id: string; body: string }[]
    const mine = listed.find((c) => c._id === id)
    expect(mine?.body).toBe(body)
    expect(mine).not.toHaveProperty("context")
    expect(mine).not.toHaveProperty("screenshotUrl")
    if (HAS_CONTEXT) {
      expect(
        await callConvex(request, "query", "comments:getForOwner", {
          publicId: options.project,
          id,
        })
      ).toBeNull()
    }
  } finally {
    // Clean up production: deleting the comment deletes its screenshot.
    await callConvex(request, "mutation", "comments:deleteOwn", {
      id,
      authorSecret,
    })
  }
  const after = (await callConvex(request, "query", "comments:listForPage", {
    publicId: options.project,
    path: "/",
  })) as { _id: string }[]
  expect(after.some((c) => c._id === id)).toBe(false)
  await context.close()
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
