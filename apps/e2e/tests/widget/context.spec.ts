import { convexRun } from "../../fixtures"
import { generateProjectId as projectId } from "@nuni/shared"

import { expect, test, type Page } from "@playwright/test"

/** Seed widget credentials for legacy context regressions; product flows use real sign-in. */
function seedOwner(publicId: string): string {
  return convexRun<{ token: string }>("testing:seedOwner", {
    publicId,
    origin: "http://127.0.0.1:5173",
  }).token
}

const thread = (page: Page) => page.locator('#nuni-root [data-card="thread"]')
const readClipboard = (page: Page) =>
  page.evaluate(() => navigator.clipboard.readText())

/** Open a comment from the widget panel and verify its body before inspecting context. */
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
  // The screenshot is attached on its own; the composer doesn't show it.
  await expect(composer.locator("img")).toHaveCount(0)
  const uploaded = visitor.waitForResponse(
    (r) =>
      r.url().includes("/widget/screenshot") && r.request().method() === "POST"
  )
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(visitor.locator("#nuni-root .toast")).toHaveText("Comment added")
  expect((await uploaded).status()).toBe(201)

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

test("commenters attach an image and a marked-up screenshot that everyone sees", async ({
  browser,
}) => {
  const project = projectId()
  seedOwner(project)
  const body = `See the arrow ${Date.now()}`

  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(`/pricing?project=${project}`)
  await expect(visitor.locator("#nuni-root .toolbar")).toBeVisible()
  // A small PNG, made by the browser.
  const png = Buffer.from(
    (
      await visitor.evaluate(() => {
        const canvas = document.createElement("canvas")
        canvas.width = 40
        canvas.height = 30
        const ctx = canvas.getContext("2d")!
        ctx.fillStyle = "#2563eb"
        ctx.fillRect(0, 0, 40, 30)
        return canvas.toDataURL("image/png")
      })
    ).split(",")[1]!,
    "base64"
  )

  await visitor
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await visitor.locator(".plan").nth(1).locator(".price").click()
  const composer = visitor.locator('#nuni-root [data-card="composer"]')
  await composer.getByPlaceholder("Your name").fill("Val Visitor")
  await composer.getByPlaceholder("Leave a comment").fill(body)

  // An image from disk.
  await composer
    .locator('input[type="file"]')
    .setInputFiles({ name: "mock.png", mimeType: "image/png", buffer: png })
  await expect(composer.getByRole("img", { name: "Image 1" })).toBeVisible()
  await expect(composer).toContainText(
    "Images are shown to everyone who can see this comment."
  )

  // The screenshot, with an arrow drawn on it.
  await composer.getByRole("button", { name: "Mark up a screenshot" }).click()
  const editor = visitor.getByRole("dialog", { name: "Mark up the screenshot" })
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.getByRole("button", { name: "Arrow" }).click()
  const canvas = editor.locator("canvas")
  const box = (await canvas.boundingBox())!
  await visitor.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8)
  await visitor.mouse.down()
  await visitor.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
    steps: 5,
  })
  await visitor.mouse.up()
  await editor.getByRole("button", { name: "Attach" }).click()
  await expect(editor).toHaveCount(0)
  await expect(composer.getByRole("img", { name: "Image 2" })).toBeVisible()
  // Escape closes the editor without attaching, and keeps the comment.
  await composer.getByRole("button", { name: "Mark up a screenshot" }).click()
  await expect(editor).toBeVisible()
  await visitor.keyboard.press("Escape")
  await expect(editor).toHaveCount(0)
  await expect(composer.getByPlaceholder("Leave a comment")).toHaveValue(body)
  await expect(composer.locator(".cmp-thumb")).toHaveCount(2)

  const images: number[] = []
  visitor.on("response", (r) => {
    if (r.url().includes("/widget/image")) images.push(r.status())
  })
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(visitor.locator("#nuni-root .toast")).toHaveText("Comment added")
  await expect.poll(() => images).toEqual([201, 201])

  // Someone else sees both images in the thread.
  const other = await (await browser.newContext()).newPage()
  await other.goto(`/pricing?project=${project}`)
  await openThread(other, body)
  const shown = thread(other).locator(".images img")
  await expect(shown).toHaveCount(2)
  for (const img of await shown.all()) {
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)
  }
})

test("unclaimed sites don't offer images", async ({ page }) => {
  await page.goto(`/pricing?project=${projectId()}`)
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page.locator(".plan").first().locator(".price").click()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  await expect(composer.getByPlaceholder("Leave a comment")).toBeVisible()
  await expect(
    composer.getByRole("button", { name: "Add an image" })
  ).toHaveCount(0)
})
