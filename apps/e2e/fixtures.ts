import { execFileSync } from "node:child_process"

import { api } from "@nuni/backend/api"
import { generateProjectId } from "@nuni/shared"
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test"
import { ConvexHttpClient } from "convex/browser"

import { AUTH_STATE, BACKEND_DIR, URLS } from "./env"
import { Widget } from "./widget"

/** Run a function against the suite's isolated backend; void mutations return undefined. */
export function convexRun<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {}
): T {
  const out = execFileSync(
    "bunx",
    ["convex", "run", fn, JSON.stringify(args), "--env-file", ".env.local"],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      encoding: "utf8",
      timeout: 30_000,
    }
  )
  return (out.trim() ? JSON.parse(out) : undefined) as T
}

/** The public comments on one page of a project, as any visitor gets them. */
export function pageComments(project: string, path: string) {
  return new ConvexHttpClient(URLS.convex).query(api.comments.listForPage, {
    publicId: project,
    path,
  })
}

/** The name of the owner `testing:seedOwner` creates for widget tests. */
export const SEEDED_OWNER = "Seeded Owner"

/** Claim a project for a new owner without the dashboard; returns their widget session token. */
export function seedOwner(project: string): string {
  return convexRun<{ token: string }>("testing:seedOwner", {
    publicId: project,
    origin: URLS.playground,
    name: SEEDED_OWNER,
  }).token
}

/**
 * A page signed in to the dashboard. WorkOS refresh tokens are single-use,
 * so the session is saved back after every test that may have refreshed it.
 */
async function signedInPage(
  browser: Browser,
  state: string,
  use: (page: Page) => Promise<void>
) {
  const context = await browser.newContext({ storageState: state })
  await use(await context.newPage())
  await context.storageState({ path: state })
  await context.close()
}

export const test = base.extend<{
  /** A new project ID, so tests never share data. */
  projectId: string
  /** The widget on `page`, for this test's project. */
  widget: Widget
  /** Another visitor: a new browser, with the widget for this test's project. */
  newVisitor: (options?: BrowserContextOptions) => Promise<Widget>
  /** A browser holding the widget owner session of this test's project (claimed by `seedOwner`). */
  ownerWidget: Widget
  ownerPage: Page
  secondOwnerPage: Page
}>({
  // eslint-disable-next-line no-empty-pattern
  projectId: async ({}, use) => {
    await use(generateProjectId())
  },
  widget: async ({ page, projectId }, use) => {
    await use(new Widget(page, projectId))
  },
  newVisitor: async ({ browser, projectId }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (options) => {
      const context = await browser.newContext(options)
      contexts.push(context)
      return new Widget(await context.newPage(), projectId)
    })
    for (const context of contexts) await context.close()
  },
  ownerWidget: async ({ browser, projectId }, use) => {
    const token = seedOwner(projectId)
    const context = await browser.newContext()
    // Where the widget keeps an owner session (packages/widget/src/storage.ts).
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key!, value!),
      [`nuni:session:${projectId}`, token]
    )
    await use(new Widget(await context.newPage(), projectId))
    await context.close()
  },
  ownerPage: async ({ browser }, use) => {
    await signedInPage(browser, AUTH_STATE.owner, use)
  },
  secondOwnerPage: async ({ browser }, use) => {
    await signedInPage(browser, AUTH_STATE.secondOwner, use)
  },
})
export { expect }
