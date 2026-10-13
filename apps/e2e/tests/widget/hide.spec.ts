import { generateProjectId as projectId } from "@nuni/shared"
import { expect, test, type Page } from "@playwright/test"

const root = (page: Page) => page.locator("#nuni-root")
const toolbar = (page: Page) => root(page).locator(".toolbar")
const hideButton = (page: Page) =>
  toolbar(page).getByRole("button", { name: "Hide comments" })
const pins = (page: Page) => root(page).locator(".pin:not(.pin-draft)")
const toast = (page: Page) => root(page).locator(".toast")

test("Shift+C hides the pins, and they come back when needed", async ({
  page,
}) => {
  const project = projectId()
  const body = `Hide me ${Date.now()}`
  await page.goto(`/pricing?project=${project}`)
  await expect(toolbar(page)).toBeVisible()

  await toolbar(page).getByRole("button", { name: "Add a comment" }).click()
  await page.locator(".plan").nth(1).locator(".price").click()
  const composer = root(page).locator('[data-card="composer"]')
  await composer.getByPlaceholder("Your name").fill("Hide Tester")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(toast(page)).toHaveText("Comment added")
  await expect(pins(page)).toHaveCount(1)
  await expect(pins(page).first()).toBeVisible()
  await expect(hideButton(page)).toHaveAttribute("aria-pressed", "false")
  await expect(hideButton(page)).toHaveAttribute(
    "title",
    "Hide comments (Shift+C)"
  )

  // Shift+C hides them, and only them: the toolbar and its count stay.
  await page.keyboard.press("Shift+C")
  await expect(pins(page)).toHaveCount(0)
  await expect(toast(page)).toHaveText(
    "Comments hidden. Press Shift+C to show them"
  )
  await expect(hideButton(page)).toHaveAttribute("aria-pressed", "true")
  await expect(
    toolbar(page).getByRole("button", { name: /1 open/ })
  ).toBeVisible()
  // It is not the comment hotkey: picking did not start.
  await expect(
    toolbar(page).getByRole("button", { name: "Add a comment" })
  ).toHaveAttribute("aria-pressed", "false")

  // The choice is remembered for this visitor.
  await page.reload()
  await expect(toolbar(page)).toBeVisible()
  await expect(hideButton(page)).toHaveAttribute("aria-pressed", "true")
  await expect(pins(page)).toHaveCount(0)

  // Opening a comment from the panel shows just its pin.
  await toolbar(page).getByRole("button", { name: /open/ }).click()
  await root(page).locator(".panel .item", { hasText: body }).click()
  await expect(root(page).locator('[data-card="thread"]')).toContainText(body)
  await expect(pins(page)).toHaveCount(1)
  await expect(root(page).locator('.pin[data-active="true"]')).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(root(page).locator('[data-card="thread"]')).toHaveCount(0)
  await expect(pins(page)).toHaveCount(0)
  await page.keyboard.press("Escape")

  // So does a shared link to it.
  const id = await page.evaluate(async (project) => {
    const res = await fetch("http://127.0.0.1:3310/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "comments:listForPage",
        args: { publicId: project, path: "/pricing" },
        format: "json",
      }),
    })
    const data = (await res.json()) as { value: { _id: string }[] }
    return data.value[0]!._id
  }, project)
  await page.goto(`/pricing?project=${project}&nuni=${id}`)
  await expect(root(page).locator('[data-card="thread"]')).toContainText(body)
  await expect(root(page).locator('.pin[data-active="true"]')).toBeVisible()
  await expect(pins(page)).toHaveCount(1)
  await page.keyboard.press("Escape")
  await expect(pins(page)).toHaveCount(0)

  // Starting a comment shows the others again.
  await page.keyboard.press("c")
  await expect(
    toolbar(page).getByRole("button", { name: "Cancel adding a comment" })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(pins(page)).toHaveCount(1)
  await expect(hideButton(page)).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("Escape")

  // The toolbar button does the same as Shift+C.
  await hideButton(page).click()
  await expect(pins(page)).toHaveCount(0)
  await hideButton(page).click()
  await expect(toast(page)).toHaveText("Comments shown")
  await expect(pins(page)).toHaveCount(1)
  await expect(pins(page).first()).toBeVisible()
})
