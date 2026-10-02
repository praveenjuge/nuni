import { execFile, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { expect, type Page, type TestInfo } from "@playwright/test"

const execute = promisify(execFile)
const root = fileURLToPath(new URL("../../../../", import.meta.url))
const entry = resolve(root, "packages/cli/dist/index.mjs")

/** Create isolated CLI credentials and a working directory under the test artifact directory. */
export function cliSession(testInfo: TestInfo, project?: string) {
  const cwd = testInfo.outputPath("cli-project")
  mkdirSync(cwd, { recursive: true })
  const env = {
    ...process.env,
    NUNI_CONFIG_DIR: testInfo.outputPath("cli-config"),
    NUNI_PROJECT: project ?? "",
    NUNI_TOKEN: "",
    NUNI_APP_URL: "http://localhost:3000",
    NUNI_CONVEX_URL: "http://127.0.0.1:3210",
    NUNI_CONVEX_SITE_URL: "http://127.0.0.1:3211",
  }
  /** Execute the built CLI against local services, returning stdout or rejecting on failure. */
  const run = async (...args: string[]) => {
    const result = await execute("bun", [entry, ...args], {
      cwd,
      env,
      timeout: 30_000,
    })
    return result.stdout
  }

  /** Approve the real CLI device flow in the owner’s browser and stop its process on failure. */
  async function login(page: Page) {
    const child = spawn("bun", [entry, "login", "--json"], { cwd, env })
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
      const waiting = messages[0]!
      expect(waiting.url).toBe(
        `http://localhost:3000/dashboard/cli?code=${waiting.code}`
      )
      await page.goto(waiting.url!)
      await expect(page.getByText(waiting.code!, { exact: true })).toBeVisible()
      await page
        .getByRole("button", { name: /^(Claim and allow|Allow)$/ })
        .click()
      await expect(
        page.getByText("Terminal signed in", { exact: true })
      ).toBeVisible()
      await expect
        .poll(() => messages[1]?.status, { timeout: 15_000 })
        .toBe("signed_in")
      expect(await finished, stderr).toBe(0)
      expect(messages[1]?.project).toBe(env.NUNI_PROJECT)
    } finally {
      lines.close()
      if (child.exitCode === null) child.kill()
    }
  }

  /** Connect a real stdio MCP client; the caller must close the client after use. */
  async function mcp() {
    const client = new Client({ name: "nuni-e2e", version: "1.0.0" })
    const transport = new StdioClientTransport({
      command: "bun",
      args: [entry, "mcp"],
      cwd,
      env: Object.fromEntries(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      ),
    })
    await client.connect(transport)
    return client
  }

  return { run, login, mcp, env }
}

/** Find a posted comment through the public CLI and fail if it is absent. */
export async function commentId(
  session: ReturnType<typeof cliSession>,
  body: string
) {
  const listed = JSON.parse(await session.run("comments", "--json")) as {
    comments: { _id: string; body: string }[]
  }
  const comment = listed.comments.find((comment) => comment.body === body)
  expect(
    comment,
    `CLI should list the visitor's comment: ${body}`
  ).toBeDefined()
  return comment!._id
}
