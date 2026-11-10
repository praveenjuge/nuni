import { execFile, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { DASHBOARD_ROUTES, dashboardUrl, projectRoute } from "@nuni/shared"
import { expect, type Page, type TestInfo } from "@playwright/test"

import { DASHBOARD_URL, URLS, USERS, backendEnv } from "./env"
import type { Widget } from "./widget"

/** A dashboard URL on the local app. */
export function dashboard(route = "", query?: Record<string, string>) {
  return dashboardUrl(URLS.app, route, query)
}

export const projectPage = (projectId: string) =>
  dashboard(projectRoute(projectId))

/** Sign in as a seeded emulator user on the WorkOS page `page` is on. */
export async function signIn(page: Page, user = USERS.owner) {
  await expect(page).toHaveURL(new RegExp(`^${URLS.workos}/`))
  await page.getByLabel("Email", { exact: false }).fill(user.email)
  await page.getByRole("button", { name: /continue|sign in/i }).click()
  await page.getByLabel("Password", { exact: false }).fill(user.password)
  await page.getByRole("button", { name: /continue|sign in/i }).click()
  await expect(page).toHaveURL(new RegExp(`^${DASHBOARD_URL}`))
}

/** Claim a project through the dashboard, allowing the playground origin. */
export async function claimProject(page: Page, projectId: string) {
  await page.goto(
    dashboard(DASHBOARD_ROUTES.claim, {
      project: projectId,
      origin: URLS.playground,
    })
  )
  await page.getByRole("button", { name: "Claim and allow" }).click()
  await expect(page.getByText("All set", { exact: false })).toBeVisible()
}

/** The playground's "Choose plan" button on the nth pricing plan. */
export function choosePlan(page: Page, n = 0) {
  return page
    .locator(".plan")
    .nth(n)
    .getByRole("button", { name: "Choose plan" })
}

/** A visitor's comment on the playground's pricing page. */
export async function addComment(widget: Widget, body: string) {
  await widget.goto("/pricing")
  await widget.comment(choosePlan(widget.page), body)
}

const execute = promisify(execFile)
const cliEntry = fileURLToPath(
  new URL("../../packages/cli/dist/index.mjs", import.meta.url)
)

/**
 * The built CLI with its own credentials and working directory under the
 * test's output, against the local services. Without `project`, commands run
 * outside any project (like `init`).
 */
export function cliSession(testInfo: TestInfo, project = "") {
  const cwd = testInfo.outputPath("cli-project")
  mkdirSync(cwd, { recursive: true })
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...backendEnv("NUNI_"),
    NUNI_CONFIG_DIR: testInfo.outputPath("cli-config"),
    NUNI_PROJECT: project,
    NUNI_TOKEN: "",
  }
  /** stdout, or a rejection when the command fails. */
  const run = async (...args: string[]) =>
    (await execute("bun", [cliEntry, ...args], { cwd, env, timeout: 30_000 }))
      .stdout

  /** `nuni login`, approved by the owner in the dashboard on `page`. */
  async function login(page: Page) {
    const child = spawn("bun", [cliEntry, "login", "--json"], { cwd, env })
    const lines = createInterface({ input: child.stdout })
    let stderr = ""
    child.stderr.on("data", (chunk) => (stderr += String(chunk)))
    const finished = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    })
    const messages: Record<string, string>[] = []
    lines.on("line", (line) => messages.push(JSON.parse(line)))
    try {
      await expect.poll(() => messages[0]?.status).toBe("waiting")
      const { url, code } = messages[0]!
      expect(url).toBe(dashboard(DASHBOARD_ROUTES.cli, { code: code! }))
      await page.goto(url!)
      await expect(page.getByText(code!, { exact: true })).toBeVisible()
      await page
        .getByRole("button", { name: /^(Claim and allow|Allow)$/ })
        .click()
      await expect(
        page.getByText("Terminal signed in", { exact: true })
      ).toBeVisible()
      expect(await finished, stderr).toBe(0)
      expect(messages[1]).toMatchObject({ status: "signed_in", project })
    } finally {
      lines.close()
      if (child.exitCode === null) child.kill()
    }
  }

  /** A real stdio MCP client; the caller must close it. */
  async function mcp() {
    const client = new Client({ name: "nuni-e2e", version: "1.0.0" })
    await client.connect(
      new StdioClientTransport({
        command: "bun",
        args: [cliEntry, "mcp"],
        cwd,
        env,
      })
    )
    return client
  }

  /** The ID of the open comment with this body, as `nuni comments` lists it. */
  async function commentId(body: string) {
    const listed = JSON.parse(await run("comments", "--json")) as {
      comments: { _id: string; body: string }[]
    }
    const comment = listed.comments.find((comment) => comment.body === body)
    expect(comment, `nuni comments should list: ${body}`).toBeDefined()
    return comment!._id
  }

  return { run, login, mcp, commentId }
}
