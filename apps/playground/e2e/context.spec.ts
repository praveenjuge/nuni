import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type Page } from "@playwright/test"

const backendDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/backend"
)
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function projectId() {
  let id = "nuni_"
  for (let i = 0; i < 22; i++) id += ALPHABET[Math.floor(Math.random() * 58)]
  return id
}

function seedOwner(publicId: string): string {
  const out = execFileSync(
    "npx",
    [
      "convex",
      "run",
      "testing:seedOwner",
      JSON.stringify({ publicId, origin: "http://127.0.0.1:5173" }),
    ],
    {
      cwd: backendDir,
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      encoding: "utf8",
    }
  )
  return (JSON.parse(out.slice(out.indexOf("{"))) as { token: string }).token
}

const thread = (page: Page) => page.locator('#nuni-root [data-card="thread"]')
const readClipboard = (page: Page) =>
  page.evaluate(() => navigator.clipboard.readText())

async function openThread(page: Page, body: string) {
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  await page.locator("#nuni-root .panel").getByText(body).click()
  await expect(thread(page)).toContainText(body)
}

test("comments carry page context, screenshot and a prompt for the owner's agent", async ({
  browser,
}) => {
  const project = projectId()
  const token = seedOwner(project)
  const body = `Price looks wrong ${Date.now()}`
  const permissions = ["clipboard-read", "clipboard-write"]

  const visitorContext = await browser.newContext({ permissions })
  const visitor = await visitorContext.newPage()
  await visitor.route("**/api/prices**", (route) =>
    route.fulfill({ status: 500, body: "" })
  )
  await visitor.goto(`/pricing?project=${project}`)
  await expect(visitor.locator("#nuni-root .toolbar")).toBeVisible()

  // Things going wrong on the page before the comment is left.
  await visitor.evaluate(async () => {
    console.error("Prices failed to load", new Error("Boom"))
    await fetch("/api/prices?token=secret-123").catch(() => {})
  })

  await visitor
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await visitor
    .locator(".plan")
    .nth(1)
    .getByRole("button", { name: "Choose plan" })
    .click()
  const composer = visitor.locator('#nuni-root [data-card="composer"]')
  await composer.getByPlaceholder("Your name").fill("Val Visitor")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(visitor.locator("#nuni-root .toast")).toHaveText("Comment added")

  // A visitor can copy the comment, but never the owner-only context.
  await openThread(visitor, body)
  await thread(visitor).getByRole("button", { name: "Copy for agent" }).click()
  await expect(visitor.locator("#nuni-root .toast")).toHaveText(
    "Copied for your coding agent"
  )
  const publicPrompt = await readClipboard(visitor)
  expect(publicPrompt).toContain(body)
  expect(publicPrompt).toContain("Choose plan")
  expect(publicPrompt).toContain(`nuni=`)
  expect(publicPrompt).not.toContain("Boom")
  await expect(thread(visitor).locator(".shot")).toHaveCount(0)

  // The owner sees the screenshot and gets the full context.
  const ownerContext = await browser.newContext({ permissions })
  await ownerContext.addInitScript(
    ([key, value]) => localStorage.setItem(key!, value!),
    [`nuni:session:${project}`, token]
  )
  const owner = await ownerContext.newPage()
  await owner.goto(`/pricing?project=${project}`)
  await openThread(owner, body)
  const shot = thread(owner).locator(".shot img")
  await expect(shot).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)

  await thread(owner).getByRole("button", { name: "Copy for agent" }).click()
  const prompt = await readClipboard(owner)
  expect(prompt).toContain(body)
  expect(prompt).toContain("[error] Prices failed to load Error: Boom")
  expect(prompt).toContain("GET http://127.0.0.1:5173/api/prices → 500")
  expect(prompt).not.toContain("secret-123")
  expect(prompt).toContain("```html")
  expect(prompt).toContain("## Screenshot")
  expect(prompt).toContain("Browser: ")

  await visitorContext.close()
  await ownerContext.close()
})
