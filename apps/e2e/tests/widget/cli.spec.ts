import { convexRun } from "../../fixtures"
import { generateProjectId as projectId } from "@nuni/shared"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const cliEntry = join(root, "packages/cli/src/index.ts")
const SITE_URL = "http://127.0.0.1:3211"

/** Create visitor feedback through the widget endpoint for CLI regression coverage. */
async function postComment(publicId: string, body: string) {
  const origin = "http://127.0.0.1:5173"
  const res = await fetch(`${SITE_URL}/widget/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      publicId,
      body,
      authorName: "Val Visitor",
      authorSecret: "s".repeat(32),
      page: {
        origin,
        path: "/pricing",
        search: "",
        hash: "",
        title: "Pricing",
        url: `${origin}/pricing`,
      },
      anchor: {
        v: 1,
        selectors: { path: "body > main > button", css: "button.buy" },
        tag: "button",
        text: "Buy now",
        attrs: {},
        ancestors: [],
        siblingIndex: 0,
        siblingCount: 1,
        rect: { x: 10, y: 10, w: 100, h: 40 },
        offset: { x: 0.5, y: 0.5 },
        viewport: { w: 1280, h: 800, dpr: 1, scrollX: 0, scrollY: 0 },
        docSize: { w: 1280, h: 2000 },
      },
      viewport: { w: 1280, h: 800, dpr: 1 },
    }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

test("the CLI signs in, lists, shows and resolves comments", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium")
  const project = projectId()
  convexRun("testing:seedOwner", {
    publicId: project,
    origin: "http://127.0.0.1:5173",
    name: "Olive Owner",
  })
  const body = `Button too small ${Date.now()}`
  const id = await postComment(project, body)
  const env = {
    ...process.env,
    NUNI_CONFIG_DIR: testInfo.outputPath("cli-config"),
    NUNI_TOKEN: "",
    NUNI_PROJECT: project,
    NUNI_CONVEX_URL: "http://127.0.0.1:3210",
    NUNI_CONVEX_SITE_URL: "http://127.0.0.1:3211",
    NUNI_APP_URL: "http://localhost:3000",
  }
  mkdirSync(env.NUNI_CONFIG_DIR, { recursive: true })
  const cli = (...args: string[]) =>
    execFileSync("bun", [cliEntry, ...args], { env, encoding: "utf8" })

  // login waits for approval; approve it the way the dashboard page would.
  const login = spawn("bun", [cliEntry, "login", "--json"], { env })
  const lines = createInterface({ input: login.stdout })[Symbol.asyncIterator]()
  const waiting = JSON.parse((await lines.next()).value as string) as {
    status: string
    code: string
    url: string
  }
  expect(waiting.status).toBe("waiting")
  expect(waiting.url).toContain(`/dashboard/cli?code=${waiting.code}`)
  convexRun("testing:approveCliLogin", { userCode: waiting.code })
  const done = JSON.parse((await lines.next()).value as string) as {
    status: string
    owner: string
  }
  expect(done).toMatchObject({ status: "signed_in", owner: "Olive Owner" })
  await new Promise((resolve) => login.on("close", resolve))
  expect(login.exitCode).toBe(0)

  expect(cli("whoami")).toContain("as Olive Owner")
  const listed = JSON.parse(cli("comments", "--json")) as {
    comments: { _id: string; body: string }[]
  }
  expect(listed.comments.map((c) => c._id)).toEqual([id])

  const prompt = cli("comment", id)
  expect(prompt).toContain(`> ${body}`)
  expect(prompt).toContain("http://127.0.0.1:5173/pricing?nuni=")

  expect(cli("resolve", id)).toContain(`Resolved ${id}`)
  const resolved = JSON.parse(
    cli("comments", "--status", "resolved", "--json")
  ) as { comments: { _id: string }[] }
  expect(resolved.comments.map((c) => c._id)).toEqual([id])

  expect(cli("logout")).toContain("Signed out")
  expect(() => cli("comments")).toThrow()
})
