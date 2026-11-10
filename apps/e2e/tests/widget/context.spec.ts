import { COMMENT_PARAM, UPLOAD_ROUTES } from "@nuni/shared"

import { URLS } from "../../env"
import { expect, seedOwner, test } from "../../fixtures"
import { choosePlan } from "../../helpers"
import type { Widget } from "../../widget"

const permissions = ["clipboard-read", "clipboard-write"]
const copyForAgent = async (widget: Widget) => {
  await widget.thread.getByRole("button", { name: "Copy for agent" }).click()
  await expect(widget.toast).toHaveText("Copied for your coding agent")
  return widget.page.evaluate(() => navigator.clipboard.readText())
}

test("comments carry page context, screenshot and a prompt for the owner's agent", async ({
  newVisitor,
  ownerWidget: owner,
}) => {
  const body = `Price looks wrong ${Date.now()}`
  const visitor = await newVisitor({ permissions })
  await visitor.page.route("**/api/prices**", (route) =>
    route.fulfill({ status: 500, body: "" })
  )
  await visitor.goto("/pricing")

  // Things going wrong on the page before the comment is left.
  await visitor.page.evaluate(async () => {
    console.error("Prices failed to load", new Error("Boom"))
    await fetch("/api/prices?token=secret-123").catch(() => {})
  })

  await visitor.startComment(choosePlan(visitor.page, 1))
  // The screenshot is attached on its own; the composer doesn't show it.
  await expect(visitor.composer.locator("img")).toHaveCount(0)
  const uploaded = visitor.page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === UPLOAD_ROUTES.screenshot &&
      r.request().method() === "POST"
  )
  await visitor.post(body)
  expect((await uploaded).status()).toBe(201)

  // A visitor can copy the comment, but never the owner-only context.
  await visitor.openThread(body)
  const publicPrompt = await copyForAgent(visitor)
  expect(publicPrompt).toContain(body)
  expect(publicPrompt).toContain("Choose plan")
  expect(publicPrompt).toContain(`${COMMENT_PARAM}=`)
  expect(publicPrompt).not.toContain("Boom")
  await expect(visitor.threadScreenshot).toHaveCount(0)

  // The owner sees the screenshot and gets the full context.
  await owner.page.context().grantPermissions(permissions)
  await owner.goto("/pricing")
  await owner.openThread(body)
  await expect(owner.threadScreenshot).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(() =>
      owner.threadScreenshot.evaluate(
        (img: HTMLImageElement) => img.naturalWidth
      )
    )
    .toBeGreaterThan(0)

  const prompt = await copyForAgent(owner)
  expect(prompt).toContain(body)
  expect(prompt).toContain("[error] Prices failed to load Error: Boom")
  expect(prompt).toContain(`GET ${URLS.playground}/api/prices → 500`)
  expect(prompt).not.toContain("secret-123")
  expect(prompt).toContain("```html")
  expect(prompt).toContain("## Screenshot")
  expect(prompt).toContain("Browser: ")
})

test("commenters attach an image and a marked-up screenshot that everyone sees", async ({
  widget: visitor,
  newVisitor,
  projectId,
}) => {
  seedOwner(projectId)
  const body = `See the arrow ${Date.now()}`
  await visitor.goto("/pricing")
  // A small PNG, made by the browser.
  const png = Buffer.from(
    (
      await visitor.page.evaluate(() => {
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

  await visitor.startComment(
    visitor.page.locator(".plan").nth(1).locator(".price")
  )
  await visitor.bodyField.fill(body)

  // An image from disk.
  await visitor.composer
    .locator('input[type="file"]')
    .setInputFiles({ name: "mock.png", mimeType: "image/png", buffer: png })
  await expect(
    visitor.composer.getByRole("img", { name: "Image 1" })
  ).toBeVisible()
  await expect(visitor.composer).toContainText(
    "Images are shown to everyone who can see this comment."
  )

  // The screenshot, with an arrow drawn on it.
  const markUp = visitor.composer.getByRole("button", {
    name: "Mark up a screenshot",
  })
  await markUp.click()
  const editor = visitor.page.getByRole("dialog", {
    name: "Mark up the screenshot",
  })
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.getByRole("button", { name: "Arrow" }).click()
  const box = (await editor.locator("canvas").boundingBox())!
  const mouse = visitor.page.mouse
  await mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8)
  await mouse.down()
  await mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
    steps: 5,
  })
  await mouse.up()
  await editor.getByRole("button", { name: "Attach" }).click()
  await expect(editor).toHaveCount(0)
  await expect(
    visitor.composer.getByRole("img", { name: "Image 2" })
  ).toBeVisible()
  // Escape closes the editor without attaching, and keeps the comment.
  await markUp.click()
  await expect(editor).toBeVisible()
  await visitor.page.keyboard.press("Escape")
  await expect(editor).toHaveCount(0)
  await expect(visitor.bodyField).toHaveValue(body)
  await expect(visitor.composerImages).toHaveCount(2)

  const images: number[] = []
  visitor.page.on("response", (r) => {
    if (new URL(r.url()).pathname === UPLOAD_ROUTES.image)
      images.push(r.status())
  })
  await visitor.post(body)
  await expect.poll(() => images).toEqual([201, 201])

  // Someone else sees both images in the thread.
  const other = await newVisitor()
  await other.goto("/pricing")
  await other.openThread(body)
  await expect(other.threadImages).toHaveCount(2)
  for (const img of await other.threadImages.all()) {
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)
  }
})

test("unclaimed sites don't offer images", async ({ widget }) => {
  await widget.goto("/pricing")
  await widget.startComment(
    widget.page.locator(".plan").first().locator(".price")
  )
  await expect(widget.bodyField).toBeVisible()
  await expect(
    widget.composer.getByRole("button", { name: "Add an image" })
  ).toHaveCount(0)
})
