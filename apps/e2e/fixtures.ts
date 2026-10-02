import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { generateProjectId } from "@nuni/shared"
import { test as base, expect, type Page } from "@playwright/test"

export const backendDir = fileURLToPath(new URL("./.runtime", import.meta.url))
export function convexRun<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {}
): T {
  const { directory } = JSON.parse(
    readFileSync(`${backendDir}/current.json`, "utf8")
  ) as { directory: string }
  const out = execFileSync(
    "bunx",
    [
      "convex",
      "run",
      fn,
      JSON.stringify(args),
      "--env-file",
      `${directory}/.env.local`,
    ],
    {
      cwd: directory,
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      encoding: "utf8",
      timeout: 30_000,
    }
  )
  return (out.trim() ? JSON.parse(out) : undefined) as T
}
export const test = base.extend<{
  ownerPage: Page
  projectId: string
  convexRun: typeof convexRun
}>({
  ownerPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: ".auth/owner.json",
    })
    await use(await context.newPage())
    await context.storageState({ path: ".auth/owner.json" })
    await context.close()
  },
  projectId: async ({ browserName }, use) => {
    void browserName
    await use(generateProjectId())
  },
  convexRun: async ({ browserName }, use) => {
    void browserName
    await use(convexRun)
  },
})
export { expect }
